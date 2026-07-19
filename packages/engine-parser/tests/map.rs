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
/// is force-global — no category, but the IR's `targetType: "force"` (A1) now
/// represents "sum over the whole force" directly, so it is mapped, not dropped.
/// (Regression guard for the walking-skeleton behaviour this replaces: such a
/// constraint used to be diagnostic-dropped with no IR representation.)
/// Uses field="selections" (not a points/pts cost type) so this exercises the
/// force-global mapping mechanism in isolation from the points-sentinel skip
/// covered separately by `skips_force_global_points_sentinel_constraint`.
#[test]
fn maps_force_global_constraint_with_force_target_type() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <forceEntries>
    <forceEntry id="fe" name="Detachment">
      <constraints>
        <constraint id="fg.max" type="max" value="20" field="selections" scope="force"/>
      </constraints>
    </forceEntry>
  </forceEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let c = ir.force_constraints.iter().find(|c| c.id == "fg.max")
        .unwrap_or_else(|| panic!("force-global constraint fg.max missing (dropped): {:?}", ir.force_constraints));
    assert_eq!(c.target_type, "force");
    assert_eq!(c.target_id, "fe");
    assert_eq!(c.field, "selections");
    assert_eq!(c.scope, "force");
    assert_eq!(c.value, 20.0);
    assert!(!diags.iter().any(|d| d.code == "constraint.force_global_unrepresentable"),
        "force-global constraint should no longer be diagnosed as unrepresentable: {:?}", diags);
}

/// The 11e "max 2 Enhancements" rule: a forceEntry-direct `max 2` constraint whose
/// field is a cost-type id (not "selections"/"pts") must map to that cost type's
/// NAME (from `cat.cost_types`), not drop as `field_unmapped`.
#[test]
fn maps_force_global_enhancements_cost_type_constraint() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes>
    <costType id="ct.enh" name="Enhancements"/>
  </costTypes>
  <forceEntries>
    <forceEntry id="fe.army" name="Army Roster">
      <constraints>
        <constraint id="fc.max2enh" type="max" value="2" field="ct.enh" scope="force"/>
      </constraints>
    </forceEntry>
  </forceEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let c = ir.force_constraints.iter().find(|c| c.id == "fc.max2enh")
        .unwrap_or_else(|| panic!("force constraint fc.max2enh missing (dropped): {:?}", ir.force_constraints));
    assert_eq!(c.field, "Enhancements");
    assert_eq!(c.scope, "force");
    assert_eq!(c.target_type, "force");
    assert_eq!(c.value, 2.0);
    assert!(!diags.iter().any(|d| d.code == "constraint.field_unmapped"),
        "cost-type field should map to its name, not drop: {:?}", diags);
    assert!(!diags.iter().any(|d| d.code == "constraint.force_global_unrepresentable"),
        "force-global constraint should no longer be diagnosed as unrepresentable: {:?}", diags);
}

/// A force-level constraint whose mapped field is the POINTS cost type (e.g. a
/// sibling Crusade Force's `max 0 pts` at scope=force) is a BattleScribe
/// accounting/game-size sentinel, not a matched-play rule — mapping it would
/// flag every non-empty roster as "too many pts, max 0". It must be skipped
/// (not emitted into forceConstraints) with a
/// `constraint.force_points_sentinel_skipped` diagnostic, while a sibling
/// non-points force constraint on the same forceEntry (e.g. "max 2
/// Enhancements") still maps normally.
#[test]
fn skips_force_global_points_sentinel_constraint() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes>
    <costType id="pts" name="pts"/>
    <costType id="ct.enh" name="Enhancements"/>
  </costTypes>
  <forceEntries>
    <forceEntry id="fe.crusade" name="Crusade Force">
      <constraints>
        <constraint id="fc.pts.sentinel" type="max" value="0" field="pts" scope="force"/>
        <constraint id="fc.max2enh" type="max" value="2" field="ct.enh" scope="force"/>
      </constraints>
    </forceEntry>
  </forceEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    // the points sentinel is NOT emitted into forceConstraints
    assert!(
        !ir.force_constraints.iter().any(|c| c.id == "fc.pts.sentinel"),
        "points-sentinel force constraint must be dropped: {:?}",
        ir.force_constraints
    );
    // ...and a diagnostic fires for it
    assert!(
        diags.iter().any(|d| d.code == "constraint.force_points_sentinel_skipped"
            && d.message.contains("fc.pts.sentinel")),
        "expected force_points_sentinel_skipped diagnostic: {:?}",
        diags
    );
    // the sibling non-points force constraint still maps normally
    let enh = ir.force_constraints.iter().find(|c| c.id == "fc.max2enh")
        .unwrap_or_else(|| panic!("non-points force constraint fc.max2enh missing: {:?}", ir.force_constraints));
    assert_eq!(enh.field, "Enhancements");
    assert_eq!(enh.target_type, "force");
    assert_eq!(enh.value, 2.0);
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
fn drops_cost_modifier_with_unsupported_value_kind() {
    // Real catalogues (e.g. Chaos Space Marines) carry `floor`/`ceil` value clamps
    // the engine has no IR form for. The modifier must be dropped with a diagnostic,
    // not passed through verbatim — an unknown type sinks the whole domain parse.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <costs><cost name="pts" typeId="pts" value="10"/></costs>
      <modifiers>
        <modifier type="floor" field="pts" value="5"/>
        <modifier type="increment" field="pts" value="2"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // Only the supported increment survives; floor is gone.
    let mods = u.costs[0].modifiers.as_ref().unwrap();
    assert_eq!(mods.len(), 1);
    assert_eq!(mods[0].type_, "increment");
    assert!(!mods.iter().any(|m| m.type_ == "floor"), "floor modifier leaked into IR");
    assert!(
        diags.iter().any(|d| d.code == "modifier.value_type_unsupported"),
        "expected a value_type_unsupported diagnostic, got: {:?}",
        diags
    );
}

