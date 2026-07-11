use engine_parser::parse_system;

// A faction .cat whose ONLY root is an entryLink into a shared entry that itself
// links to a weapon that lives ONLY in the .gst. Categories, costType and the
// force-org also live in the .gst. This proves cross-file assembly end to end.
const CAT: &[u8] = br#"<?xml version="1.0"?>
<catalogue id="cat.f" name="Faction" revision="1" gameSystemId="sys.g"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.captain" name="Captain" type="unit">
      <costs><cost name="pts" typeId="ct.pts" value="80"/></costs>
      <categoryLinks>
        <categoryLink id="cl.hq" name="HQ" targetId="cat.hq" primary="true"/>
      </categoryLinks>
      <entryLinks>
        <entryLink id="l.wpn" name="Bolter" type="selectionEntry" targetId="e.bolter"/>
      </entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="root.captain" name="Captain" type="selectionEntry" targetId="e.captain"/>
  </entryLinks>
</catalogue>"#;

const GST: &[u8] = br#"<?xml version="1.0"?>
<gameSystem id="sys.g" name="Game" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
  <costTypes><costType id="ct.pts" name="Points"/></costTypes>
  <categoryEntries><categoryEntry id="cat.hq" name="HQ"/></categoryEntries>
  <forceEntries>
    <forceEntry id="force.army" name="Army">
      <categoryLinks>
        <categoryLink id="fcl.hq" name="HQ" targetId="cat.hq">
          <constraints>
            <constraint id="fc.hq.min" type="min" value="1" field="selections" scope="force"/>
          </constraints>
        </categoryLink>
      </categoryLinks>
    </forceEntry>
  </forceEntries>
  <sharedSelectionEntries>
    <selectionEntry id="e.bolter" name="Bolter" type="upgrade">
      <costs><cost name="pts" typeId="ct.pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
</gameSystem>"#;

#[test]
fn assembles_cat_with_its_gst() {
    let (ir, diags) = parse_system((CAT, false), &[(GST, false)]).unwrap();

    // Root surfaced from the catalogue-level entryLink.
    let captain = ir.entries.iter().find(|e| e.id == "e.captain")
        .expect("captain root surfaced");
    // Its weapon, which lives only in the .gst, resolved as a child.
    assert!(captain.children.iter().any(|c| c.id == "e.bolter"),
        "gst-only weapon inlined: {:?}", captain.children);
    // Cost name resolved via the merged .gst costType (empty without the merge).
    assert_eq!(captain.costs[0].name, "points");
    // Category id present (matched against force-org by id).
    assert_eq!(captain.categories, vec!["cat.hq"]);
    // Force-org came from the .gst's forceEntry.
    assert!(ir.force_constraints.iter().any(|c| c.id == "fc.hq.min"
        && c.target_type == "category" && c.target_id == "cat.hq" && c.type_ == "min"));
    // Nothing dangling in this closed pair.
    assert!(!diags.iter().any(|d| d.code == "entryLink.unresolved"),
        "no unresolved links: {:?}", diags);
}

#[test]
fn wrong_gst_is_diagnosed() {
    // gameSystemId "sys.g" but the supporting file's id is "sys.other".
    let wrong_gst = br#"<?xml version="1.0"?>
<gameSystem id="sys.other" name="Other" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
</gameSystem>"#;
    let (_ir, diags) = parse_system((CAT, false), &[(wrong_gst, false)]).unwrap();
    assert!(diags.iter().any(|d| d.code == "gameSystem.mismatch"),
        "mismatch diagnosed: {:?}", diags);
}

// A unit whose entryLink points at a selectionEntryGroup that lives only in the
// .gst. After assembly the unit must carry that group as an IrGroup with its
// choose-N limit, and the group's members must be flattened into the unit's
// children. This is the P0-d capability: resolving group-targeted entryLinks.
const CAT_GRP: &[u8] = br#"<?xml version="1.0"?>
<catalogue id="cat.g" name="FactionG" revision="1" gameSystemId="sys.gg"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.unit" name="Squad" type="unit">
      <costs><cost name="pts" typeId="ct.pts" value="100"/></costs>
      <entryLinks>
        <entryLink id="l.wpn" name="Weapon" type="selectionEntryGroup" targetId="g.weapon"/>
      </entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="root.unit" name="Squad" type="selectionEntry" targetId="e.unit"/>
  </entryLinks>
</catalogue>"#;

const GST_GRP: &[u8] = br#"<?xml version="1.0"?>
<gameSystem id="sys.gg" name="GameG" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
  <costTypes><costType id="ct.pts" name="Points"/></costTypes>
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="g.weapon" name="Weapon">
      <constraints>
        <constraint id="c.w.min" type="min" value="1" field="selections" scope="parent"/>
        <constraint id="c.w.max" type="max" value="1" field="selections" scope="parent"/>
      </constraints>
      <selectionEntries>
        <selectionEntry id="e.bolter" name="Bolter" type="upgrade"/>
        <selectionEntry id="e.plasma" name="Plasma" type="upgrade"/>
      </selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
</gameSystem>"#;

#[test]
fn resolves_group_targeted_entrylink() {
    let (ir, diags) = parse_system((CAT_GRP, false), &[(GST_GRP, false)]).unwrap();
    let unit = ir.entries.iter().find(|e| e.id == "e.unit").expect("unit root surfaced");
    // The gst-only group is inlined as an IrGroup with its choose-1 limit.
    let wg = unit.groups.iter().find(|g| g.name == "Weapon").expect("group-linked group inlined");
    assert!(wg.constraints.iter().any(|c| c.type_ == "max" && c.value == 1.0), "choose-max present");
    assert!(wg.member_entry_ids.iter().any(|id| id == "e.bolter"), "members recorded on the group");
    // Members are flattened into the unit's children (existing map behaviour).
    assert!(unit.children.iter().any(|c| c.id == "e.bolter"), "member flattened into children");
    // Nothing dangling: the group target resolved.
    assert!(!diags.iter().any(|d| d.code == "entryLink.unresolved"), "no unresolved links: {:?}", diags);
}
