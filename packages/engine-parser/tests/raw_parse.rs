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
fn entry_rules_declare_rule_names_and_text_lands_once_in_rule_texts() {
    // A selectionEntry's own <rules> is the ASSOCIATION (which entry declares
    // which rule); the TEXT still comes from the separate flat pass and must
    // not be duplicated onto the entry itself.
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="u" name="Unit" type="unit">
          <rules>
            <rule id="r1" name="R1"><description>R1 text.</description></rule>
          </rules>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    let u = cat.entries.iter().find(|e| e.id == "u").unwrap();
    assert_eq!(u.rule_names, vec!["R1".to_string()]);
    assert_eq!(cat.rules.get("R1").map(String::as_str), Some("R1 text."));
}

#[test]
fn entry_rule_names_are_deduped_in_declaration_order() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="u" name="Unit" type="unit">
          <rules>
            <rule id="r1" name="R1"><description>t1</description></rule>
            <rule id="r2" name="R2"><description>t2</description></rule>
            <rule id="r3" name="R1"><description>t1 again</description></rule>
            <rule id="r4" name=""/>
          </rules>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    let u = cat.entries.iter().find(|e| e.id == "u").unwrap();
    assert_eq!(u.rule_names, vec!["R1".to_string(), "R2".to_string()]);
}

#[test]
fn entry_without_rules_has_empty_rule_names() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let squad = raw.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert!(squad.rule_names.is_empty());
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

#[test]
fn entrylink_carries_hidden_attr_and_modifiers() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true">
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditions>
                <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.x"/>
              </conditions>
            </modifier>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = engine_parser::raw::parse_raw(xml).unwrap();
    let host = raw.entries.iter().find(|e| e.id == "host").unwrap();
    let lk = &host.entry_links[0];
    assert_eq!(lk.target_id, "shared");
    assert!(lk.hidden);
    assert_eq!(lk.modifiers.len(), 1);
    assert_eq!(lk.modifiers[0].field, "hidden");
    assert_eq!(lk.modifiers[0].conditions.len(), 1);
}

#[test]
fn empty_entrylink_has_hidden_attr_no_modifiers() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = engine_parser::raw::parse_raw(xml).unwrap();
    let host = raw.entries.iter().find(|e| e.id == "host").unwrap();
    let lk = &host.entry_links[0];
    assert!(lk.hidden);
    assert!(lk.modifiers.is_empty());
}

#[test]
fn entrylink_reads_its_own_inline_content() {
    // An entryLink is a placement, not a bare pointer: it may declare children that
    // apply only to that placement (Task E1). All eight collections must survive
    // the raw layer.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntryGroup" targetId="shared">
          <selectionEntries>
            <selectionEntry id="inline.entry" name="Inline Entry" type="upgrade"/>
          </selectionEntries>
          <selectionEntryGroups>
            <selectionEntryGroup id="inline.group" name="Inline Group"/>
          </selectionEntryGroups>
          <entryLinks>
            <entryLink id="inline.link" name="Inline Link" type="selectionEntry" targetId="other"/>
          </entryLinks>
          <constraints>
            <constraint id="inline.constraint" type="max" value="1" field="selections" scope="parent"/>
          </constraints>
          <categoryLinks>
            <categoryLink targetId="inline.category" primary="true"/>
          </categoryLinks>
          <costs>
            <cost typeId="pts" value="10"/>
          </costs>
          <profiles>
            <profile id="inline.profile" name="Inline Profile" typeName="Abilities"/>
          </profiles>
          <infoLinks>
            <infoLink targetId="inline.rule" type="rule"/>
          </infoLinks>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = engine_parser::raw::parse_raw(xml).unwrap();
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
fn reads_modifier_scope_and_affects() {
    // B1: a characteristic-modifier's BattleScribe addressing (`scope`/`affects`)
    // must survive the raw layer — both the Start (nested <conditions>) and Empty
    // (self-closing) `<modifier>` forms.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e" name="E" type="upgrade">
      <modifiers>
        <modifier type="set" field="ct.sv" value="2+" scope="model"
                  affects="self.entries.recursive.e.model.profiles.Unit"/>
        <modifier type="increment" field="ct.a" value="1" scope="self" affects="self.entries.profiles.Melee Weapons">
          <conditions>
            <condition type="atLeast" field="selections" scope="roster" value="1" childId="cat.x"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let e = raw.entries.iter().find(|e| e.id == "e").unwrap();
    assert_eq!(e.modifiers[0].scope, "model");
    assert_eq!(e.modifiers[0].affects, "self.entries.recursive.e.model.profiles.Unit");
    assert_eq!(e.modifiers[1].scope, "self");
    assert_eq!(e.modifiers[1].affects, "self.entries.profiles.Melee Weapons");
    assert_eq!(e.modifiers[1].conditions[0].child_id, "cat.x");
}

#[test]
fn reads_profile_types_characteristic_types() {
    // The characteristicType id->name decode a characteristic-modifier's
    // `field` is looked up against — nested two levels under <profileTypes>.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.m" name="M"/>
        <characteristicType id="ct.t" name="T"/>
      </characteristicTypes>
    </profileType>
    <profileType id="pt.mw" name="Melee Weapons">
      <characteristicTypes>
        <characteristicType id="ct.s" name="S"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    assert_eq!(raw.characteristic_types.get("ct.m").map(String::as_str), Some("M"));
    assert_eq!(raw.characteristic_types.get("ct.t").map(String::as_str), Some("T"));
    assert_eq!(raw.characteristic_types.get("ct.s").map(String::as_str), Some("S"));
    assert_eq!(raw.characteristic_types.len(), 3);
}

#[test]
fn reads_catalogue_level_catalogue_links() {
    // Catalogue-level <catalogueLinks> feed root import: we keep targetId and the
    // importRootEntries flag (absent => false, per BattleScribe).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <catalogueLinks>
    <catalogueLink id="l1" name="Base" targetId="base-id" type="catalogue" importRootEntries="true"/>
    <catalogueLink id="l2" name="Ally" targetId="ally-id" type="catalogue" importRootEntries="false"/>
    <catalogueLink id="l3" name="Plain" targetId="plain-id" type="catalogue"/>
  </catalogueLinks>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    assert_eq!(raw.catalogue_links.len(), 3);
    let base = raw.catalogue_links.iter().find(|l| l.target_id == "base-id").unwrap();
    assert!(base.import_root_entries);
    assert!(!raw.catalogue_links.iter().find(|l| l.target_id == "ally-id").unwrap().import_root_entries);
    assert!(!raw.catalogue_links.iter().find(|l| l.target_id == "plain-id").unwrap().import_root_entries);
}
