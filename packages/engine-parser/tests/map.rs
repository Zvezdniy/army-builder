use engine_parser::{raw::parse_raw, resolve::resolve, ir::to_ir};

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
fn maps_group_member_entries_and_diagnoses_group_constraint() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    // the entry nested in a <selectionEntryGroup> is flattened into the parent's children
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"),
        "group member entry was dropped from the IR");
    // the group's own choose-max-1 constraint is diagnostic-dropped, never silently lost
    assert!(diags.iter().any(|d| d.code == "group.constraint_dropped"));
}
