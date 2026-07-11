use engine_parser::{raw::parse_raw, resolve::{resolve, resolve_with_diags}, ir::to_ir};
use engine_parser::ParseError;

#[test]
fn nested_unresolved_entrylink_is_tolerated() {
    // A nested entryLink whose target lives in another file must NOT crash the
    // resolve; it is diagnosed and the child dropped. This is what makes a real
    // .cat (28% of entryLinks point at the .gst) parseable.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.unit" name="Unit" type="unit">
      <costs><cost name="Points" typeId="pts" value="10"/></costs>
      <entryLinks>
        <entryLink id="l" name="Missing" type="selectionEntry" targetId="e.missing"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let mut diags = Vec::new();
    let raw = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap(); // must NOT error
    let (ir, _d) = to_ir(&raw);
    assert!(ir.entries.iter().any(|e| e.id == "e.unit"), "unit still maps");
    assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("e.missing")),
        "dangling nested link diagnosed: {:?}", diags);
}

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

/// A force with MULTIPLE categoryLinks, each carrying its own nested
/// <constraints>, is the real multi-role detachment pattern (e.g. 1-2 HQ AND
/// 3-6 Troops). Each constraint's target category is the categoryLink it is
/// nested under, so the association is unambiguous no matter how many links the
/// force has. Regression for the prior walking-skeleton behaviour that dropped
/// ALL force constraints whenever a force had more than one categoryLink.
#[test]
fn maps_force_constraints_nested_in_each_category_link() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <categoryEntries>
    <categoryEntry id="cat.hq" name="HQ"/>
    <categoryEntry id="cat.troops" name="Troops"/>
  </categoryEntries>
  <forceEntries>
    <forceEntry id="fe" name="Detachment">
      <categoryLinks>
        <categoryLink id="cl.hq" targetId="cat.hq" primary="false">
          <constraints>
            <constraint id="hq.min" type="min" value="1" field="selections" scope="force"/>
            <constraint id="hq.max" type="max" value="2" field="selections" scope="force"/>
          </constraints>
        </categoryLink>
        <categoryLink id="cl.tr" targetId="cat.troops" primary="false">
          <constraints>
            <constraint id="tr.min" type="min" value="3" field="selections" scope="force"/>
          </constraints>
        </categoryLink>
      </categoryLinks>
    </forceEntry>
  </forceEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    // No ambiguity diagnostic — the category is structural, not guessed.
    assert!(!diags.iter().any(|d| d.code == "constraint.force_target_ambiguous"),
        "unexpected ambiguity diagnostic: {:?}", diags);
    let find = |id: &str| ir.force_constraints.iter().find(|c| c.id == id)
        .unwrap_or_else(|| panic!("force constraint {} missing (dropped): {:?}", id, ir.force_constraints));
    let hq_min = find("hq.min");
    assert_eq!((hq_min.target_type.as_str(), hq_min.target_id.as_str(), hq_min.type_.as_str()), ("category", "cat.hq", "min"));
    assert_eq!(find("hq.max").target_id, "cat.hq");
    let tr_min = find("tr.min");
    assert_eq!((tr_min.target_type.as_str(), tr_min.target_id.as_str(), tr_min.type_.as_str()), ("category", "cat.troops", "min"));
    assert_eq!(ir.force_constraints.len(), 3);
}

/// A constraint placed directly under <forceEntry> (not inside a categoryLink)
/// is force-global — it has no category association. The current IR has no
/// whole-force target, so it is diagnostic-dropped, never silently lost and
/// never miscompiled onto a guessed category.
#[test]
fn diagnoses_force_global_constraint_without_category() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <forceEntries>
    <forceEntry id="fe" name="Detachment">
      <constraints>
        <constraint id="fg.max" type="max" value="2000" field="pts" scope="force"/>
      </constraints>
    </forceEntry>
  </forceEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(ir.force_constraints.is_empty(), "force-global constraint should not be emitted");
    assert!(diags.iter().any(|d| d.code == "constraint.force_global_unrepresentable"),
        "expected loud diagnostic for dropped force-global constraint: {:?}", diags);
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
fn maps_group_choose_n_and_flattens_members() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    // members are still flattened into children
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"));
    assert!(cap.children.iter().any(|c| c.id == "e.captain.axe"));
    // the group's choose-max-1 is now preserved as an IrGroup, not dropped
    let g = cap.groups.iter().find(|g| g.id == "g.wargear").unwrap();
    assert_eq!(g.name, "Wargear");
    assert_eq!(g.member_entry_ids, vec!["e.captain.sword", "e.captain.axe"]);
    assert_eq!(g.constraints.len(), 1);
    assert_eq!((g.constraints[0].id.as_str(), g.constraints[0].type_.as_str(), g.constraints[0].value),
               ("g.wargear.max", "max", 1.0));
    // fixture is fully mappable now — no group drop diagnostics
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected: {:?}", diags);
}

