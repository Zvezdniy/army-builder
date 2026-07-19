use engine_parser::raw::parse_raw_json;

#[test]
fn parses_root_scalars_from_catalogue_wrapper() {
    let json = br#"{"catalogue":{"type":"catalogue","id":"cat.x","name":"X","revision":7,"gameSystemId":"gs.1"}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!((raw.id.as_str(), raw.name.as_str(), raw.revision), ("cat.x", "X", 7));
    assert_eq!(raw.game_system_id.as_deref(), Some("gs.1"));
}

#[test]
fn parses_gamesystem_wrapper_and_errors_on_neither() {
    let gs = br#"{"gameSystem":{"id":"gs.1","name":"GS","revision":2}}"#;
    assert_eq!(parse_raw_json(gs, &mut Vec::new()).unwrap().id, "gs.1");
    assert!(parse_raw_json(br#"{"other":{}}"#, &mut Vec::new()).is_err());
}