#[test]
fn maps_divide_and_multiply_cost_modifiers() {
    // ~400 real 11e Enhancement modifiers use `divide` (cost halves/thirds on
    // 2nd/3rd take in a multi-detachment roster); `multiply` is its counterpart.
    // Both must be emitted, not dropped as value_type_unsupported.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <costs><cost name="pts" typeId="pts" value="30"/></costs>
      <modifiers>
        <modifier type="divide" field="pts" value="2"/>
        <modifier type="multiply" field="pts" value="3"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let mods = u.costs[0].modifiers.as_ref().unwrap();
    assert_eq!(mods.len(), 2);
    assert!(mods.iter().any(|m| m.type_ == "divide" && m.value == 2.0));
    assert!(mods.iter().any(|m| m.type_ == "multiply" && m.value == 3.0));
    assert!(
        !diags.iter().any(|d| d.code == "modifier.value_type_unsupported"),
        "divide/multiply must not be dropped as unsupported: {:?}",
        diags
    );
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
    // a leaf group (no sub-groups): descendants equal direct members
    assert_eq!(g.descendant_entry_ids, g.member_entry_ids);
    assert_eq!(g.constraints.len(), 1);
    assert_eq!((g.constraints[0].id.as_str(), g.constraints[0].type_.as_str(), g.constraints[0].value),
               ("g.wargear.max", "max", 1.0));
    // fixture is fully mappable now — no group drop diagnostics
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected: {:?}", diags);
}

