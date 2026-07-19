use crate::raw::{RawCatalogue, RawCondition, RawConditionGroup, RawConstraint, RawCost, RawEntry, RawGroup, RawModifier, RawProfile};
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
        category_names: cat.categories.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        rule_texts: cat.rules.clone(),
    };
    (ir, diags)
}

/// Map a force's per-category constraints. In BattleScribe the "1-2 HQ" style
/// min/max is nested inside the categoryLink it constrains (categoryLink extends
/// ContainerEntryBase, so it carries its own <constraints>), which makes the
/// target category a structural FK — the owning link's targetId — regardless of
/// how many categoryLinks the force has. Constraints placed directly under the
/// forceEntry are force-global (no category): `targetType: "force"` (A1) sums
/// over the whole force with no category/entry filter, so these map like any
/// other constraint (e.g. 11e's army-wide "max 2 Enhancements" rule).
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
        if let Some(mapped) = map_constraint(c, "force", &force.id, cat, diags) {
            // A force-level constraint on the POINTS cost type is a BattleScribe
            // accounting/game-size sentinel (e.g. the Army Roster's inert `max 0 pts`,
            // or a sibling Crusade Force's `max 0 pts` at force scope), never a
            // matched-play rule — the real points ceiling is the roster's user-chosen
            // pointsLimit. Emitting it would flag every non-empty roster as "too many
            // pts, max 0" (the Crusade one is scope=force, so eval does evaluate it).
            // Drop it; keep every non-points force rule (e.g. "max 2 Enhancements").
            if mapped.field == "pts" || mapped.field == "points" {
                diags.push(Diagnostic {
                    code: "constraint.force_points_sentinel_skipped".to_string(),
                    message: format!(
                        "force {} constraint {} caps the points cost type ({}); dropped as a game-size sentinel",
                        force.id, mapped.id, mapped.field
                    ),
                });
                continue;
            }
            out.push(mapped);
        }
    }
    out
}

