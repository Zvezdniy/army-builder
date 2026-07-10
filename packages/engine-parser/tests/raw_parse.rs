use engine_parser::raw::parse_raw;

#[test]
fn reads_header_costtypes_categories() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    assert_eq!(raw.id, "cat.mini40k");
    assert_eq!(raw.game_system_id.as_deref(), Some("gs.40k"));
    assert_eq!(raw.cost_types.get("pts").map(String::as_str), Some("Points"));
    assert_eq!(raw.categories.get("cat.hq").map(String::as_str), Some("HQ"));
}