#[test]
fn emits_group_with_unconditional_limit_modifier_drops_only_points_field() {
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
    // nested inner group still emitted
    let inner = u.groups.iter().find(|g| g.id == "g.inner").expect("nested group must be emitted");
    assert_eq!(inner.member_entry_ids, vec!["e.c"]);
    // g.mod now emits WITH its unconditional increment modifier attached
    let gmod = u.groups.iter().find(|g| g.id == "g.mod").expect("modifier-on-limit group now emitted");
    let mods = gmod.constraints[0].modifiers.as_ref().expect("modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    // g.pts (points field) still dropped; g.outer (constraint-less) not emitted
    assert!(u.groups.iter().all(|g| g.id != "g.pts"));
    assert!(u.groups.iter().all(|g| g.id != "g.outer"), "constraint-less outer group is not emitted");
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // exactly one loud drop remains: the points-field group
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
}

#[test]
fn outer_group_descendant_ids_span_nested_subgroups() {
    // The "Enhancements" shape: an outer group with NO direct entries carries the
    // real limit (max 3), its options nested in per-detachment sub-groups. Its
    // descendant_entry_ids must span those nested entries so engine-eval can count
    // them; member_entry_ids stays empty (direct members only).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.enh" name="Enhancements">
          <constraints><constraint id="g.enh.max" type="max" value="3" field="selections" scope="roster"/></constraints>
          <selectionEntryGroups>
            <selectionEntryGroup id="g.det.a" name="Detachment A">
              <selectionEntries>
                <selectionEntry id="e.enh.a1" name="A1" type="upgrade"/>
                <selectionEntry id="e.enh.a2" name="A2" type="upgrade"/>
              </selectionEntries>
            </selectionEntryGroup>
            <selectionEntryGroup id="g.det.b" name="Detachment B">
              <selectionEntries><selectionEntry id="e.enh.b1" name="B1" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let enh = u.groups.iter().find(|g| g.id == "g.enh").expect("outer group emitted");
    // direct members: none (only sub-groups)
    assert!(enh.member_entry_ids.is_empty(), "outer group has no direct entry members");
    // descendants: every enhancement nested in the sub-groups
    assert_eq!(
        enh.descendant_entry_ids,
        vec!["e.enh.a1", "e.enh.a2", "e.enh.b1"],
        "descendant closure must span nested sub-group entries"
    );
    // the roster-scope limit maps
    assert_eq!(enh.constraints[0].scope, "roster");
    assert_eq!(enh.constraints[0].value, 3.0);
}

#[test]
fn maps_group_limit_modifier_with_mappable_condition() {
    // A group max=1 with an increment-by-1 modifier gated by "have >=1 of e.sgt".
    // The condition (atLeast/selections/self) maps, so the whole rule is emitted.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries>
            <selectionEntry id="e.w" name="W" type="upgrade"/>
            <selectionEntry id="e.sgt" name="Sgt" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g").expect("group with limit modifier now emitted");
    let c = &g.constraints[0];
    assert_eq!((c.type_.as_str(), c.value), ("max", 1.0));
    let mods = c.modifiers.as_ref().expect("limit modifier attached");
    assert_eq!(mods.len(), 1);
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    assert_eq!(mods[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected drop: {:?}", diags);
}

#[test]
fn drops_group_limit_modifier_with_unmappable_condition() {
    // The modifier's condition uses an unmappable comparator ("childOf"), so the
    // whole group constraint is dropped rather than enforced with a partial gate.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="childOf" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "constraint with unmappable modifier must be dropped");
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
    assert!(
        diags.iter().any(|d| d.code == "group.constraint_dropped" && d.message.contains("unmappable modifier")),
        "{:?}", diags
    );
}

#[test]
fn drops_roster_scope_group_constraint_with_owner_relative_modifier_gate() {
    // A roster-wide limit is one army rule evaluated in a single placement's context;
    // a self-scoped (owner-relative) gate would make it depend on which placement was
    // picked → drop loudly. (Contrast the army-wide case below, which now maps.)
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Relics">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="roster"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "roster-scope + owner-relative gate must be dropped");
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
    assert!(
        diags.iter().any(|d| d.code == "group.constraint_dropped" && d.message.contains("owner-relative modifier gate")),
        "{:?}", diags
    );
}

#[test]
fn maps_roster_scope_group_constraint_with_army_wide_modifier_gate() {
    // A roster-wide relic limit (max 3 across the army) that a Crusade-force gate
    // lifts. The modifier's condition is army-wide (field=forces, scope=roster), so
    // it evaluates identically for every placement → the limit + modifier both map.
    // In a matched-play (forceless) roster the gate is false and the base limit holds.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Relics">
          <constraints><constraint id="g.max" type="max" value="3" field="selections" scope="roster"/></constraints>
          <modifiers>
            <modifier type="set" field="g.max" value="-1">
              <conditions>
                <condition type="atLeast" value="1" field="forces" scope="roster" childId="cac3-crusade"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g").expect("roster-scope + army-wide gate now maps");
    let c = &g.constraints[0];
    assert_eq!((c.scope.as_str(), c.type_.as_str(), c.value), ("roster", "max", 3.0));
    let mods = c.modifiers.as_ref().expect("army-wide limit modifier attached");
    assert_eq!(mods.len(), 1);
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("set", -1.0));
    assert_eq!(mods[0].conditions.as_ref().unwrap()[0].field, "forces");
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected drop: {:?}", diags);
}

#[test]
fn maps_roster_scope_group_constraint_with_unconditional_modifier() {
    // An UNCONDITIONAL modifier on a roster limit (no gate at all) is army-wide by
    // definition — it changes the cap identically for every placement → maps.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Relics">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="roster"/></constraints>
          <modifiers><modifier type="increment" field="g.max" value="2"/></modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g").expect("roster-scope + unconditional modifier maps");
    let mods = g.constraints[0].modifiers.as_ref().expect("modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 2.0));
    assert!(mods[0].conditions.is_none(), "unconditional → no conditions");
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected drop: {:?}", diags);
}

#[test]
fn drops_roster_scope_group_constraint_with_mixed_gate() {
    // One modifier gated by BOTH an army-wide (roster) and an owner-relative (self)
    // condition. The owner-relative one poisons the whole gate → drop loudly; a
    // roster-wide rule must not depend on a single placement's local context.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Relics">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="roster"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="roster" childId="e.tok"/>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "mixed gate must drop");
    assert!(
        diags.iter().any(|d| d.code == "group.constraint_dropped" && d.message.contains("owner-relative modifier gate")),
        "{:?}", diags
    );
}

#[test]
fn drops_group_limit_modifier_with_unknown_kind() {
    // The limit-modifier's `type` is not a known kind (set/increment/decrement),
    // so even though its condition is mappable, the whole group constraint must
    // be dropped loudly rather than emitting an invalid modifier kind into the IR.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers>
            <modifier type="append" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "constraint with unknown-kind modifier must be dropped");
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
    assert!(
        diags.iter().any(|d| d.code == "group.constraint_dropped" && d.message.contains("unmappable modifier")),
        "{:?}", diags
    );
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
fn nested_group_roster_scope_now_maps() {
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
    let g = u.groups.iter().find(|g| g.id == "g.inner").expect("roster-scope nested limit now maps");
    assert_eq!(g.constraints[0].scope, "roster");
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"));
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
    // A group choose-N is a per-owner local count over the group's direct
    // members ("self"/"parent"/group-id), or an army-wide "roster" limit
    // enforced separately. Any other scope (e.g. force, or a foreign id)
    // aggregates over a different set than the engine counts, so mapping it
    // as a per-owner group limit would silently miscount. It must be dropped
    // loudly.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Force-wide 0-1">
          <constraints>
            <constraint id="g.max" type="max" value="1" field="selections" scope="force"/>
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
    // force-scope group limit isn't a per-owner count → no IrGroup emitted
    assert!(u.groups.is_empty(), "force-scope group limit must not map: {:?}", u.groups);
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
fn group_default_none_sentinel_is_treated_as_absent() {
    // BattleScribe uses defaultSelectionEntryId="none" to mean "no default".
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Loadout" defaultSelectionEntryId="none">
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
    assert_eq!(g.default_member_entry_id, None, "\"none\" sentinel means no default");
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
fn drops_hidden_modifier_with_unmappable_condition() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditionGroups><conditionGroup type="or"><conditions>
            <condition type="instanceOf" value="1" field="wibble" scope="roster" childId="cat.x"/>
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
fn hidden_modifier_partial_or_group_drops_whole_modifier() {
    // Never over-hide: an `or` group with one mappable + one unmappable (genuinely
    // unknown scope) condition must drop the ENTIRE modifier, not keep the mappable
    // sibling.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditionGroups><conditionGroup type="or"><conditions>
            <condition type="instanceOf" value="1" field="selections" scope="roster" childId="cat.ok"/>
            <condition type="instanceOf" value="1" field="wibble" scope="roster" childId="cat.bad"/>
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

#[test]
fn maps_hidden_modifier_with_parent_and_context_scopes() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditions>
            <condition type="notInstanceOf" value="1" field="selections" scope="parent" childId="cat.a"/>
            <condition type="instanceOf" value="1" field="selections" scope="root-entry" childId="cat.b"/>
            <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.c"/>
            <condition type="instanceOf" value="1" field="selections" scope="primary-catalogue" childId="cat.d"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(e.visibility_modifiers.len(), 1, "gate with context scopes must now map");
    let cs = e.visibility_modifiers[0].conditions.as_ref().unwrap();
    let scopes: Vec<&str> = cs.iter().map(|c| c.scope.as_str()).collect();
    assert_eq!(scopes, vec!["parent", "root-entry", "ancestor", "roster"]); // primary-catalogue -> roster
    assert!(!diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped"));
}

#[test]
fn cost_modifier_condition_root_entry_scope_maps() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
      <modifiers>
        <modifier type="increment" field="pts" value="3">
          <conditions><condition type="atLeast" value="2" field="selections" scope="root-entry" childId="cat.x"/></conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let m = e.costs.iter().find(|c| c.name == "points").unwrap().modifiers.as_ref().unwrap();
    assert_eq!(m[0].conditions.as_ref().unwrap()[0].scope, "root-entry");
    assert!(!diags.iter().any(|d| d.code == "condition.scope_unmapped"));
}

#[test]
fn constraint_context_scopes_now_map() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <constraints>
        <constraint id="k1" type="max" value="1" field="selections" scope="unit"/>
        <constraint id="k2" type="max" value="1" field="selections" scope="root-entry"/>
        <constraint id="k3" type="max" value="1" field="selections" scope="primary-catalogue"/>
      </constraints>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let scopes: Vec<&str> = e.constraints.iter().map(|c| c.scope.as_str()).collect();
    assert!(scopes.contains(&"unit"));
    assert!(scopes.contains(&"root-entry"));
    assert!(scopes.contains(&"roster")); // primary-catalogue -> roster
    assert!(!diags.iter().any(|d| d.code == "constraint.scope_unmapped"));
}

#[test]
fn constraint_unknown_scope_still_dropped() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <constraints><constraint id="k" type="max" value="1" field="selections" scope="bogus-scope"/></constraints>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(e.constraints.is_empty());
    assert!(diags.iter().any(|d| d.code == "constraint.scope_unmapped"));
}

#[test]
fn emits_entry_type_for_known_values() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.unit" name="U" type="unit"/>
    <selectionEntry id="e.up" name="G" type="upgrade"/>
    <selectionEntry id="e.mo" name="M" type="model"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let ty = |id: &str| ir.entries.iter().find(|e| e.id == id).unwrap().entry_type.clone();
    assert_eq!(ty("e.unit"), Some("unit".to_string()));
    assert_eq!(ty("e.up"), Some("upgrade".to_string()));
    assert_eq!(ty("e.mo"), Some("model".to_string()));
}

#[test]
fn unknown_entry_type_is_omitted_and_diagnosed() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.weird" name="W" type="squad"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.weird").unwrap();
    assert!(e.entry_type.is_none());
    assert!(diags.iter().any(|d| d.code == "entry.type_unmapped"));
}