/// Normalize a raw selectionEntry `type` into the three IR-known values.
/// Unknown/empty -> None + diagnostic (entry still emitted, just without a type).
fn map_entry_type(raw: &str, entry_id: &str, diags: &mut Vec<Diagnostic>) -> Option<String> {
    match raw {
        "unit" | "upgrade" | "model" => Some(raw.to_string()),
        other => {
            diags.push(Diagnostic {
                code: "entry.type_unmapped".to_string(),
                message: format!("entry {} has unmappable type {:?}", entry_id, other),
            });
            None
        }
    }
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

    // Map groups BEFORE the modifier loop: a modifier whose `field` names a
    // constraint owned by an enclosing selectionEntryGroup (an IrGroupConstraint)
    // is routed onto it below (A2), which requires `groups` to already exist.
    let mut children: Vec<IrEntry> = e.entries.iter().map(|c| map_entry(c, cat, diags)).collect();
    let mut groups: Vec<IrGroup> = Vec::new();
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        collect_groups(g, cat, diags, &mut groups);
    }

    // Attach each raw modifier to the IR cost or constraint it targets, based
    // on where its `field` points: a known cost-type id is a cost modifier, a
    // matching constraint id is a bound modifier (the entry's own, or — failing
    // that — an enclosing group's). Neither → diagnostic + drop.
    let mut visibility_modifiers: Vec<IrVisibilityModifier> = Vec::new();
    let mut validation_rules: Vec<IrValidationRule> = Vec::new();
    let mut category_modifiers: Vec<IrCategoryModifier> = Vec::new();
    let mut characteristic_modifiers: Vec<IrCharacteristicModifier> = Vec::new();
    for (index, m) in e.modifiers.iter().enumerate() {
        if m.field == "hidden" {
            match map_visibility_modifier(m, cat) {
                Some(vm) => visibility_modifiers.push(vm),
                None => diags.push(Diagnostic {
                    code: "modifier.hidden_condition_unmapped".to_string(),
                    message: format!("hidden modifier on entry {} has an unmappable condition (dropped)", e.id),
                }),
            }
            continue;
        }
        if m.field == "error" {
            if m.kind == "add" {
                match map_validation_rule(m, cat) {
                    Some(vr) => validation_rules.push(vr),
                    None => diags.push(Diagnostic {
                        code: "modifier.error_condition_unmapped".to_string(),
                        message: format!("error modifier on entry {} has an unmappable condition (dropped)", e.id),
                    }),
                }
            } else {
                diags.push(Diagnostic {
                    code: "modifier.error_type_unsupported".to_string(),
                    message: format!("error modifier on entry {} has unsupported type {} (dropped)", e.id, m.kind),
                });
            }
            continue;
        }
        if m.field == "category" {
            match m.kind.as_str() {
                "add" | "remove" => match map_category_modifier(m, cat) {
                    Some(cm) => category_modifiers.push(cm),
                    None => diags.push(Diagnostic {
                        code: "modifier.category_condition_unmapped".to_string(),
                        message: format!("category modifier on entry {} has an unmappable condition (dropped)", e.id),
                    }),
                },
                "set-primary" => diags.push(Diagnostic {
                    code: "modifier.category_set_primary_unsupported".to_string(),
                    message: format!("set-primary category modifier on entry {} does not affect membership (dropped)", e.id),
                }),
                other => diags.push(Diagnostic {
                    code: "modifier.category_type_unsupported".to_string(),
                    message: format!("category modifier on entry {} has unsupported type {} (dropped)", e.id, other),
                }),
            }
            continue;
        }
        let ir_mod = match map_modifier(m, &e.id, index, cat, diags) {
            Some(im) => im,
            None => continue, // unsupported value kind, already diagnosed
        };
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
        } else if let Some(gc) = groups.iter_mut()
            .flat_map(|g| g.constraints.iter_mut())
            .find(|gc| gc.id == m.field)
        {
            // A2: the field names a constraint owned by an enclosing
            // selectionEntryGroup rather than the entry itself — attach to
            // that IrGroupConstraint instead of dropping.
            gc.modifiers.get_or_insert_with(Vec::new).push(ir_mod);
        } else if let Some(characteristic) = cat.characteristic_types.get(&m.field).cloned() {
            // B1: field resolves to a characteristicType (not a cost type or
            // constraint id) — a numeric set/increment/decrement modifier with a
            // parseable `affects` path is captured as an IrCharacteristicModifier
            // on this (owning) entry, faithfully carrying its UNRESOLVED target
            // spec (engine-eval resolves it against the live roster). Any other
            // kind (divide/multiply) or an unparseable/absent `affects` path
            // falls through to the same target_unmapped diagnostic as before —
            // this branch never guesses a target.
            match map_characteristic_modifier(m, &characteristic, cat, diags) {
                Some(cm) => characteristic_modifiers.push(cm),
                None => diags.push(Diagnostic {
                    code: "modifier.target_unmapped".to_string(),
                    message: format!(
                        "modifier field {} matches characteristic {} on entry {} but its kind ({}) or affects path ({:?}) is unsupported",
                        m.field, characteristic, e.id, m.kind, m.affects
                    ),
                }),
            }
        } else {
            diags.push(Diagnostic {
                code: "modifier.target_unmapped".to_string(),
                message: format!("modifier field {} matches no cost type or constraint on entry {}", m.field, e.id),
            });
        }
    }

    let profiles: Vec<IrProfile> = e.profiles.iter().map(map_profile).collect();

    IrEntry {
        id: e.id.clone(),
        name: e.name.clone(),
        entry_type: map_entry_type(&e.entry_type, &e.id, diags),
        costs,
        categories: e.category_links.iter().map(|l| l.target_id.clone()).collect(),
        constraints,
        children,
        groups,
        profiles,
        hidden: e.hidden,
        visibility_modifiers,
        validation_rules,
        category_modifiers,
        characteristic_modifiers,
    }
}

fn map_profile(p: &RawProfile) -> IrProfile {
    IrProfile {
        name: p.name.clone(),
        type_name: p.type_name.clone(),
        characteristics: p
            .characteristics
            .iter()
            .map(|c| IrCharacteristic { name: c.name.clone(), value: c.value.clone() })
            .collect(),
    }
}

