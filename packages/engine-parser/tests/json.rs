use engine_parser::parse_system_files;
use engine_parser::raw::parse_raw_json;
use std::path::Path;

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

#[test]
fn maps_full_entry_tree_with_links_groups_and_associations_drop() {
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "catalogueLinks":[{"targetId":"lib.1","importRootEntries":true}],
      "sharedSelectionEntries":[{"id":"e.w","name":"Bolter","type":"upgrade",
        "costs":[{"typeId":"pts","value":5}],"associations":[{"x":1}]}],
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "categoryLinks":[{"targetId":"cat.hq","primary":true}],
        "constraints":[{"id":"c1","type":"max","value":1,"field":"selections","scope":"parent"}],
        "selectionEntryGroups":[{"id":"g","name":"Wargear",
          "constraints":[{"id":"g.max","type":"max","value":1,"field":"selections","scope":"parent"}],
          "entryLinks":[{"id":"l1","targetId":"e.w","type":"selectionEntry"}]}]}],
      "forceEntries":[{"id":"f","name":"Army",
        "constraints":[{"id":"fc","type":"min","value":1,"field":"selections","scope":"force"}],
        "categoryLinks":[{"targetId":"cat.hq","primary":false}]}]}}"#;
    let mut diags = Vec::new();
    let raw = parse_raw_json(json, &mut diags).unwrap();
    assert_eq!(raw.catalogue_links[0].target_id, "lib.1");
    assert!(raw.catalogue_links[0].import_root_entries);
    assert_eq!(raw.shared_entries[0].costs[0].value, 5.0);
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.category_links[0].target_id, "cat.hq");
    assert_eq!(u.constraints[0].kind, "max");
    let g = &u.groups[0];
    assert_eq!(g.entry_links[0].target_id, "e.w");
    assert_eq!((raw.force_entries[0].name.as_str(), raw.force_entries[0].constraints[0].kind.as_str()), ("Army", "min"));
    assert!(diags.iter().any(|d| d.code == "entry.associations_dropped" && d.message.contains("e.w")));
}

#[test]
fn xml_and_json_produce_identical_ir() {
    let (xml_ir, _) = engine_parser::parse_file(Path::new("tests/fixtures/parity/twin.cat"), None).unwrap();
    let (json_ir, _) = engine_parser::parse_file(Path::new("tests/fixtures/parity/twin.json"), None).unwrap();
    assert_eq!(
        serde_json::to_value(&xml_ir).unwrap(),
        serde_json::to_value(&json_ir).unwrap(),
        "JSON front-end must produce IR identical to the XML front-end",
    );
}

#[test]
fn parse_system_files_reads_json_faction_plus_gamesystem() {
    let (ir, diags) = parse_system_files(
        Path::new("tests/fixtures/mini11e.catalogue.json"),
        &[Path::new("tests/fixtures/mini11e.gamesystem.json")],
        None,
    )
    .unwrap();
    // The Captain surfaces as a root with its HQ category and points cost.
    let cap = ir.entries.iter().find(|e| e.id == "e.cap").expect("captain root");
    assert!(cap.children.iter().any(|c| c.id == "e.sword"));
    let wg = cap.groups.iter().find(|g| g.id == "g.wg").expect("wargear group emitted");
    assert_eq!(wg.constraints.len(), 1);
    assert!(!diags.iter().any(|d| d.code == "entry.associations_dropped"));
}