#[test]
fn cost_modifier_condition_type_scopes_map() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
      <modifiers>
        <modifier type="increment" field="pts" value="3">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="unit" childId="cat.a"/>
            <condition type="atLeast" value="1" field="selections" scope="upgrade" childId="cat.b"/>
            <condition type="atLeast" value="1" field="selections" scope="model" childId="cat.c"/>
            <condition type="atLeast" value="1" field="selections" scope="model-or-unit" childId="cat.d"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let m = e.costs.iter().find(|c| c.name == "points").unwrap().modifiers.as_ref().unwrap();
    let scopes: Vec<&str> = m[0].conditions.as_ref().unwrap().iter().map(|c| c.scope.as_str()).collect();
    assert_eq!(scopes, vec!["unit", "upgrade", "model", "model-or-unit"]);
    assert!(!diags.iter().any(|d| d.code == "condition.scope_unmapped"));
}

#[test]
fn entrylink_hidden_modifier_lands_on_inlined_instance() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
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
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert_eq!(inlined.visibility_modifiers.len(), 1, "link hidden modifier must land on the inlined instance");
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"));
}

#[test]
fn entrylink_static_hidden_sets_inlined_instance_hidden() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert!(inlined.hidden);
}

#[test]
fn entrylink_non_hidden_modifier_without_matching_cost_is_target_unmapped() {
    // A `pts`-field modifier is now routed through map_entry like any of the
    // target's own modifiers; `shared` has no <costs> at all, so there's no
    // cost slot to attach to and map_entry recategorizes it as
    // modifier.target_unmapped rather than the link machinery dropping it.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers>
            <modifier type="increment" field="pts" value="5"/>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let mut diags = Vec::new();
    let resolved = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap();
    let (ir, ir_diags) = to_ir(&resolved);
    diags.extend(ir_diags);
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert!(inlined.visibility_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn group_link_hidden_modifier_is_unsupported_diagnostic() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="grp" name="G"/>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntryGroup" targetId="grp">
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
    let mut diags = Vec::new();
    let resolved = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap();
    let (_ir, ir_diags) = to_ir(&resolved);
    diags.extend(ir_diags);
    assert!(diags.iter().any(|d| d.code == "entryLink.group_hidden_unsupported"));
}

#[test]
fn catalogue_root_entrylink_hidden_modifier_lands_on_surfaced_root() {
    // Catalogue-level entryLinks are surfaced as root entries by a separate loop
    // in resolve_with_caps; link-hosted hidden must apply there too.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditions>
            <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.x"/>
          </conditions>
        </modifier>
      </modifiers>
    </entryLink>
  </entryLinks>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let root = ir.entries.iter().find(|e| e.id == "shared").unwrap();
    assert_eq!(root.visibility_modifiers.len(), 1, "link hidden modifier must land on the surfaced root");
}

#[test]
fn group_constraint_roster_scope_maps() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.relic" name="Relics">
          <constraints><constraint id="k" type="max" value="1" field="selections" scope="roster"/></constraints>
          <selectionEntries>
            <selectionEntry id="e.r1" name="R1" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = e.groups.iter().find(|g| g.id == "g.relic").unwrap();
    assert_eq!(g.constraints.len(), 1);
    assert_eq!(g.constraints[0].scope, "roster");
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"));
}

#[test]
fn group_constraint_self_scope_omits_scope_field() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.w" name="W">
          <constraints><constraint id="k" type="max" value="1" field="selections" scope="parent"/></constraints>
          <selectionEntries><selectionEntry id="e.w1" name="W1" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = e.groups.iter().find(|g| g.id == "g.w").unwrap();
    assert_eq!(g.constraints[0].scope, "self");
    let v = serde_json::to_value(&g.constraints[0]).unwrap();
    assert!(v.get("scope").is_none(), "self scope must be skip-serialized: {:?}", v);
}

