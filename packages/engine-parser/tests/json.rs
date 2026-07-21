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
fn entry_rules_declare_rule_names_and_text_lands_once_in_rule_texts() {
    // Mirrors tests/raw_parse.rs's XML twin: JsonEntry.rules already
    // deserializes for collect_rules (TEXT); this asserts the names also land
    // on the mapped RawEntry (the ASSOCIATION), deduped in declaration order.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"u","name":"Unit","type":"unit",
        "rules":[
          {"id":"r1","name":"R1","description":"R1 text."},
          {"id":"r2","name":"R2","description":"t2"},
          {"id":"r3","name":"R1","description":"R1 text again."},
          {"id":"r4","name":""}
        ]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "u").unwrap();
    assert_eq!(u.rule_names, vec!["R1".to_string(), "R2".to_string()]);
    assert_eq!(raw.rules.get("R1").map(String::as_str), Some("R1 text again."));
}

#[test]
fn rule_alias_as_array_is_indexed_by_each_alias() {
    // Real wh40k-11e BSData encodes a rule's `alias` as an array of strings
    // (e.g. `"alias": ["PISTOL"]`), not a plain string like the mini
    // fixtures above. This is the true root cause of the real SM 11e parse
    // failure: `invalid type: sequence, expected a string` at the `alias`
    // field of `gameSystem.sharedRules[0]`.
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "sharedRules":[{"id":"r1","name":"Pistol","alias":["PISTOL","SIDEARM"],
        "description":"Pistol rules text."}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!(raw.rules.get("Pistol").map(String::as_str), Some("Pistol rules text."));
    assert_eq!(raw.rules.get("PISTOL").map(String::as_str), Some("Pistol rules text."));
    assert_eq!(raw.rules.get("SIDEARM").map(String::as_str), Some("Pistol rules text."));
}

#[test]
fn modifier_groups_flatten_into_owning_entry_modifiers_with_group_conditions_anded() {
    // Mirrors the real shape found around line 6117 of the wh40k-11e Space
    // Marines catalogue: a `selectionEntry` with `modifierGroups`, each
    // group holding one or more `modifiers`, one of which carries a
    // `repeats` array (a rare per-modifier-group repeat, as well as a
    // per-modifier repeat) and `conditionGroups`.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "modifierGroups":[{
          "type":"and",
          "conditions":[{"type":"atLeast","value":1,"field":"selections","scope":"self",
            "childId":"child.1","shared":true,"includeChildSelections":true}],
          "modifiers":[
            {"type":"set","value":6,"field":"target.1",
              "conditionGroups":[{"type":"or","conditions":[
                {"type":"instanceOf","value":1,"field":"selections","scope":"self",
                  "childId":"child.2","shared":true,"includeChildSelections":true}]}]},
            {"type":"increment","value":2,"field":"target.2",
              "repeats":[{"value":1,"repeats":1,"field":"selections","scope":"self",
                "childId":"child.3","shared":true,"roundUp":false,"includeChildSelections":true}]}
          ]
        }]}]}}"#;
    let mut diags = Vec::new();
    let raw = parse_raw_json(json, &mut diags).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.modifiers.len(), 2, "both modifiers from the modifierGroup land on the owning entry");

    let set_mod = u.modifiers.iter().find(|m| m.field == "target.1").unwrap();
    assert_eq!(set_mod.kind, "set");
    // The modifierGroup's own condition is ANDed onto the modifier's own conditions.
    assert!(set_mod.conditions.iter().any(|c| c.child_id == "child.1"));
    assert_eq!(set_mod.condition_groups.len(), 1);
    assert_eq!(set_mod.condition_groups[0].conditions[0].child_id, "child.2");

    let inc_mod = u.modifiers.iter().find(|m| m.field == "target.2").unwrap();
    assert_eq!(inc_mod.kind, "increment");
    assert!(inc_mod.has_repeats, "the modifier's own repeats array is preserved through flattening");
    assert!(inc_mod.conditions.iter().any(|c| c.child_id == "child.1"), "group condition still ANDed on");
}

