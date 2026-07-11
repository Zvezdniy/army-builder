use engine_parser::{raw::parse_raw, resolve::{resolve, resolve_with_diags}, ir::to_ir};

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
fn drops_group_points_and_modifier_and_nested_constraints() {
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
    // points-field group, modifier-on-limit group, and nested-group constraint are all dropped → no IrGroup emitted
    assert!(u.groups.is_empty(), "no group should be emitted: {:?}", u.groups);
    // members still flattened
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // three loud drop diagnostics (points, modifier-on-limit, nested)
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 3, "{:?}", diags);
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