#[test]
fn entry_modifier_routes_to_owning_group_constraint() {
    // A modifier on the entry itself (not on the group) whose `field` names an
    // enclosing selectionEntryGroup's OWN constraint id (A2). It must land on
    // that IrGroupConstraint's modifiers, not drop as modifier.target_unmapped.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <modifiers>
        <modifier type="increment" value="1" field="gc"/>
      </modifiers>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.opt" name="Opt">
          <constraints><constraint id="gc" type="max" value="1" field="selections" scope="parent"/></constraints>
          <selectionEntries>
            <selectionEntry id="e.o1" name="O1" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = e.groups.iter().find(|g| g.id == "g.opt").expect("group mapped");
    let gc = g.constraints.iter().find(|c| c.id == "gc").expect("group constraint mapped");
    let mods = gc.modifiers.as_ref().expect("modifier attached to group constraint");
    assert_eq!(mods.len(), 1);
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
}

#[test]
fn maps_error_modifier_to_validation_rule() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="add" value="Max 1 {this} per 5 models" field="error">
          <conditions>
            <condition type="atLeast" value="2" field="selections" scope="self" childId="e.w"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert_eq!(w.validation_rules.len(), 1, "{:?}", diags);
    assert_eq!(w.validation_rules[0].message, "Max 1 {this} per 5 models");
    assert_eq!(w.validation_rules[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
}

#[test]
fn drops_error_modifier_with_unmappable_condition() {
    // GUID-scope condition is unmappable → the whole rule is dropped (never a false error).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="add" value="Nope" field="error">
          <conditions>
            <condition type="atLeast" value="1" field="wibble" scope="roster" childId="e.w"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert!(w.validation_rules.is_empty(), "unmappable-gate rule must be dropped");
    assert!(diags.iter().any(|d| d.code == "modifier.error_condition_unmapped"), "{:?}", diags);
}

#[test]
fn drops_error_modifier_with_unsupported_type() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="set" value="Nope" field="error"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert!(w.validation_rules.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.error_type_unsupported"), "{:?}", diags);
}

#[test]
fn maps_category_add_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="add" value="cat.keyword" field="category">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="roster" childId="e.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.category_modifiers.len(), 1, "{:?}", diags);
    assert_eq!(u.category_modifiers[0].type_, "add");
    assert_eq!(u.category_modifiers[0].category_id, "cat.keyword");
    assert_eq!(u.category_modifiers[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
}

#[test]
fn drops_category_modifier_with_unmappable_condition() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="add" value="cat.keyword" field="category">
          <conditions>
            <condition type="atLeast" value="1" field="wibble" scope="roster" childId="e.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.category_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.category_condition_unmapped"), "{:?}", diags);
}

#[test]
fn drops_set_primary_category_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="set-primary" value="cat.keyword" field="category"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.category_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.category_set_primary_unsupported"), "{:?}", diags);
}