/// Flatten a group's member entries (recursing sub-groups) into `out`; members
/// nested under a group are direct children of the owning entry in the IR.
///
/// A `selectionEntryGroup` can carry `field="hidden"` modifiers that gate the WHOLE
/// group's visibility (e.g. an enhancement group hidden unless its detachment is in the
/// roster). The IR has no group-level visibility node — groups are flattened away — so
/// "group hidden when C" is lowered to "each member hidden when C" by pushing the group's
/// mapped hidden gates onto every member's `visibility_modifiers`. Sub-group members also
/// inherit their ancestor groups' gates (a member is hidden if any enclosing group is).
fn flatten_group_members(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrEntry>) {
    flatten_group_members_gated(g, cat, diags, out, &[]);
}

fn flatten_group_members_gated(
    g: &RawGroup,
    cat: &RawCatalogue,
    diags: &mut Vec<Diagnostic>,
    out: &mut Vec<IrEntry>,
    inherited: &[IrVisibilityModifier],
) {
    // This group's own hidden gates, strict all-or-nothing (like entry visibility): an
    // unmappable condition drops the whole gate with a diagnostic rather than weakening
    // it (never over-hide). Accumulated with gates inherited from enclosing groups.
    let mut gates: Vec<IrVisibilityModifier> = inherited.to_vec();
    for m in &g.modifiers {
        if m.field == "hidden" {
            match map_visibility_modifier(m, cat) {
                Some(vm) => gates.push(vm),
                None => diags.push(Diagnostic {
                    code: "modifier.hidden_condition_unmapped".to_string(),
                    message: format!("hidden modifier on group {} has an unmappable condition (dropped)", g.id),
                }),
            }
        }
    }
    for child in &g.entries {
        let mut member = map_entry(child, cat, diags);
        // Append after the member's own gates: the group gate is the outer condition and
        // must win as the last-applied modifier (a hidden group hides its members).
        member.visibility_modifiers.extend(gates.iter().cloned());
        out.push(member);
    }
    for sub in &g.groups {
        flatten_group_members_gated(sub, cat, diags, out, &gates);
    }
}

/// Map a group's own choose-N (selections min/max) into an IrGroup. Its
/// members are the group's DIRECT entries only; nested sub-groups are mapped
/// separately by `collect_groups`, not dropped. Returns None when the group
/// has no mappable min/max selections limit (members are still flattened,
/// just no IrGroup emitted for this group).
fn map_group(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
    let mut constraints: Vec<IrGroupConstraint> = Vec::new();
    for c in &g.constraints {
        if let Some(gc) = map_group_constraint(c, g, cat, diags) {
            constraints.push(gc);
        }
    }
    if constraints.is_empty() {
        return None;
    }
    // Transitive member closure: a group's selections limit counts its whole
    // subtree, so include entries nested in sub-groups (e.g. the "Enhancements:
    // max 3" group whose real options live in per-detachment sub-groups). A leaf
    // group's descendants equal its direct members.
    let mut descendant_entry_ids: Vec<String> = Vec::new();
    collect_descendant_entry_ids(g, &mut descendant_entry_ids);
    // BattleScribe writes `defaultSelectionEntryId="none"` to mean "no default"; treat
    // that sentinel (and empty) as absent so downstream never seeds a non-member id.
    let default_member_entry_id = (!g.default_selection_entry_id.is_empty()
        && g.default_selection_entry_id != "none")
        .then(|| g.default_selection_entry_id.clone());
    Some(IrGroup {
        id: g.id.clone(),
        name: g.name.clone(),
        default_member_entry_id,
        member_entry_ids,
        descendant_entry_ids,
        constraints,
    })
}

/// Collect this group's direct entry members plus, recursively, those of every
/// nested sub-group — the transitive set a group's selections limit counts over.
fn collect_descendant_entry_ids(g: &RawGroup, out: &mut Vec<String>) {
    for e in &g.entries {
        out.push(e.id.clone());
    }
    for sub in &g.groups {
        collect_descendant_entry_ids(sub, out);
    }
}

/// Emit an IrGroup for `g` and every nested sub-group that carries a mappable
/// choose-N limit. Members of all levels are flattened into the owning entry's
/// children (see flatten_group_members). Each group's memberEntryIds are its
/// DIRECT entry members (for UI grouping/seeding), while descendantEntryIds is
/// the transitive closure over its sub-groups — the set engine-eval counts a
/// group's selections limit over (BattleScribe aggregates a group limit across
/// its whole subtree). So an outer group whose real options live in sub-groups
/// (e.g. "Enhancements: max 3 per army") counts those nested selections, and
/// each sub-group's own choose-N is still enforced independently. Nested
/// sub-group limits used to be dropped wholesale (`drop_group_constraints`);
/// they are now mapped like any other group.
fn collect_groups(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrGroup>) {
    if let Some(ir_group) = map_group(g, cat, diags) {
        out.push(ir_group);
    }
    for sub in &g.groups {
        collect_groups(sub, cat, diags, out);
    }
}

