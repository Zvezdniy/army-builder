use crate::raw::{RawCatalogue, RawCondition, RawConditionGroup, RawConstraint, RawCost, RawEntry, RawGroup, RawModifier};
use crate::error::Diagnostic;
use super::model::*;

/// Map a RESOLVED raw catalogue into the domain IR. Returns diagnostics for
/// constructs the walking-skeleton mapping cannot faithfully represent.
pub fn to_ir(cat: &RawCatalogue) -> (IrCatalogue, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let entries = cat.entries.iter().map(|e| map_entry(e, cat, &mut diags)).collect();
    let force_constraints = cat.force_entries.iter()
        .flat_map(|force| map_force_constraints(force, cat, &mut diags))
        .collect();
    let ir = IrCatalogue {
        id: cat.id.clone(),
        name: cat.name.clone(),
        game_system_id: cat.game_system_id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| cat.id.clone()),
        revision: cat.revision,
        entries,
        force_constraints,
    };
    (ir, diags)
}

/// Map a force's per-category constraints. In BattleScribe the "1-2 HQ" style
/// min/max is nested inside the categoryLink it constrains (categoryLink extends
/// ContainerEntryBase, so it carries its own <constraints>), which makes the
/// target category a structural FK — the owning link's targetId — regardless of
/// how many categoryLinks the force has. Constraints placed directly under the
/// forceEntry are force-global (no category); the IR has no whole-force target,
/// so those are diagnosed and dropped rather than guessed onto a category.
fn map_force_constraints(force: &crate::raw::RawForce, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Vec<IrConstraint> {
    let mut out: Vec<IrConstraint> = Vec::new();
    for link in &force.category_links {
        for c in &link.constraints {
            if let Some(mapped) = map_constraint(c, "category", &link.target_id, cat, diags) {
                out.push(mapped);
            }
        }
    }
    for c in &force.constraints {
        diags.push(Diagnostic {
            code: "constraint.force_global_unrepresentable".to_string(),
            message: format!(
                "force {} constraint {} is force-global (no category) and has no IR representation (dropped)",
                force.id, c.id
            ),
        });
    }
    out
}

fn map_entry(e: &RawEntry, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> IrEntry {
    let mut costs: Vec<IrCost> = e.costs.iter().map(|c| map_cost(c, cat)).collect();
    let mut constraints: Vec<IrConstraint> = e.constraints.iter()
        .filter_map(|c| map_constraint(c, "entry", &e.id, cat, diags))
        .collect();
    // A categoryLink can nest its own <constraints> (per-category min/max scoped
    // to this entry). Their target is the link's category, not the entry itself.
    for link in &e.category_links {
        constraints.extend(link.constraints.iter()
            .filter_map(|c| map_constraint(c, "category", &link.target_id, cat, diags)));
    }

    // Attach each raw modifier to the IR cost or constraint it targets, based
    // on where its `field` points: a known cost-type id is a cost modifier, a
    // matching constraint id is a bound modifier. Neither → diagnostic + drop.
    for (index, m) in e.modifiers.iter().enumerate() {
        let ir_mod = map_modifier(m, &e.id, index, cat, diags);
        if cat.cost_types.contains_key(&m.field) {
            if let Some(idx) = e.costs.iter().position(|rc| rc.type_id == m.field) {
                costs[idx].modifiers.get_or_insert_with(Vec::new).push(ir_mod);
            } else {
                diags.push(Diagnostic {
                    code: "modifier.target_unmapped".to_string(),
                    message: format!("modifier field {} has no matching cost on entry {}", m.field, e.id),
                });
            }
        } else if let Some(c) = constraints.iter_mut().find(|c| c.id == m.field) {
            c.modifiers.get_or_insert_with(Vec::new).push(ir_mod);
        } else {
            diags.push(Diagnostic {
                code: "modifier.target_unmapped".to_string(),
                message: format!("modifier field {} matches no cost type or constraint on entry {}", m.field, e.id),
            });
        }
    }

    let mut children: Vec<IrEntry> = e.entries.iter().map(|c| map_entry(c, cat, diags)).collect();
    let mut groups: Vec<IrGroup> = Vec::new();
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        if let Some(ir_group) = map_group(g, diags) {
            groups.push(ir_group);
        }
    }

    IrEntry {
        id: e.id.clone(),
        name: e.name.clone(),
        costs,
        categories: e.category_links.iter().map(|l| l.target_id.clone()).collect(),
        constraints,
        children,
        groups,
    }
}

/// Flatten a group's member entries (recursing sub-groups) into `out`; members
/// nested under a group are direct children of the owning entry in the IR.
fn flatten_group_members(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrEntry>) {
    for child in &g.entries {
        out.push(map_entry(child, cat, diags));
    }
    for sub in &g.groups {
        flatten_group_members(sub, cat, diags, out);
    }
}

/// Map a group's own choose-N (selections min/max) into an IrGroup. Nested
/// sub-group constraints are out of scope and diagnostic-dropped. Returns None
/// when the group has no mappable min/max selections limit (behaviour then
/// matches the pre-feature drop: members flattened, no IrGroup emitted).
fn map_group(g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    for sub in &g.groups {
        drop_group_constraints(sub, diags);
    }
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
    let mut constraints: Vec<IrGroupConstraint> = Vec::new();
    for c in &g.constraints {
        if let Some(gc) = map_group_constraint(c, g, diags) {
            constraints.push(gc);
        }
    }
    if constraints.is_empty() {
        return None;
    }
    Some(IrGroup { id: g.id.clone(), name: g.name.clone(), member_entry_ids, constraints })
}

/// A group choose-N limit maps only when it is a selections min/max with no
/// modifier on the limit itself (a conditional limit we cannot yet model).
/// Anything else is a loud drop — never a guessed static value.
fn map_group_constraint(c: &RawConstraint, g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroupConstraint> {
    let drop = |why: String| Diagnostic {
        code: "group.constraint_dropped".to_string(),
        message: format!("selectionEntryGroup {} constraint {} {} (dropped)", g.id, c.id, why),
    };
    if c.kind != "min" && c.kind != "max" {
        diags.push(drop(format!("has unsupported type {}", c.kind)));
        return None;
    }
    if c.field != "selections" {
        diags.push(drop(format!("is not on selections (field {})", c.field)));
        return None;
    }
    // A group choose-N is a per-owner local count over the group's direct
    // members. Only group-local scopes align with that: "self"/"parent", or a
    // foreign-id scope naming the group itself. Broader scopes (force, roster)
    // or any other foreign id aggregate over a different set than the engine
    // counts, so mapping them would silently miscount — drop loudly instead.
    if c.scope != "self" && c.scope != "parent" && c.scope != g.id {
        diags.push(drop(format!("has non-group-local scope {}", c.scope)));
        return None;
    }
    if g.modifiers.iter().any(|m| m.field == c.id) {
        diags.push(drop("has a modifier on its limit".to_string()));
        return None;
    }
    Some(IrGroupConstraint { id: c.id.clone(), type_: c.kind.clone(), value: c.value })
}

/// Loudly drop every constraint of a nested sub-group (choose-N on nested groups
/// is out of scope), recursing so no nested limit is silently lost.
fn drop_group_constraints(g: &RawGroup, diags: &mut Vec<Diagnostic>) {
    for gc in &g.constraints {
        diags.push(Diagnostic {
            code: "group.constraint_dropped".to_string(),
            message: format!("nested selectionEntryGroup {} constraint {} has no IR representation (dropped)", g.id, gc.id),
        });
    }
    for sub in &g.groups {
        drop_group_constraints(sub, diags);
    }
}

/// Map a single raw constraint into its IR form. `target_type`/`target_id` are
/// supplied by the caller based on where the constraint is attached (entry vs.
/// force); this function only handles the field/scope translation that the
/// raw model is genuinely ambiguous about. Anything it cannot map faithfully
/// produces a diagnostic and is dropped — never emitted with a guessed value.
fn map_constraint(rc: &RawConstraint, target_type: &str, target_id: &str, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrConstraint> {
    let field = if rc.field == "selections" {
        "selections".to_string()
    } else {
        let type_name = cat.cost_types.get(&rc.field).cloned().unwrap_or_default();
        if rc.field == "pts" || type_name.to_lowercase().contains("point") {
            "points".to_string()
        } else {
            diags.push(Diagnostic {
                code: "constraint.field_unmapped".to_string(),
                message: format!("constraint {} has unmappable field {}", rc.id, rc.field),
            });
            return None;
        }
    };

    let scope = match rc.scope.as_str() {
        "parent" | "force" | "roster" | "self" => rc.scope.clone(),
        other => {
            diags.push(Diagnostic {
                code: "constraint.scope_unmapped".to_string(),
                message: format!("constraint {} has unmappable scope {}", rc.id, other),
            });
            return None;
        }
    };

    Some(IrConstraint {
        id: rc.id.clone(),
        type_: rc.kind.clone(),
        value: rc.value,
        field,
        scope,
        target_type: target_type.to_string(),
        target_id: target_id.to_string(),
        include_child_selections: rc.include_child_selections,
        modifiers: None, // Task 12
    })
}

/// Shared field-mapping rule for constraints and conditions: "selections"
/// passes through; a cost-type id that resolves to points becomes "points";
/// anything else is unmappable and produces a `<code_prefix>.field_unmapped`
/// diagnostic. `code_prefix` lets callers keep their own diagnostic codes
/// (e.g. "constraint" vs "condition") while sharing this logic.
fn map_field(field: &str, cat: &RawCatalogue, code_prefix: &str, id_for_msg: &str, diags: &mut Vec<Diagnostic>) -> Option<String> {
    if field == "selections" {
        return Some("selections".to_string());
    }
    let type_name = cat.cost_types.get(field).cloned().unwrap_or_default();
    if field == "pts" || type_name.to_lowercase().contains("point") {
        Some("points".to_string())
    } else {
        diags.push(Diagnostic {
            code: format!("{}.field_unmapped", code_prefix),
            message: format!("{} has unmappable field {}", id_for_msg, field),
        });
        None
    }
}

/// Shared scope-mapping rule for constraints and conditions: only the four
/// BattleScribe scopes engine-eval understands pass through; anything else
/// is unmappable and produces a `<code_prefix>.scope_unmapped` diagnostic.
fn map_scope(scope: &str, code_prefix: &str, id_for_msg: &str, diags: &mut Vec<Diagnostic>) -> Option<String> {
    match scope {
        "parent" | "force" | "roster" | "self" => Some(scope.to_string()),
        other => {
            diags.push(Diagnostic {
                code: format!("{}.scope_unmapped", code_prefix),
                message: format!("{} has unmappable scope {}", id_for_msg, other),
            });
            None
        }
    }
}

/// Map a single raw modifier into its IR form. RawModifier has no id, so a
/// stable one is synthesized from the owning entry and the modifier's index
/// within that entry. `has_repeats` is documented as an unsupported deferral:
/// logged via diagnostic, then the modifier is still emitted without repeat
/// semantics (never dropped outright — that would silently change costs).
fn map_modifier(m: &RawModifier, entry_id: &str, index: usize, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> IrModifier {
    if m.has_repeats {
        diags.push(Diagnostic {
            code: "modifier.repeat_unsupported".to_string(),
            message: format!("modifier {} on {} has repeats (unsupported)", index, entry_id),
        });
    }

    let conditions: Vec<IrCondition> = m.conditions.iter()
        .filter_map(|c| map_condition(c, cat, diags))
        .collect();
    let condition_groups: Vec<IrConditionGroup> = m.condition_groups.iter()
        .filter_map(|g| map_condition_group(g, cat, diags))
        .collect();

    IrModifier {
        id: format!("mod.{}.{}", entry_id, index),
        type_: m.kind.clone(),
        value: m.value,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    }
}

/// Map a single raw condition into its IR form. Unmappable comparator/field/
/// scope each produce a diagnostic and drop just this condition — dropping a
/// gating condition only ever makes the modifier's gate stricter-looking to a
/// human reader while staying functionally absent, never miscompiled as if it
/// passed. RawCondition has no id; engine-eval does not require unique
/// condition ids, so one is synthesized from the comparator and target.
fn map_condition(c: &RawCondition, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrCondition> {
    let comparator = match c.comparator.as_str() {
        "atLeast" | "atMost" | "equalTo" | "notEqualTo" | "greaterThan" | "lessThan" => c.comparator.clone(),
        other => {
            diags.push(Diagnostic {
                code: "condition.comparator_unmapped".to_string(),
                message: format!("condition on {} has unmappable comparator {}", c.child_id, other),
            });
            return None;
        }
    };

    let id_for_msg = format!("condition on {}", c.child_id);
    let field = map_field(&c.field, cat, "condition", &id_for_msg, diags)?;
    let scope = map_scope(&c.scope, "condition", &id_for_msg, diags)?;

    let target_type = if cat.categories.contains_key(&c.child_id) { "category" } else { "entry" }.to_string();

    Some(IrCondition {
        id: format!("cond.{}.{}", comparator, c.child_id),
        comparator,
        value: c.value,
        field,
        scope,
        target_type,
        target_id: c.child_id.clone(),
        include_child_selections: c.include_child_selections,
    })
}

/// Map a single raw condition group into its IR form, recursing into nested
/// groups. An unmappable `type` (only and|or are understood) diagnoses and
/// drops the whole group, including its nested conditions/groups.
fn map_condition_group(g: &RawConditionGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrConditionGroup> {
    let type_ = match g.kind.as_str() {
        "and" | "or" => g.kind.clone(),
        other => {
            diags.push(Diagnostic {
                code: "condition_group.type_unmapped".to_string(),
                message: format!("condition group has unmappable type {}", other),
            });
            return None;
        }
    };

    let conditions: Vec<IrCondition> = g.conditions.iter()
        .filter_map(|c| map_condition(c, cat, diags))
        .collect();
    let condition_groups: Vec<IrConditionGroup> = g.groups.iter()
        .filter_map(|sub| map_condition_group(sub, cat, diags))
        .collect();

    Some(IrConditionGroup {
        type_,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// A cost's IR name is "points" when it is the points cost type (id "pts" or a
/// type whose name starts with "point"); only "points" is scored by engine-eval.
fn map_cost(c: &RawCost, cat: &RawCatalogue) -> IrCost {
    let type_name = cat.cost_types.get(&c.type_id).cloned().unwrap_or_default();
    let name = if c.type_id == "pts" || type_name.to_lowercase().contains("point") {
        "points".to_string()
    } else {
        type_name
    };
    IrCost { name, value: c.value, modifiers: None }
}