#[test]
fn entrylink_cost_modifier_lands_on_inlined_instance() {
    // A link that discounts the shared entry by 2 pts on this placement.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="decrement" value="2" field="pts"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    let cost = inlined.costs.iter().find(|c| c.name == "points").expect("cost present");
    let mods = cost.modifiers.as_ref().expect("cost modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("decrement", 2.0));
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_constraint_modifier_lands_on_inlined_instance() {
    // A link that raises the shared entry's own max on this placement.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <constraints><constraint id="cc" type="max" value="1" field="selections" scope="parent"/></constraints>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="increment" value="1" field="cc"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    let c = inlined.constraints.iter().find(|c| c.id == "cc").expect("constraint present");
    let mods = c.modifiers.as_ref().expect("constraint modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_unrepresentable_modifier_becomes_target_unmapped() {
    // A `name` modifier is not representable → routed by map_entry to
    // modifier.target_unmapped (recategorized), NOT entryLink.modifier_dropped.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="set" value="Master-crafted" field="name"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (_ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    assert!(diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_modifier_isolated_to_its_placement() {
    // The same shared entry is linked into two hosts; only host_a's link carries
    // the cost modifier. host_b's inlined copy must be untouched (clone, no leak).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host_a" name="A" type="unit">
      <entryLinks>
        <entryLink id="la" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="decrement" value="2" field="pts"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
    <selectionEntry id="host_b" name="B" type="unit">
      <entryLinks>
        <entryLink id="lb" name="L" type="selectionEntry" targetId="shared"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let a = ir.entries.iter().find(|e| e.id == "host_a").unwrap()
        .children.iter().find(|e| e.id == "shared").unwrap();
    let b = ir.entries.iter().find(|e| e.id == "host_b").unwrap()
        .children.iter().find(|e| e.id == "shared").unwrap();
    assert!(a.costs[0].modifiers.is_some(), "host_a placement carries the modifier");
    assert!(b.costs[0].modifiers.is_none(), "host_b placement must be untouched");
}

#[test]
fn grouplink_constraint_modifier_lands_on_inlined_group() {
    // A group link carrying a modifier on the shared group's own limit → attached
    // via the conditional-group-limits machinery (map_group_constraint).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="sg" name="Loadout">
      <constraints><constraint id="gm" type="max" value="1" field="selections" scope="self"/></constraints>
      <selectionEntries><selectionEntry id="w" name="W" type="upgrade"/></selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lg" name="L" type="selectionEntryGroup" targetId="sg">
          <modifiers><modifier type="increment" value="1" field="gm"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let g = host.groups.iter().find(|g| g.id == "sg").expect("inlined group present");
    let gc = g.constraints.iter().find(|c| c.id == "gm").expect("group constraint present");
    assert!(gc.modifiers.as_ref().map(|m| !m.is_empty()).unwrap_or(false), "group limit modifier attached");
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn grouplink_hidden_modifier_still_unsupported() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="sg" name="Loadout">
      <constraints><constraint id="gm" type="max" value="1" field="selections" scope="self"/></constraints>
      <selectionEntries><selectionEntry id="w" name="W" type="upgrade"/></selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lg" name="L" type="selectionEntryGroup" targetId="sg">
          <modifiers><modifier type="set" value="true" field="hidden"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    // entryLink.group_hidden_unsupported is a resolve-stage diagnostic (emitted
    // in resolve/links.rs, before to_ir ever sees the catalogue), so it must be
    // captured via resolve_with_diags — bare resolve() discards it.
    let mut diags = Vec::new();
    let resolved = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap();
    let (_ir, ir_diags) = to_ir(&resolved);
    diags.extend(ir_diags);
    assert!(diags.iter().any(|d| d.code == "entryLink.group_hidden_unsupported"), "{:?}", diags);
}

#[test]
fn group_hidden_gate_is_pushed_onto_flattened_members() {
    // A selectionEntryGroup gated hidden by `and(forces CrusadeForce < 1, selections DET < 1)`
    // — the real enhancement-group detachment gate. The group has no IR visibility node, so
    // the gate must be lowered onto each flattened member entry. field="forces" now maps, so
    // the whole strict gate survives.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.det" name="Gladius" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="0"/></costs>
    </selectionEntry>
    <selectionEntry id="e.char" name="Captain" type="unit">
      <costs><cost name="Points" typeId="pts" value="90"/></costs>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.enh" name="Gladius Enhancements">
          <selectionEntries>
            <selectionEntry id="e.enh1" name="Enh1" type="upgrade">
              <costs><cost name="Points" typeId="pts" value="10"/></costs>
            </selectionEntry>
          </selectionEntries>
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditionGroups>
                <conditionGroup type="and">
                  <conditions>
                    <condition type="lessThan" value="1" field="forces" scope="roster" childId="force.crusade" shared="true"/>
                    <condition type="lessThan" value="1" field="selections" scope="roster" childId="e.det" shared="true"/>
                  </conditions>
                </conditionGroup>
              </conditionGroups>
            </modifier>
          </modifiers>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let ch = ir.entries.iter().find(|e| e.id == "e.char").unwrap();
    let enh = ch.children.iter().find(|e| e.id == "e.enh1").expect("member flattened into owner");
    assert_eq!(enh.visibility_modifiers.len(), 1, "group hidden gate pushed onto member");
    let vm = &enh.visibility_modifiers[0];
    assert!(vm.set, "gate hides (set=true)");
    let cg = vm.condition_groups.as_ref().expect("gate carries the and-group");
    let conds = cg[0].conditions.as_ref().unwrap();
    assert!(conds.iter().any(|c| c.field == "forces"), "forces condition survived mapping");
    assert!(conds.iter().any(|c| c.field == "selections" && c.target_id == "e.det"), "detachment condition present");
}

#[test]
fn unmappable_group_hidden_gate_is_dropped_with_diagnostic() {
    // A group hidden gate whose condition uses an unmappable field must drop the whole
    // gate (never over-hide) and leave members ungated, with a diagnostic.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.char" name="Captain" type="unit">
      <costs><cost name="Points" typeId="pts" value="90"/></costs>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.enh" name="Enh">
          <selectionEntries>
            <selectionEntry id="e.enh1" name="Enh1" type="upgrade">
              <costs><cost name="Points" typeId="pts" value="10"/></costs>
            </selectionEntry>
          </selectionEntries>
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditions>
                <condition type="lessThan" value="1" field="wibble" scope="roster" childId="x" shared="true"/>
              </conditions>
            </modifier>
          </modifiers>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let ch = ir.entries.iter().find(|e| e.id == "e.char").unwrap();
    let enh = ch.children.iter().find(|e| e.id == "e.enh1").unwrap();
    assert!(enh.visibility_modifiers.is_empty(), "unmappable group gate dropped, member ungated");
    assert!(diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped" && d.message.contains("group g.enh")),
        "drop diagnosed: {:?}", diags);
}

#[test]
fn foreign_id_condition_scope_is_emitted_not_dropped() {
    // A cost modifier gated by a model-count condition whose scope is the unit's OWN entry
    // id (a foreign-id scope). Previously dropped as unmappable; now it passes through so the
    // modifier stays conditional (unit prices by its own model count).
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="pts"/></costTypes>
  <selectionEntries>
    <selectionEntry type="unit" import="true" name="Squad" id="8da0-4570-c3c-819f">
      <costs><cost name="pts" typeId="pts" value="80"/></costs>
      <modifiers>
        <modifier type="set" value="160" field="pts">
          <conditions>
            <condition type="atLeast" value="6" field="selections" scope="8da0-4570-c3c-819f" childId="e371-model" shared="true" includeChildSelections="true"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(!diags.iter().any(|d| d.code == "condition.scope_unmapped"),
        "foreign-id scope no longer diagnosed as unmapped: {:?}", diags);
    let squad = ir.entries.iter().find(|e| e.id == "8da0-4570-c3c-819f").unwrap();
    let cost = squad.costs.iter().find(|c| c.name == "points").unwrap(); // parser canonicalizes "pts" -> "points"
    let modi = cost.modifiers.as_ref().expect("cost carries the set modifier");
    let cond = modi[0].conditions.as_ref().expect("modifier keeps its condition")[0].clone();
    assert_eq!(cond.scope, "8da0-4570-c3c-819f", "foreign-id scope passed through verbatim");
}

/// B1: a numeric characteristic (set/increment/decrement) modifier whose `field`
/// resolves to a characteristicType id (via <profileTypes><profileType>
/// <characteristicTypes>) is captured on the OWNING entry as an
/// IrCharacteristicModifier, with a faithfully-parsed (not resolved) target spec —
/// mirrors the real "Artificer Armour" Enhancement: an upgrade entry with a `set`
/// modifier whose `affects` reaches "up" to reach its parent model's Unit profile.
#[test]
fn maps_cross_entry_set_characteristic_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.sv" name="Sv"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.model" name="Captain" type="model">
      <costs><cost name="pts" typeId="pts" value="90"/></costs>
      <profiles>
        <profile id="p.unit" name="Captain" typeName="Unit">
          <characteristics><characteristic name="Sv">3+</characteristic></characteristics>
        </profile>
      </profiles>
      <selectionEntryGroups>
        <selectionEntryGroup id="g.enh" name="Enhancements">
          <selectionEntries>
            <selectionEntry id="e.artificer" name="Artificer Armour" type="upgrade">
              <costs><cost name="pts" typeId="pts" value="10"/></costs>
              <modifiers>
                <modifier type="set" field="ct.sv" value="2+" scope="model"
                          affects="self.entries.recursive.e.model.profiles.Unit"/>
                <modifier type="append" field="ct.sv" value="+0" scope="model"
                          affects="self.entries.recursive.e.model.profiles.Unit"/>
              </modifiers>
            </selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let model = ir.entries.iter().find(|e| e.id == "e.model").unwrap();
    let artificer = model.children.iter().find(|e| e.id == "e.artificer")
        .unwrap_or_else(|| panic!("e.artificer missing from e.model's flattened children"));

    assert_eq!(artificer.characteristic_modifiers.len(), 1,
        "only the set modifier is captured; the append modifier is dropped (unsupported), unchanged");
    let cm = &artificer.characteristic_modifiers[0];
    assert_eq!(cm.characteristic, "Sv");
    assert_eq!(cm.profile_type, "Unit");
    assert_eq!(cm.kind, "set");
    assert_eq!(cm.value, "2+");
    assert_eq!(cm.target_scope, "model");
    assert_eq!(cm.target_id.as_deref(), Some("e.model"));
    assert!(cm.recursive);
    assert!(cm.conditions.is_none());
    assert!(cm.condition_groups.is_none());

    // The set modifier is captured, not dropped as target_unmapped.
    assert!(
        !diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.artificer")),
        "set characteristic modifier should not be diagnosed as target_unmapped: {:?}", diags
    );
    // The append modifier is STILL dropped (unchanged) — via the existing
    // value_type_unsupported kind filter in map_modifier.
    assert!(
        diags.iter().any(|d| d.code == "modifier.value_type_unsupported"),
        "append modifier on a characteristic should still be dropped as unsupported: {:?}", diags
    );
}

/// A recursive broadcast with no specific target entry id (the "whole subtree,
/// any descendant, profile-type filter only" shape — the single most common
/// real pattern per the investigation).
#[test]
fn maps_recursive_broadcast_characteristic_modifier_without_target_id() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.mw" name="Melee Weapons">
      <characteristicTypes>
        <characteristicType id="ct.s" name="S"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="The Honour Vehement" type="upgrade">
      <modifiers>
        <modifier type="increment" field="ct.s" value="1" scope="model"
                  affects="self.entries.recursive.profiles.Melee Weapons"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    let cm = &enh.characteristic_modifiers[0];
    assert_eq!(cm.characteristic, "S");
    assert_eq!(cm.profile_type, "Melee Weapons");
    assert_eq!(cm.kind, "increment");
    assert_eq!(cm.value, "1");
    assert_eq!(cm.target_scope, "model");
    assert!(cm.target_id.is_none());
    assert!(cm.recursive);
}

/// A direct-children-only (non-recursive) broadcast with no specific target id.
#[test]
fn maps_direct_children_characteristic_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.t" name="T"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="decrement" field="ct.t" value="1" scope="parent"
                  affects="self.entries.profiles.Unit"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    let cm = &enh.characteristic_modifiers[0];
    assert_eq!(cm.kind, "decrement");
    assert_eq!(cm.target_scope, "parent");
    assert!(cm.target_id.is_none());
    assert!(!cm.recursive, "self.entries.profiles.X (no `recursive` keyword) means direct children only");
}