#[test]
fn alias_null_is_treated_as_no_alias() {
    // Real BSData sometimes encodes `alias` as explicit JSON `null` rather
    // than omitting the key or using a string/array. This must not crash
    // `string_or_string_seq` the way an array once crashed a `String`-typed
    // field (the bug fixed in bef0350) — null should mean "no alias".
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "rules":[{"id":"r","name":"N","alias":null,"description":"d"}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!(raw.rules.get("N").map(String::as_str), Some("d"));
    assert_eq!(raw.rules.len(), 1, "no extra alias key inserted for a null alias");
}

#[test]
fn modifier_group_or_type_emits_diagnostic() {
    // Every modifierGroup observed in real wh40k-11e data uses "type":"and",
    // but the reader must not silently mis-flatten a non-"and" group (that
    // would widen OR semantics into AND). It should still flatten as AND
    // (best-effort) while loudly diagnosing the unsupported type.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "modifierGroups":[{
          "type":"or",
          "modifiers":[{"type":"set","value":6,"field":"target.1"}]
        }]}]}}"#;
    let mut diags = Vec::new();
    let raw = parse_raw_json(json, &mut diags).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.modifiers.len(), 1, "still flattened as AND (best-effort)");
    assert!(
        diags.iter().any(|d| d.code == "modifier_group.non_and_unsupported" && d.message.contains("or")),
        "expected a diagnostic naming the unsupported type; got {diags:?}"
    );
}

#[test]
fn modifier_group_conditions_and_condition_groups_both_anded_onto_each_modifier() {
    // A modifierGroup can carry BOTH group-level `conditions` and group-level
    // `conditionGroups` at once (seen in Leagues of Votann, Imperial Knights
    // Library, Necrons, Thousand Sons) — both must be ANDed onto every
    // flattened child modifier's respective lists.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "modifierGroups":[{
          "type":"and",
          "conditions":[{"type":"atLeast","value":1,"field":"selections","scope":"self",
            "childId":"child.1"}],
          "conditionGroups":[{"type":"or","conditions":[
            {"type":"instanceOf","value":1,"field":"selections","scope":"self","childId":"child.9"}]}],
          "modifiers":[
            {"type":"set","value":6,"field":"target.1"},
            {"type":"increment","value":2,"field":"target.2"}
          ]
        }]}]}}"#;
    let mut diags = Vec::new();
    let raw = parse_raw_json(json, &mut diags).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.modifiers.len(), 2);
    for m in &u.modifiers {
        assert!(m.conditions.iter().any(|c| c.child_id == "child.1"), "group-level conditions anded on");
        assert_eq!(m.condition_groups.len(), 1, "group-level conditionGroups anded on");
        assert_eq!(m.condition_groups[0].conditions[0].child_id, "child.9");
    }
}

#[test]
fn reads_modifier_scope_affects_and_profile_types() {
    // B1: JSON front-end parity for scope/affects capture and the
    // profileTypes->characteristicTypes id->name decode map.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "profileTypes":[{"id":"pt.unit","name":"Unit","characteristicTypes":[{"id":"ct.sv","name":"Sv"}]}],
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "modifiers":[{"type":"set","field":"ct.sv","value":"2+","scope":"model",
          "affects":"self.entries.recursive.e.model.profiles.Unit"}]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!(raw.characteristic_types.get("ct.sv").map(String::as_str), Some("Sv"));
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.modifiers[0].scope, "model");
    assert_eq!(u.modifiers[0].affects, "self.entries.recursive.e.model.profiles.Unit");
    assert_eq!(u.modifiers[0].value_raw, "2+");
}

