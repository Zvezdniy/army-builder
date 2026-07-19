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

#[test]
fn maps_costtypes_categories_and_nested_rules() {
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "costTypes":[{"id":"pts","name":"pts"},{"id":"dp","name":"Detachment Points"}],
      "categoryEntries":[{"id":"cat.hq","name":"HQ"}],
      "sharedRules":[{"id":"r1","name":"Oath","alias":"","description":"Re-roll hits."}],
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "rules":[{"id":"r2","name":"Deep Strike","alias":"","description":"Arrive from reserves."}]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!(raw.cost_types.get("dp").map(String::as_str), Some("Detachment Points"));
    assert_eq!(raw.categories.get("cat.hq").map(String::as_str), Some("HQ"));
    assert_eq!(raw.rules.get("Oath").map(String::as_str), Some("Re-roll hits."));
    assert_eq!(raw.rules.get("Deep Strike").map(String::as_str), Some("Arrive from reserves."));
}

#[test]
fn rule_without_description_is_skipped_matching_xml() {
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "rules":[
        {"id":"r1","name":"Oath","description":"Re-roll hits."},
        {"id":"r2","name":"Stealth"}
      ]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!(raw.rules.get("Oath"), Some(&"Re-roll hits.".to_string()));
    assert!(raw.rules.get("Stealth").is_none());
}