/// A conditional characteristic modifier keeps its gating condition (reusing
/// the existing non-strict condition-mapping helpers).
#[test]
fn maps_conditional_characteristic_modifier_with_condition() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <categoryEntries><categoryEntry id="cat.x" name="X"/></categoryEntries>
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.m" name="M"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="increment" field="ct.m" value="2" scope="self" affects="self.entries.profiles.Unit">
          <conditions>
            <condition type="atLeast" field="selections" scope="roster" value="1" childId="cat.x"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    let cm = &enh.characteristic_modifiers[0];
    let conds = cm.conditions.as_ref().expect("condition mapped");
    assert_eq!(conds[0].comparator, "atLeast");
    assert_eq!(conds[0].target_id, "cat.x");
    assert_eq!(conds[0].scope, "roster");
}

/// A divide/multiply modifier on a characteristic field is NOT captured (those
/// kinds are cost-modifier-only) — it still falls through to target_unmapped.
#[test]
fn divide_multiply_on_characteristic_field_stays_target_unmapped() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.t" name="T"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="divide" field="ct.t" value="2" scope="self" affects="self.entries.profiles.Unit"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert!(enh.characteristic_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.enh")));
}

/// No `affects` attribute at all ("implicit self" — not one of the three
/// documented/understood grammars) is faithfully NOT captured — falls through
/// to target_unmapped unchanged, rather than guessing a target.
#[test]
fn missing_affects_stays_target_unmapped() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.rw" name="Ranged Weapons">
      <characteristicTypes>
        <characteristicType id="ct.a" name="A"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="set" field="ct.a" value="1" scope="upgrade"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert!(enh.characteristic_modifiers.is_empty(), "missing affects (\"implicit self\") not yet handled");
    assert!(diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.enh")));
}