#[test]
fn entrylink_reads_its_own_inline_content() {
    // Mirrors tests/raw_parse.rs::entrylink_reads_its_own_inline_content: an
    // entryLink is a placement, not a bare pointer, and may declare children that
    // apply only to that placement (Task E1). All eight collections must survive
    // the JSON front-end too.
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"host","name":"Host","type":"unit",
        "entryLinks":[{"id":"lk","targetId":"shared","type":"selectionEntryGroup",
          "selectionEntries":[{"id":"inline.entry","name":"Inline Entry","type":"upgrade"}],
          "selectionEntryGroups":[{"id":"inline.group","name":"Inline Group"}],
          "entryLinks":[{"id":"inline.link","targetId":"other","type":"selectionEntry"}],
          "constraints":[{"id":"inline.constraint","type":"max","value":1,"field":"selections","scope":"parent"}],
          "categoryLinks":[{"targetId":"inline.category","primary":true}],
          "costs":[{"typeId":"pts","value":10}],
          "profiles":[{"id":"inline.profile","name":"Inline Profile","typeName":"Abilities"}],
          "infoLinks":[{"targetId":"inline.rule","type":"rule"}]
        }]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    let host = raw.entries.iter().find(|e| e.id == "host").unwrap();
    let lk = &host.entry_links[0];
    assert_eq!(lk.entries.len(), 1);
    assert_eq!(lk.entries[0].id, "inline.entry");
    assert_eq!(lk.groups.len(), 1);
    assert_eq!(lk.groups[0].id, "inline.group");
    assert_eq!(lk.entry_links.len(), 1);
    assert_eq!(lk.entry_links[0].id, "inline.link");
    assert_eq!(lk.constraints.len(), 1);
    assert_eq!(lk.constraints[0].id, "inline.constraint");
    assert_eq!(lk.category_links.len(), 1);
    assert_eq!(lk.category_links[0].target_id, "inline.category");
    assert_eq!(lk.costs.len(), 1);
    assert_eq!(lk.costs[0].type_id, "pts");
    assert_eq!(lk.costs[0].value, 10.0);
    assert_eq!(lk.profiles.len(), 1);
    assert_eq!(lk.profiles[0].id, "inline.profile");
    assert_eq!(lk.info_links.len(), 1);
    assert_eq!(lk.info_links[0].target_id, "inline.rule");
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

    // Finding 4: the equality check above is vacuous against a change that drops
    // the SAME link-carried collections from both front-ends at once. Assert the
    // fixture's link content (`twin.cat`/`twin.json`'s entryLink `lnk.s` ->
    // `e.shared`, nested under `e.u`) actually reached the IR, in each front-end
    // independently: the nested-link entry `e.nested`, the link's own inline
    // profile `p.linkprofile`, and the link's infoLink-resolved profile `p.inv`.
    for (front_end, ir) in [("xml", &xml_ir), ("json", &json_ir)] {
        let u = ir.entries.iter().find(|e| e.id == "e.u").expect("e.u root");
        // Task 2: both syntaxes declare the same rule ("Leader") on e.u — the
        // ASSOCIATION lands on ruleNames, and its TEXT lands once in ruleTexts,
        // not duplicated onto the entry.
        assert_eq!(u.rule_names, vec!["Leader".to_string()], "{front_end}: e.u.ruleNames");
        assert_eq!(
            ir.rule_texts.get("Leader").map(String::as_str),
            Some("May be attached to a Troops unit."),
            "{front_end}: rule text in ruleTexts"
        );
        let clone = u.children.iter().find(|e| e.id == "e.shared").unwrap_or_else(|| {
            panic!("{front_end}: e.shared clone missing from e.u's children")
        });
        assert!(clone.children.iter().any(|c| c.id == "e.nested"),
            "{front_end}: the link's nested entryLink target e.nested did not reach the IR");
        // IrProfile drops the source id (name/typeName/characteristics only), so
        // match on name — "Link Profile" (p.linkprofile) and "Invulnerable Save"
        // (p.inv, via the link's infoLink) are each unique in this fixture.
        assert!(clone.profiles.iter().any(|p| p.name == "Link Profile"),
            "{front_end}: the link's own inline profile p.linkprofile did not reach the IR");
        assert!(clone.profiles.iter().any(|p| p.name == "Invulnerable Save"),
            "{front_end}: the link's infoLink-resolved profile p.inv did not reach the IR");
    }
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

#[test]
fn info_link_name_round_trips() {
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,"gameSystemId":"gs",
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "infoLinks":[{"id":"l","name":"The Blood of Martyrs","type":"rule","targetId":"r1"}]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.info_links.len(), 1);
    assert_eq!(u.info_links[0].name, "The Blood of Martyrs");
    assert_eq!(u.info_links[0].link_type, "rule");
}
