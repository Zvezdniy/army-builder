use engine_parser::{raw::parse_raw, resolve::resolve, ir::to_ir};

#[test]
fn maps_entries_costs_categories() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(diags.iter().all(|d| d.code == "group.constraint_dropped"), "unexpected diagnostics: {:?}", diags);
    assert_eq!(ir.id, "cat.mini40k");
    assert_eq!(ir.game_system_id, "gs.40k");
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert_eq!(cap.costs[0].name, "points");
    assert_eq!(cap.costs[0].value, 90.0);
    assert_eq!(cap.categories, vec!["cat.hq"]);
    // e.squad's entryLink was inlined by resolve(), so squad-body is a child
    let squad = ir.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert!(squad.children.iter().any(|c| c.id == "squad-body"));
}

#[test]
fn maps_force_and_entry_constraints() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(ir.force_constraints.iter().any(|c| c.id == "fc.hq.min"
        && c.target_type == "category" && c.target_id == "cat.hq" && c.type_ == "min"));
    assert!(ir.force_constraints.iter().any(|c| c.id == "fc.hq.max" && c.type_ == "max"));
    // squad-body (inlined child of e.squad) carries its self-scope min constraint
    let squad = ir.entries.iter().find(|e| e.id == "e.squad").unwrap();
    let body = squad.children.iter().find(|c| c.id == "squad-body").unwrap();
    assert!(body.constraints.iter().any(|c| c.id == "sq.models.min"
        && c.field == "selections" && c.scope == "self" && c.target_type == "entry"));
    // the fixture is fully mappable — no drop diagnostics
    assert!(diags.iter().all(|d| !d.code.starts_with("constraint.")));
}

#[test]
fn maps_cost_modifier_with_condition() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let squad = ir.entries.iter().find(|e| e.id == "e.squad").unwrap();
    let body = squad.children.iter().find(|c| c.id == "squad-body").unwrap();
    let m = &body.costs[0].modifiers.as_ref().unwrap()[0];
    assert_eq!(m.type_, "decrement");
    assert_eq!(m.value, 10.0);
    let conds = m.conditions.as_ref().unwrap();
    assert_eq!(conds[0].comparator, "atLeast");
    assert_eq!(conds[0].target_id, "cat.troops");
    assert_eq!(conds[0].target_type, "category");
    let groups = m.condition_groups.as_ref().unwrap();
    assert_eq!(groups[0].type_, "or");
    assert_eq!(groups[0].conditions.as_ref().unwrap()[0].comparator, "atMost");
}

#[test]
fn maps_group_member_entries_and_diagnoses_group_constraint() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    // the entry nested in a <selectionEntryGroup> is flattened into the parent's children
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"),
        "group member entry was dropped from the IR");
    // the group's own choose-max-1 constraint is diagnostic-dropped, never silently lost
    assert!(diags.iter().any(|d| d.code == "group.constraint_dropped"));
}