#[test]
fn emits_nested_group_but_drops_points_field_and_modifier_limit() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.pts" name="Pts">
          <constraints><constraint id="g.pts.max" type="max" value="30" field="pts" scope="parent"/></constraints>
          <selectionEntries><selectionEntry id="e.a" name="A" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.mod" name="Mod">
          <constraints><constraint id="g.mod.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers><modifier type="increment" field="g.mod.max" value="1"/></modifiers>
          <selectionEntries><selectionEntry id="e.b" name="B" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.outer" name="Outer">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.inner" name="Inner">
              <constraints><constraint id="g.inner.max" type="max" value="1" field="selections" scope="parent"/></constraints>
              <selectionEntries><selectionEntry id="e.c" name="C" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // The nested group's selections limit is now emitted (no longer dropped).
    let inner = u.groups.iter().find(|g| g.id == "g.inner").expect("nested group must be emitted");
    assert_eq!(inner.member_entry_ids, vec!["e.c"]);
    assert_eq!(inner.constraints.len(), 1);
    assert_eq!((inner.constraints[0].type_.as_str(), inner.constraints[0].value), ("max", 1.0));
    // g.pts (points field) and g.mod (modifier-on-limit) still produce no IrGroup.
    assert!(u.groups.iter().all(|g| g.id != "g.pts" && g.id != "g.mod"));
    assert!(u.groups.iter().all(|g| g.id != "g.outer"), "constraint-less outer group is not emitted");
    // members still flattened
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // exactly two loud drops remain: points-field and modifier-on-limit
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 2, "{:?}", diags);
}

#[test]
fn emits_group_constraint_two_levels_deep() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.l1" name="L1">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.l2" name="L2">
              <selectionEntryGroups>
                <selectionEntryGroup id="g.l3" name="L3">
                  <constraints><constraint id="g.l3.max" type="max" value="2" field="selections" scope="parent"/></constraints>
                  <selectionEntries><selectionEntry id="e.deep" name="Deep" type="upgrade"/></selectionEntries>
                </selectionEntryGroup>
              </selectionEntryGroups>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g.l3").expect("deeply nested group emitted");
    assert_eq!(g.member_entry_ids, vec!["e.deep"]);
    assert_eq!((g.constraints[0].type_.as_str(), g.constraints[0].value), ("max", 2.0));
    assert!(u.children.iter().any(|c| c.id == "e.deep"), "deep member flattened");
}

#[test]
fn nested_group_roster_scope_still_drops() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.outer" name="Outer">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.inner" name="Inner">
              <constraints><constraint id="g.inner.max" type="max" value="1" field="selections" scope="roster"/></constraints>
              <selectionEntries><selectionEntry id="e.x" name="X" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.is_empty(), "roster-scope nested limit must not map: {:?}", u.groups);
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1);
}

#[test]
fn min_and_max_group_constraints_both_map() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Loadout">
          <constraints>
            <constraint id="g.min" type="min" value="1" field="selections" scope="parent"/>
            <constraint id="g.max" type="max" value="2" field="selections" scope="parent"/>
          </constraints>
          <selectionEntries>
            <selectionEntry id="e.x" name="X" type="upgrade"/>
            <selectionEntry id="e.y" name="Y" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let g = ir.entries[0].groups.iter().find(|g| g.id == "g").unwrap();
    assert_eq!(g.constraints.len(), 2);
    assert!(g.constraints.iter().any(|c| c.type_ == "min" && c.value == 1.0));
    assert!(g.constraints.iter().any(|c| c.type_ == "max" && c.value == 2.0));
}

