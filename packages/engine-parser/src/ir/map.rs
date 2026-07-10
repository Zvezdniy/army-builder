use crate::raw::{RawCatalogue, RawConstraint, RawCost, RawEntry};
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
        game_system_id: cat.game_system_id.clone().unwrap_or_default(),
        revision: cat.revision,
        entries,
        force_constraints,
    };
    (ir, diags)
}

/// Map a force's constraints, deriving their targetId from the force's own
/// categoryLinks (the 40k "1-2 HQ on the force" pattern: the force entry that
/// carries the min/max is category-linked to the category it constrains).
/// Zero or multiple category links make that association ambiguous for the
/// walking skeleton, so the whole force's constraints are diagnosed and dropped
/// rather than guessed at.
fn map_force_constraints(force: &crate::raw::RawForce, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Vec<IrConstraint> {
    if force.category_links.len() != 1 {
        diags.push(Diagnostic {
            code: "constraint.force_target_ambiguous".to_string(),
            message: format!(
                "force {} constraints cannot be unambiguously associated with a category",
                force.id
            ),
        });
        return Vec::new();
    }
    let target_id = &force.category_links[0].target_id;
    force.constraints.iter()
        .filter_map(|c| map_constraint(c, "category", target_id, cat, diags))
        .collect()
}

fn map_entry(e: &RawEntry, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> IrEntry {
    IrEntry {
        id: e.id.clone(),
        name: e.name.clone(),
        costs: e.costs.iter().map(|c| map_cost(c, cat)).collect(),
        categories: e.category_links.iter().map(|l| l.target_id.clone()).collect(),
        constraints: e.constraints.iter()
            .filter_map(|c| map_constraint(c, "entry", &e.id, cat, diags))
            .collect(),
        children: e.entries.iter().map(|c| map_entry(c, cat, diags)).collect(),
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
        if rc.field == "pts" || type_name.to_lowercase().starts_with("point") {
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

/// A cost's IR name is "points" when it is the points cost type (id "pts" or a
/// type whose name starts with "point"); only "points" is scored by engine-eval.
fn map_cost(c: &RawCost, cat: &RawCatalogue) -> IrCost {
    let type_name = cat.cost_types.get(&c.type_id).cloned().unwrap_or_default();
    let name = if c.type_id == "pts" || type_name.to_lowercase().starts_with("point") {
        "points".to_string()
    } else {
        type_name
    };
    IrCost { name, value: c.value, modifiers: None }
}
