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

    // The force's 1-2 HQ min/max are nested inside the HQ categoryLink (the real
    // BattleScribe pattern), not as direct forceEntry children.
    let force = &raw.force_entries[0];
    let hq_link = force.category_links.iter().find(|l| l.target_id == "cat.hq").unwrap();
    assert_eq!(hq_link.constraints.iter().filter(|c| c.field == "selections").count(), 2);
    assert!(force.constraints.is_empty());
}

#[test]
fn colliding_named_container_does_not_drop_siblings() {
    // A nested container sharing its parent's tag name must not cause the parser to
    // return early and silently drop following siblings (was a data-loss bug).
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntries></selectionEntries>
    <selectionEntry id="e.smuggled" name="Smuggled" type="model">
      <costs><cost typeId="pts" value="5"/></costs>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    assert!(raw.entries.iter().any(|e| e.id == "e.smuggled"),
        "sibling after a name-colliding nested container was dropped");
}

#[test]
fn reads_modifiers_and_conditions() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let squad = raw.shared_entries.iter().find(|e| e.id == "squad-body").unwrap();
    let m = &squad.modifiers[0];
    assert_eq!(m.kind, "decrement");
    assert_eq!(m.field, "pts");
    assert_eq!(m.value, 10.0);
    assert_eq!(m.conditions[0].comparator, "atLeast");
    assert_eq!(m.conditions[0].value, 3.0);
    assert_eq!(m.conditions[0].child_id, "cat.troops");
    assert_eq!(m.condition_groups[0].kind, "or");
    assert_eq!(m.condition_groups[0].conditions[0].comparator, "atMost");
}

#[test]
fn reads_group_default_selection_entry_id() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
 <sharedSelectionEntries>
  <selectionEntry id="u" name="U" type="unit">
   <selectionEntryGroups>
    <selectionEntryGroup id="g" name="G" defaultSelectionEntryId="e.def">
     <selectionEntries>
      <selectionEntry id="e.def" name="Def" type="upgrade"/>
     </selectionEntries>
     <constraints>
      <constraint type="max" value="1" field="selections" scope="parent" id="c1"/>
     </constraints>
    </selectionEntryGroup>
   </selectionEntryGroups>
  </selectionEntry>
 </sharedSelectionEntries>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let unit = raw.shared_entries.iter().find(|e| e.id == "u").unwrap();
    let group = unit.groups.iter().find(|g| g.id == "g").unwrap();
    assert_eq!(group.default_selection_entry_id, "e.def");
}

#[test]
fn reads_catalogue_level_entry_links() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.unit" name="Unit" type="unit"/>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="l1" name="Unit" type="selectionEntry" targetId="e.unit"/>
    <entryLink id="l2" name="Missing" type="selectionEntry" targetId="e.missing"/>
  </entryLinks>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let targets: Vec<&str> = raw.entry_links.iter().map(|l| l.target_id.as_str()).collect();
    assert_eq!(targets, vec!["e.unit", "e.missing"]);
}

#[test]
fn reads_profiles_with_characteristics() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.hero" name="Hero" type="model">
      <profiles>
        <profile id="p.u" name="Hero" typeName="Unit">
          <characteristics>
            <characteristic name="M">6&quot;</characteristic>
            <characteristic name="T">4</characteristic>
          </characteristics>
        </profile>
      </profiles>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.w" name="Wargear">
          <selectionEntries>
            <selectionEntry id="e.sword" name="Sword" type="upgrade">
              <profiles>
                <profile id="p.s" name="Sword" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="AP">-2</characteristic>
                  </characteristics>
                </profile>
              </profiles>
            </selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let hero = raw.entries.iter().find(|e| e.id == "e.hero").unwrap();
    let unit = hero.profiles.iter().find(|p| p.type_name == "Unit").unwrap();
    assert_eq!(unit.name, "Hero");
    assert_eq!(unit.characteristics[0].name, "M");
    assert_eq!(unit.characteristics[0].value, "6\"", "XML entity unescaped");
    assert_eq!(unit.characteristics[1].value, "4");

    // profile nested inside a selectionEntryGroup is read on the group's entry
    let group = hero.groups.iter().find(|g| g.id == "g.w").unwrap();
    let sword = group.entries.iter().find(|e| e.id == "e.sword").unwrap();
    let mp = &sword.profiles[0];
    assert_eq!(mp.type_name, "Melee Weapons");
    assert_eq!(mp.characteristics[0].value, "Melee");
    assert_eq!(mp.characteristics[1].value, "-2");
}

#[test]
fn reads_nested_rule_by_name_and_alias() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="u" name="Unit" type="unit">
          <rules>
            <rule id="r1" name="Pistol">
              <description>Can shoot in Engagement.</description>
              <alias>PISTOL</alias>
            </rule>
          </rules>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    assert_eq!(cat.rules.get("Pistol").map(String::as_str), Some("Can shoot in Engagement."));
    assert_eq!(cat.rules.get("PISTOL").map(String::as_str), Some("Can shoot in Engagement."));
}

#[test]
fn reads_hidden_attr_and_modifier_value_raw() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="e" name="E" type="upgrade" hidden="true">
          <modifiers><modifier type="set" value="true" field="hidden"/></modifiers>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    let e = cat.entries.iter().find(|e| e.id == "e").unwrap();
    assert!(e.hidden);
    assert_eq!(e.modifiers[0].value_raw, "true");
}

#[test]
fn rule_without_description_is_skipped() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <sharedRules>
        <rule id="r2" name="Empty"/>
        <rule id="r3" name="HasText"><description>&quot;quoted&quot; text</description></rule>
      </sharedRules>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    assert!(!cat.rules.contains_key("Empty"));
    assert_eq!(cat.rules.get("HasText").map(String::as_str), Some("\"quoted\" text"));
}