#[test]
fn drops_group_constraint_with_non_group_local_scope() {
    // A group choose-N is a per-owner local count; a force/roster-scoped limit
    // (an army-wide "0-1 across the whole roster" cap placed at group level)
    // aggregates over a different set than the engine counts, so mapping it as a
    // per-owner group limit would silently miscount. It must be dropped loudly.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Army-wide 0-1">
          <constraints>
            <constraint id="g.max" type="max" value="1" field="selections" scope="roster"/>
          </constraints>
          <selectionEntries>
            <selectionEntry id="e.x" name="X" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // roster-scope group limit isn't a per-owner count → no IrGroup emitted
    assert!(u.groups.is_empty(), "roster-scope group limit must not map: {:?}", u.groups);
    assert_eq!(
        diags.iter().filter(|d| d.code == "group.constraint_dropped").count(),
        1,
        "{:?}",
        diags
    );
    // member is still flattened into children
    assert!(u.children.iter().any(|c| c.id == "e.x"));
}

#[test]
fn group_with_default_emits_default_member_entry_id() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Loadout" defaultSelectionEntryId="e.def">
          <constraints>
            <constraint id="g.max" type="max" value="1" field="selections" scope="parent"/>
          </constraints>
          <selectionEntries>
            <selectionEntry id="e.def" name="Def" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let g = ir.entries[0].groups.iter().find(|g| g.id == "g").unwrap();
    assert_eq!(g.default_member_entry_id.as_deref(), Some("e.def"));
    let json = serde_json::to_value(g).unwrap();
    assert_eq!(json.get("defaultMemberEntryId").and_then(|v| v.as_str()), Some("e.def"));
}

#[test]
fn group_without_default_omits_default_member_entry_id() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Loadout">
          <constraints>
            <constraint id="g.max" type="max" value="1" field="selections" scope="parent"/>
          </constraints>
          <selectionEntries>
            <selectionEntry id="e.x" name="X" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let g = ir.entries[0].groups.iter().find(|g| g.id == "g").unwrap();
    assert_eq!(g.default_member_entry_id, None);
    let json = serde_json::to_value(g).unwrap();
    assert!(json.get("defaultMemberEntryId").is_none(), "key must be absent: {:?}", json);
}

#[test]
fn surfaces_catalogue_root_entrylinks() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.captain" name="Captain" type="unit">
      <costs><cost name="Points" typeId="pts" value="90"/></costs>
      <selectionEntries>
        <selectionEntry id="e.captain.sword" name="Sword" type="upgrade"/>
      </selectionEntries>
    </selectionEntry>
    <selectionEntry id="e.squad" name="Squad" type="unit"/>
    <selectionEntry id="e.orphan" name="Orphan" type="unit"/>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="l1" name="Captain" type="selectionEntry" targetId="e.captain"/>
    <entryLink id="l2" name="Squad" type="selectionEntry" targetId="e.squad"/>
    <entryLink id="l3" name="Missing" type="selectionEntry" targetId="e.missing"/>
  </entryLinks>
</catalogue>"#;
    let mut diags = Vec::new();
    let raw = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap();
    let (ir, map_diags) = to_ir(&raw);
    diags.extend(map_diags);
    // linked roots surface
    assert!(ir.entries.iter().any(|e| e.id == "e.captain"));
    assert!(ir.entries.iter().any(|e| e.id == "e.squad"));
    // the linked root's own subtree is inlined
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"));
    // an un-linked shared entry does NOT surface (only linked roots do)
    assert!(!ir.entries.iter().any(|e| e.id == "e.orphan"), "orphan must not surface");
    // dangling root link diagnosed
    assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("e.missing")),
        "dangling root diagnosed: {:?}", diags);
}

#[test]
fn maps_profiles_onto_ir_entries() {
    let (ir, _diags) = engine_parser::parse_bytes(
        include_bytes!("fixtures/mini40k.cat"),
        false,
    )
    .unwrap();
    let captain = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    let unit = captain.profiles.iter().find(|p| p.type_name == "Unit").unwrap();
    assert_eq!(unit.name, "Captain");
    let m = unit.characteristics.iter().find(|c| c.name == "M").unwrap();
    assert_eq!(m.value, "6\"");
    assert!(captain.profiles.iter().any(|p| p.type_name == "Abilities"));

    // the wargear weapon profile is on the flattened child entry
    let sword = captain.children.iter().find(|e| e.id == "e.captain.sword").unwrap();
    assert_eq!(sword.profiles[0].type_name, "Melee Weapons");
}

#[test]
fn emits_category_names_and_rule_texts() {
    let cat = engine_parser::raw::RawCatalogue {
        id: "c".into(), name: "C".into(), game_system_id: Some("g".into()), revision: 1,
        categories: std::collections::HashMap::from([("cat.hq".to_string(), "HQ".to_string())]),
        rules: std::collections::BTreeMap::from([("Pistol".to_string(), "text".to_string())]),
        ..Default::default()
    };
    let (ir, _diags) = engine_parser::ir::to_ir(&cat);
    let v = serde_json::to_value(&ir).unwrap();
    assert_eq!(v["categoryNames"]["cat.hq"], "HQ");
    assert_eq!(v["ruleTexts"]["Pistol"], "text");
}