/// Fix 2, shape 1: a bare `profiles.<TypeName>` `affects` (no `self.entries`
/// prefix at all) says "the `<TypeName>` profile of whatever the modifier's
/// own `scope` attribute anchors to" — confirmed as the ~24.5%/~6.7%
/// real-data shape (e.g. `scope: upgrade, affects: profiles.Ranged Weapons`
/// in real 11e BSData). `target_scope` is carried through from the
/// modifier's own `scope` attribute (via `map_condition_scope`), mirroring
/// the `<id>.profiles.<TypeName>` arm below — it is NOT hardcoded to "self".
/// Real 11e BSData (Space Marines) proves this matters: the flagship
/// wargear-swap example (`Heavy Jump Pack and Mk X Gravis Armour`) carries
/// `scope="root-entry"`, `affects="profiles.Unit"` to change the bearer
/// model's statline — anchoring at the option entry itself (hardcoded
/// "self") would silently drop the modifier, since the option entry has no
/// `Unit` profile of its own.
#[test]
fn maps_own_entry_bare_profiles_characteristic_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.sv" name="Sv"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="set" field="ct.sv" value="2+" scope="root-entry" affects="profiles.Unit"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert_eq!(enh.characteristic_modifiers.len(), 1);
    let cm = &enh.characteristic_modifiers[0];
    assert_eq!(cm.characteristic, "Sv");
    assert_eq!(cm.profile_type, "Unit");
    assert_eq!(cm.kind, "set");
    assert_eq!(cm.value, "2+");
    assert_eq!(cm.target_scope, "root-entry", "bare profiles.X must carry through the modifier's own `scope` attribute, not hardcode target_scope=self");
    assert!(cm.target_id.is_none());
    assert!(!cm.recursive);
    assert!(
        !diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.enh")),
        "bare profiles.X should now be captured, not target_unmapped: {:?}", diags
    );
}

/// Fix 2, shape 1 continued: when the modifier's `scope` attribute is
/// empty/absent, the bare `profiles.<TypeName>` shape falls back to
/// `target_scope = "self"` (real data always has `scope` populated for this
/// shape, but the fallback keeps the arm from emitting an empty string).
#[test]
fn maps_own_entry_bare_profiles_characteristic_modifier_empty_scope_falls_back_to_self() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.sv" name="Sv"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="set" field="ct.sv" value="2+" affects="profiles.Unit"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert_eq!(enh.characteristic_modifiers.len(), 1);
    let cm = &enh.characteristic_modifiers[0];
    assert_eq!(cm.target_scope, "self", "bare profiles.X with no scope attribute falls back to self");
    assert!(cm.target_id.is_none());
    assert!(!cm.recursive);
    assert!(
        !diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.enh")),
        "bare profiles.X should now be captured, not target_unmapped: {:?}", diags
    );
}

/// Fix 2, shape 2: a bare `<entryId>.profiles.<TypeName>` `affects` (leading
/// token is neither "self" nor "profiles") targets one specific foreign entry,
/// non-recursively — confirmed as the ~7.5% real-data shape (e.g. `affects:
/// 982b-de77-dd2d-d9bd.profiles.Ranged Weapons` in real 11e BSData).
/// `target_scope` comes from the modifier's own `scope` attribute.
#[test]
fn maps_foreign_entry_non_recursive_characteristic_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <profileTypes>
    <profileType id="pt.rw" name="Ranged Weapons">
      <characteristicTypes>
        <characteristicType id="ct.a" name="A"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="increment" field="ct.a" value="1" scope="upgrade"
                  affects="e993-e086-6de1-12af.profiles.Ranged Weapons"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert_eq!(enh.characteristic_modifiers.len(), 1);
    let cm = &enh.characteristic_modifiers[0];
    assert_eq!(cm.characteristic, "A");
    assert_eq!(cm.profile_type, "Ranged Weapons");
    assert_eq!(cm.kind, "increment");
    assert_eq!(cm.target_scope, "upgrade", "target_scope comes from the modifier's own scope attribute");
    assert_eq!(cm.target_id.as_deref(), Some("e993-e086-6de1-12af"));
    assert!(!cm.recursive);
    assert!(
        !diags.iter().any(|d| d.code == "modifier.target_unmapped" && d.message.contains("e.enh")),
        "foreign-entry-id bare affects should now be captured, not target_unmapped: {:?}", diags
    );
}

/// Fix 1 regression guard: a characteristic modifier with one mappable and one
/// unmappable condition must map its conditions (and diagnose the unmappable
/// one) EXACTLY ONCE — not twice. Before the fix, `map_entry` built `ir_mod`
/// via `map_modifier` (which maps conditions and pushes diagnostics), then
/// `map_characteristic_modifier` re-mapped the SAME raw conditions from
/// scratch, doubling both the mapped-condition work and the diagnostic.
#[test]
fn characteristic_modifier_condition_mapped_and_diagnosed_exactly_once() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <categoryEntries><categoryEntry id="cat.x" name="X"/></categoryEntries>
  <profileTypes>
    <profileType id="pt.unit" name="Unit">
      <characteristicTypes>
        <characteristicType id="ct.m" name="M"/>
      </characteristicTypes>
    </profileType>
  </profileTypes>
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade">
      <modifiers>
        <modifier type="increment" field="ct.m" value="2" scope="self" affects="self.entries.profiles.Unit">
          <conditions>
            <condition type="atLeast" field="selections" scope="roster" value="1" childId="cat.x"/>
            <condition type="atLeast" field="bogus-field" scope="roster" value="1" childId="cat.x"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let enh = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert_eq!(enh.characteristic_modifiers.len(), 1);
    let cm = &enh.characteristic_modifiers[0];

    // The mappable condition survives on the captured modifier.
    let conds = cm.conditions.as_ref().expect("the mappable condition is carried");
    assert_eq!(conds.len(), 1, "only the mappable condition is kept, and only once");
    assert_eq!(conds[0].comparator, "atLeast");
    assert_eq!(conds[0].target_id, "cat.x");

    // The unmappable condition's diagnostic is emitted EXACTLY ONCE, not twice
    // (once by map_modifier's ir_mod construction, once again by
    // map_characteristic_modifier re-deriving from the raw conditions).
    let field_unmapped_count = diags.iter()
        .filter(|d| d.code == "condition.field_unmapped" && d.message.contains("bogus-field"))
        .count();
    assert_eq!(field_unmapped_count, 1,
        "condition.field_unmapped for the unmappable condition should be emitted exactly once, got {}: {:?}",
        field_unmapped_count, diags);
}