/// An army-wide condition scope resolves to the same army-level set no matter
/// which owner node anchors it: `roster` (and `primary-catalogue`, which the IR
/// aliases to roster) is the whole army. Owner-relative scopes (self/parent/
/// ancestor/unit/model/model-or-unit/upgrade, or a foreign entry-id) depend on a
/// specific placement, so a roster-wide group limit gated on one is ambiguous
/// (see map_group_constraint). `force` is deliberately EXCLUDED: engine-eval's
/// walking-skeleton currently collapses force to the whole roster, but the moment
/// multiple forces/detachments land it must narrow to the owning force's nodes
/// (documented in scopes.ts) — at which point a force gate becomes owner-relative
/// and this classification would be unsound. Real catalogues gate these roster
/// limits on `roster`, not `force`, so excluding it costs nothing today and keeps
/// the guard robust against that change.
fn condition_scope_is_army_wide(scope: &str) -> bool {
    matches!(scope, "roster" | "primary-catalogue")
}

/// True when every condition gating this modifier — flat and nested — is
/// army-wide. A modifier with no conditions is trivially army-wide (it changes
/// the limit unconditionally, the same for every owner).
fn modifier_gate_is_army_wide(m: &RawModifier) -> bool {
    m.conditions.iter().all(|c| condition_scope_is_army_wide(&c.scope))
        && m.condition_groups.iter().all(condition_group_is_army_wide)
}

fn condition_group_is_army_wide(g: &RawConditionGroup) -> bool {
    g.conditions.iter().all(|c| condition_scope_is_army_wide(&c.scope))
        && g.groups.iter().all(condition_group_is_army_wide)
}