#[test]
fn omits_empty_category_and_rule_maps() {
    let cat = engine_parser::raw::RawCatalogue {
        id: "c".into(), name: "C".into(), game_system_id: Some("g".into()), revision: 1,
        ..Default::default()
    };
    let (ir, _diags) = engine_parser::ir::to_ir(&cat);
    let v = serde_json::to_value(&ir).unwrap();
    assert!(v.get("categoryNames").is_none());
    assert!(v.get("ruleTexts").is_none());
}

#[test]
fn maps_hidden_modifier_with_instance_of_roster_scope() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade" hidden="false">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditions>
            <condition type="notInstanceOf" value="1" field="selections" scope="roster" childId="cat.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert!(!e.hidden);
    assert_eq!(e.visibility_modifiers.len(), 1);
    let vm = &e.visibility_modifiers[0];
    assert!(vm.set);
    let c = &vm.conditions.as_ref().unwrap()[0];
    assert_eq!((c.comparator.as_str(), c.value), ("lessThan", 1.0)); // notInstanceOf -> lessThan 1
    assert_eq!(c.scope, "roster");
    // hidden modifiers are NOT reported as target_unmapped
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"));
}

#[test]
fn drops_hidden_modifier_with_unsupported_scope() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditionGroups><conditionGroup type="or"><conditions>
            <condition type="instanceOf" value="1" field="selections" scope="root-entry" childId="cat.x"/>
          </conditions></conditionGroup></conditionGroups>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // unsupported scope -> whole modifier dropped, entry stays visible
    assert!(e.visibility_modifiers.is_empty());
    assert!(!e.hidden);
    assert!(diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped"));
}

#[test]
fn reads_static_hidden_attribute() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.h" name="H" type="upgrade" hidden="true"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.h").unwrap();
    assert!(e.hidden);
}

#[test]
fn hidden_modifier_instance_of_maps_to_at_least_one() {
    // Positive path: instanceOf must survive into an emitted condition as (atLeast, 1).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="set" value="false" field="hidden">
          <conditions>
            <condition type="instanceOf" value="1" field="selections" scope="roster" childId="cat.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    let vm = &e.visibility_modifiers[0];
    assert!(!vm.set, "set hidden=false (reveal) must map to set=false");
    let c = &vm.conditions.as_ref().unwrap()[0];
    assert_eq!((c.comparator.as_str(), c.value), ("atLeast", 1.0));
}

#[test]
fn drops_hidden_modifier_with_parent_scope() {
    // parent scope maps for cost/constraint conditions, but NOT for visibility:
    // hidden is evaluated on a parentless synthetic node where parent collapses to
    // self and would over-hide. It must drop the whole modifier → entry visible.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditions>
            <condition type="notInstanceOf" value="1" field="selections" scope="parent" childId="cat.x"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(e.visibility_modifiers.is_empty(), "parent-scoped hidden gate must be dropped");
    assert!(!e.hidden);
    assert!(diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped"));
}

#[test]
fn hidden_modifier_partial_or_group_drops_whole_modifier() {
    // Never over-hide: an `or` group with one mappable + one unmappable (root-entry
    // scope) condition must drop the ENTIRE modifier, not keep the mappable sibling.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditionGroups><conditionGroup type="or"><conditions>
            <condition type="instanceOf" value="1" field="selections" scope="roster" childId="cat.ok"/>
            <condition type="instanceOf" value="1" field="selections" scope="root-entry" childId="cat.bad"/>
          </conditions></conditionGroup></conditionGroups>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(e.visibility_modifiers.is_empty(), "partial-map gate must drop the whole modifier");
    assert!(diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped"));
}

#[test]
fn root_entrylink_into_cycle_is_typed_error() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.a" name="A" type="unit">
      <entryLinks><entryLink id="la" name="A" type="selectionEntry" targetId="e.a"/></entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks><entryLink id="root" name="A" type="selectionEntry" targetId="e.a"/></entryLinks>
</catalogue>"#;
    let mut diags = Vec::new();
    let res = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags);
    assert!(matches!(res, Err(ParseError::ReferenceCycle(_))), "expected cycle error, got {:?}", res);
}
