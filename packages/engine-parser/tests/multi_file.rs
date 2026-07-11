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
