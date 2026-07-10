use crate::raw::{RawCatalogue, RawCost, RawEntry};
use crate::error::Diagnostic;
use super::model::*;

/// Map a RESOLVED raw catalogue into the domain IR. Returns diagnostics for
/// constructs the walking-skeleton mapping cannot faithfully represent.
pub fn to_ir(cat: &RawCatalogue) -> (IrCatalogue, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let entries = cat.entries.iter().map(|e| map_entry(e, cat, &mut diags)).collect();
    let ir = IrCatalogue {
        id: cat.id.clone(),
        name: cat.name.clone(),
        game_system_id: cat.game_system_id.clone().unwrap_or_default(),
        revision: cat.revision,
        entries,
        force_constraints: Vec::new(), // Task 11
    };
    (ir, diags)
}

fn map_entry(e: &RawEntry, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> IrEntry {
    IrEntry {
        id: e.id.clone(),
        name: e.name.clone(),
        costs: e.costs.iter().map(|c| map_cost(c, cat)).collect(),
        categories: e.category_links.iter().map(|l| l.target_id.clone()).collect(),
        constraints: Vec::new(), // Task 11
        children: e.entries.iter().map(|c| map_entry(c, cat, diags)).collect(),
    }
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
