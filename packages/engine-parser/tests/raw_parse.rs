use engine_parser::raw::parse_raw;

#[test]
fn reads_header_costtypes_categories() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    assert_eq!(raw.id, "cat.mini40k");
    assert_eq!(raw.game_system_id.as_deref(), Some("gs.40k"));
    assert_eq!(raw.cost_types.get("pts").map(String::as_str), Some("Points"));
    assert_eq!(raw.categories.get("cat.hq").map(String::as_str), Some("HQ"));
}

#[test]
fn reads_entry_tree_and_forces() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let captain = raw.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert_eq!(captain.costs[0].type_id, "pts");
    assert_eq!(captain.costs[0].value, 90.0);
    assert_eq!(captain.category_links[0].target_id, "cat.hq");

    // shared entry indexed, with its nested model child parsed
    let sq_body = raw.shared_entries.iter().find(|e| e.id == "squad-body").unwrap();
    assert!(sq_body.entries.iter().any(|c| c.id == "squad-body.model"));
    assert_eq!(sq_body.constraints[0].id, "sq.models.min");
    assert_eq!(sq_body.constraints[0].kind, "min");
    assert!(sq_body.constraints[0].include_child_selections);

    // top-level squad carries the entry link (not yet inlined — that's Task 9)
    let squad = raw.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert_eq!(squad.entry_links[0].target_id, "squad-body");

    let force = &raw.force_entries[0];
    assert_eq!(force.constraints.iter().filter(|c| c.field == "selections").count(), 2);
}