/// A group choose-N limit maps when it is a selections min/max on a
/// group-local (or roster) scope. A modifier on the limit itself is now
/// strict-mapped — all-or-nothing across its kind, conditions, and repeats —
/// and attached to the constraint. The whole constraint is dropped loudly
/// (never a guessed static value) when the base, scope, or a limit modifier
/// (including any of its conditions) is unmappable, or when the scope is
/// roster and a limit modifier carries an OWNER-RELATIVE gate (see below).
fn map_group_constraint(c: &RawConstraint, g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrGroupConstraint> {
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
    // A group choose-N is normally a per-owner local count over the group's
    // direct members. Group-local scopes ("self"/"parent", or a foreign-id
    // scope naming the group itself) map that way. "roster" is also mapped,
    // as an army-wide limit enforced separately from the group-local count.
    // Any other scope (e.g. force, or a foreign id) aggregates over a
    // different set than the engine counts, so mapping it would silently
    // miscount — drop loudly instead.
    let scope = if c.scope == "self" || c.scope == "parent" || c.scope == g.id {
        "self".to_string()
    } else if c.scope == "roster" {
        "roster".to_string()
    } else {
        diags.push(drop(format!("has non-group-local scope {}", c.scope)));
        return None;
    };
    let has_limit_mod = g.modifiers.iter().any(|m| m.field == c.id);
    let modifiers = if has_limit_mod {
        // A roster-wide limit is one army rule that the engine evaluates ONCE — at
        // the first placement of a (possibly shared) group. Its limit modifier is
        // applied in that placement's node context, so a gate anchored to a single
        // owner (self/parent/ancestor/unit/model/… or a foreign entry-id scope)
        // would make the army-wide value depend on which placement was picked —
        // ambiguous. Only army-wide gates (roster/primary-catalogue, which
        // resolve to the same army-level set for every owner) map faithfully; an
        // owner-relative gate on a roster limit drops loudly. (Group-local scopes
        // are per-owner anyway, so they impose no such restriction.)
        if scope == "roster"
            && !g.modifiers.iter().filter(|m| m.field == c.id).all(modifier_gate_is_army_wide)
        {
            diags.push(drop("roster-scope limit has an owner-relative modifier gate (unsupported)".to_string()));
            return None;
        }
        let mut mapped: Vec<IrModifier> = Vec::new();
        for (index, m) in g.modifiers.iter().enumerate() {
            if m.field != c.id {
                continue;
            }
            match map_modifier_strict(m, &g.id, index, cat) {
                Some(im) => mapped.push(im),
                None => {
                    diags.push(drop("has an unmappable modifier on its limit".to_string()));
                    return None;
                }
            }
        }
        Some(mapped)
    } else {
        None
    };
    Some(IrGroupConstraint { id: c.id.clone(), type_: c.kind.clone(), value: c.value, scope, modifiers })
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
        } else if let Some(name) = cat.cost_types.get(&rc.field) {
            // A known cost type that isn't "points" (e.g. 11e's "Enhancements") —
            // emit its NAME so the eval side can sum that named cost across the
            // constraint's scope (A1: force-global cost-type constraints like the
            // army-wide "max 2 Enhancements" rule). Only a field that resolves to
            // neither "selections" nor any known cost type is truly unmappable.
            name.clone()
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
        "root-entry" | "ancestor" | "unit" | "upgrade" | "model" | "model-or-unit" => rc.scope.clone(),
        "primary-catalogue" => "roster".to_string(),
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
    // `forces` counts sub-army forces of a type. engine-eval evaluates it as 0 in our
    // forceless matched-play roster, which is exactly what makes a Crusade-force gate
    // term drop out. Mapping it (rather than dropping) is what lets a group's
    // detachment gate survive strict all-or-nothing mapping.
    if field == "forces" {
        return Some("forces".to_string());
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

/// Scope mapping for CONDITIONS (visibility + cost/constraint modifier gates).
/// Broader than `map_constraint`'s own inline scope check (which stays limited to
/// the four BattleScribe scopes engine-eval understands for constraints): adds the
/// context-dependent scopes the engine resolves against a node's ancestor chain,
/// aliases `primary-catalogue` to `roster` (single-catalogue model), and passes any
/// other value through as a FOREIGN-ID scope — the entry id of an ancestor-or-self node
/// (e.g. a unit priced by its own model count carries scope = its own entry id). The
/// engine resolves foreign-id scopes against the node's ancestor chain, so — unlike
/// before — such conditions are no longer dropped. Constraints are unaffected;
/// `map_constraint` still drops non-keyword scopes.
fn map_condition_scope(scope: &str) -> String {
    match scope {
        "primary-catalogue" => "roster".to_string(),
        // keyword scope, or a foreign-id (entry-id) scope — both pass through verbatim.
        other => other.to_string(),
    }
}

/// Map a single raw modifier into its IR form. RawModifier has no id, so a
/// stable one is synthesized from the owning entry and the modifier's index
/// within that entry. `has_repeats` is documented as an unsupported deferral:
/// logged via diagnostic, then the modifier is still emitted without repeat
/// semantics (never dropped outright — that would silently change costs).
fn map_modifier(m: &RawModifier, entry_id: &str, index: usize, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrModifier> {
    // The value engine models set/increment/decrement/divide/multiply (divide and
    // multiply cover 11e's Enhancement cost-scaling-on-reuse modifiers). Other value
    // kinds (e.g. `floor`/`ceil` clamps seen in real catalogues) have no IR form; emit
    // a diagnostic and drop just this modifier rather than passing an unknown type
    // downstream, where it would fail the domain schema and sink the whole catalogue.
    // NOTE: broader than the strict path's kind filter below (constraint LIMIT
    // modifiers stay restricted to set/increment/decrement — a divide/multiply on a
    // selection-count limit has no observed real use and partial support there would
    // risk under/over-enforcing a legality rule).
    if !matches!(m.kind.as_str(), "set" | "increment" | "decrement" | "divide" | "multiply") {
        diags.push(Diagnostic {
            code: "modifier.value_type_unsupported".to_string(),
            message: format!("value modifier on entry {} has unsupported type {} (dropped)", entry_id, m.kind),
        });
        return None;
    }

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

    Some(IrModifier {
        id: format!("mod.{}.{}", entry_id, index),
        type_: m.kind.clone(),
        value: m.value,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Strict all-or-nothing modifier mapping for constraint LIMIT modifiers.
/// Returns None (so the caller drops the whole constraint) if the modifier has
/// repeats, or if any of its conditions/condition-groups is unmappable — a
/// conditional limit whose gate is only partially represented could over- or
/// under-enforce, so we enforce it fully or not at all. Mirrors
/// `map_condition_group_strict` for visibility. Inner diagnostics are discarded;
/// the caller emits a single drop diagnostic.
fn map_modifier_strict(m: &RawModifier, owner_id: &str, index: usize, cat: &RawCatalogue) -> Option<IrModifier> {
    if m.has_repeats {
        return None;
    }
    if !matches!(m.kind.as_str(), "set" | "increment" | "decrement") {
        return None;
    }
    let mut sink: Vec<Diagnostic> = Vec::new();
    let conditions: Vec<IrCondition> = m.conditions.iter()
        .filter_map(|c| map_condition(c, cat, &mut sink))
        .collect();
    if conditions.len() != m.conditions.len() {
        return None; // at least one condition was unmappable
    }
    let mut condition_groups: Vec<IrConditionGroup> = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrModifier {
        id: format!("mod.{}.{}", owner_id, index),
        type_: m.kind.clone(),
        value: m.value,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Map a single raw condition into its IR form. Unmappable comparator/field/
/// scope each produce a diagnostic and drop just this condition — dropping a
/// gating condition only ever makes the modifier's gate stricter-looking to a
/// human reader while staying functionally absent, never miscompiled as if it
/// passed. RawCondition has no id; engine-eval does not require unique
/// condition ids, so one is synthesized from the comparator and target.
fn map_condition(c: &RawCondition, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrCondition> {
    // instanceOf / notInstanceOf are membership flags: "has >=1 instance of childId
    // in scope" / "has 0". They map onto the existing count comparators with value 1.
    let (comparator, value) = match c.comparator.as_str() {
        "atLeast" | "atMost" | "equalTo" | "notEqualTo" | "greaterThan" | "lessThan" => (c.comparator.clone(), c.value),
        "instanceOf" => ("atLeast".to_string(), 1.0),
        "notInstanceOf" => ("lessThan".to_string(), 1.0),
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
    let scope = map_condition_scope(&c.scope);

    let target_type = if cat.categories.contains_key(&c.child_id) { "category" } else { "entry" }.to_string();

    Some(IrCondition {
        id: format!("cond.{}.{}", comparator, c.child_id),
        comparator,
        value,
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

/// Strict all-or-nothing condition-group mapping for visibility gates: if any
/// nested condition or sub-group is unmappable, the whole group fails (`?`
/// propagates None) so the caller can drop the entire hidden modifier rather
/// than silently weakening the gate (which would over-hide). Diagnostics from the
/// inner attempts are discarded here; the caller emits one `hidden_condition_unmapped`.
fn map_condition_group_strict(g: &RawConditionGroup, cat: &RawCatalogue) -> Option<IrConditionGroup> {
    let type_ = match g.kind.as_str() {
        "and" | "or" => g.kind.clone(),
        _ => return None,
    };
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &g.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for sub in &g.groups {
        condition_groups.push(map_condition_group_strict(sub, cat)?);
    }
    Some(IrConditionGroup {
        type_,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Map a `field="hidden"` modifier into an IrVisibilityModifier. Returns None if
/// ANY condition/group is unmappable — the caller then drops the whole modifier
/// (never over-hide). `set` is the boolean the modifier writes to `hidden`.
fn map_visibility_modifier(m: &RawModifier, cat: &RawCatalogue) -> Option<IrVisibilityModifier> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrVisibilityModifier {
        set: m.value_raw == "true",
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Map a `field="error"` `type="add"` modifier into a validation rule. Strict
/// all-or-nothing on conditions (like map_visibility_modifier): returns None if
/// any condition/condition-group is unmappable, so the caller drops the whole
/// rule — a validation error rejects the army, so a partially-represented gate
/// must never be enforced. The message is the raw string value.
fn map_validation_rule(m: &RawModifier, cat: &RawCatalogue) -> Option<IrValidationRule> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrValidationRule {
        message: m.value_raw.clone(),
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Map a `field="category"` add/remove modifier into a category-membership rule.
/// Strict all-or-nothing on conditions (like map_validation_rule): returns None
/// (caller drops the whole modifier) if any condition/condition-group is
/// unmappable, so a partially-represented gate can never add/remove a category
/// (which could newly trip a category limit). The category id is the raw value.
fn map_category_modifier(m: &RawModifier, cat: &RawCatalogue) -> Option<IrCategoryModifier> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrCategoryModifier {
        type_: m.kind.clone(),
        category_id: m.value_raw.clone(),
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Parse a characteristic modifier's `affects` BattleScribe addressing path
/// into the pieces `IrCharacteristicModifier` needs: whether the target is the
/// scope anchor's whole subtree or just its direct children (`recursive`), an
/// optional specific descendant entry id to restrict to, and the profile
/// typeName the target profile must have. Only the documented grammar
/// `self.entries[.recursive][.<entryId>].profiles.<TypeName>` is understood
/// (per the design doc / investigation report); anything else — a bare
/// `profiles.<TypeName>` (no `self.entries` prefix, "this entry's own profile,
/// explicit" shape), a bare `<entryId>.profiles.<TypeName>`, or no `affects` at
/// all ("implicit self") — returns None. This is a deliberate first-slice
/// restriction, not a resolution step: an unparseable/unrecognized path is
/// faithfully left uncaptured (the caller drops it as `target_unmapped`, the
/// same diagnostic every characteristic modifier got before this channel
/// existed) rather than guessed.
fn parse_affects(affects: &str) -> Option<(bool, Option<String>, String)> {
    let rest = affects.strip_prefix("self.entries")?;
    let rest = rest.strip_prefix('.')?;
    let (recursive, rest) = match rest.strip_prefix("recursive.") {
        Some(r) => (true, r),
        None => (false, rest),
    };
    let (target_entry_id, profile_type) = match rest.strip_prefix("profiles.") {
        Some(type_name) => (None, type_name),
        None => {
            let idx = rest.find(".profiles.")?;
            let id = &rest[..idx];
            let type_name = &rest[idx + ".profiles.".len()..];
            (Some(id.to_string()), type_name)
        }
    };
    if profile_type.is_empty() {
        return None;
    }
    Some((recursive, target_entry_id, profile_type.to_string()))
}

/// Build a captured (UNRESOLVED — no tree-walking here) characteristic
/// modifier for a numeric `set`/`increment`/`decrement` modifier whose `field`
/// already matched a characteristicType (checked by the caller). Returns None
/// when the kind is unsupported for characteristics (`divide`/`multiply` are
/// cost-modifier-only — see `map_modifier`'s doc comment) or the `affects` path
/// doesn't match the documented grammar (`parse_affects`); the caller then
/// diagnoses the whole thing as `modifier.target_unmapped`, exactly as it did
/// before this channel existed. `append`/`replace`/`floor`/`ceil` never reach
/// here at all — `map_modifier`'s kind whitelist already drops them earlier
/// (as `modifier.value_type_unsupported`) before the caller's branching logic
/// runs. Conditions/condition-groups are mapped with the existing non-strict
/// helpers (an individually-unmappable condition is dropped, not the whole
/// modifier — mirrors `map_modifier`'s own gate handling, not the constraint-
/// limit strict path).
fn map_characteristic_modifier(
    m: &RawModifier,
    characteristic: &str,
    cat: &RawCatalogue,
    diags: &mut Vec<Diagnostic>,
) -> Option<IrCharacteristicModifier> {
    if !matches!(m.kind.as_str(), "set" | "increment" | "decrement") {
        return None;
    }
    let (recursive, target_entry_id, profile_type) = parse_affects(&m.affects)?;

    let conditions: Vec<IrCondition> = m.conditions.iter()
        .filter_map(|c| map_condition(c, cat, diags))
        .collect();
    let condition_groups: Vec<IrConditionGroup> = m.condition_groups.iter()
        .filter_map(|g| map_condition_group(g, cat, diags))
        .collect();

    Some(IrCharacteristicModifier {
        characteristic: characteristic.to_string(),
        profile_type,
        kind: m.kind.clone(),
        value: m.value_raw.clone(),
        target_scope: map_condition_scope(&m.scope),
        target_entry_id,
        recursive,
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
