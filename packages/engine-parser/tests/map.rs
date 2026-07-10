use engine_parser::{raw::parse_raw, resolve::resolve, ir::to_ir};

#[test]
fn maps_entries_costs_categories() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(diags.is_empty());
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
