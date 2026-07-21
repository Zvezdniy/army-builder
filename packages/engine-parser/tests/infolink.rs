use engine_parser::raw::parse_raw;

const XML: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedProfiles>
    <profile id="p.inv" name="Invulnerable Save" typeName="Abilities">
      <characteristics><characteristic name="Description">4+</characteristic></characteristics>
    </profile>
  </sharedProfiles>
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="model">
      <infoLinks>
        <infoLink name="Invulnerable Save" hidden="false" type="profile" id="l1" targetId="p.inv"/>
      </infoLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;

#[test]
fn parse_reads_shared_profiles_and_infolinks() {
    let cat = parse_raw(XML).unwrap();
    assert_eq!(cat.shared_profiles.len(), 1);
    assert_eq!(cat.shared_profiles[0].id, "p.inv");
    assert_eq!(cat.shared_profiles[0].name, "Invulnerable Save");
    let u = cat.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.info_links.len(), 1);
    assert_eq!((u.info_links[0].target_id.as_str(), u.info_links[0].link_type.as_str()), ("p.inv", "profile"));
    assert!(!u.info_links[0].hidden);
    assert_eq!(u.info_links[0].name, "Invulnerable Save");
}

use engine_parser::parse_bytes;

#[test]
fn resolve_inlines_profile_infolink_end_to_end() {
    let (ir, diags) = parse_bytes(XML, false).unwrap_or_else(|e| panic!("{e:?}"));
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // The linked "Invulnerable Save" profile is now inlined and surfaced in IR.
    assert!(u.profiles.iter().any(|p| p.name == "Invulnerable Save"),
        "linked profile inlined into the entry's profiles");
    assert!(!diags.iter().any(|d| d.code == "infolink.unresolved"));
}

#[test]
fn unresolved_profile_infolink_is_diagnosed_not_fatal() {
    let xml = br#"<?xml version="1.0"?><catalogue id="c" name="C" revision="1" gameSystemId="gs"
      xmlns="http://www.battlescribe.net/schema/catalogueSchema">
      <selectionEntries><selectionEntry id="e.u" name="U" type="model">
        <infoLinks><infoLink type="profile" targetId="absent" hidden="false"/></infoLinks>
      </selectionEntry></selectionEntries></catalogue>"#;
    let (ir, diags) = parse_bytes(xml, false).unwrap();
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.profiles.iter().all(|p| p.name != "Invulnerable Save"));
    assert!(diags.iter().any(|d| d.code == "infolink.unresolved" && d.message.contains("absent")));
}

#[test]
fn hidden_and_non_profile_infolinks_are_not_inlined() {
    let xml = br#"<?xml version="1.0"?><catalogue id="c" name="C" revision="1" gameSystemId="gs"
      xmlns="http://www.battlescribe.net/schema/catalogueSchema">
      <sharedProfiles>
        <profile id="p.hidden" name="Hidden Inv" typeName="Abilities">
          <characteristics><characteristic name="Description">4+</characteristic></characteristics></profile>
        <profile id="p.rule" name="Deep Strike" typeName="Abilities">
          <characteristics><characteristic name="Description">x</characteristic></characteristics></profile>
      </sharedProfiles>
      <selectionEntries><selectionEntry id="e.u" name="U" type="model">
        <infoLinks>
          <infoLink type="profile" targetId="p.hidden" hidden="true"/>
          <infoLink type="rule" targetId="p.rule" hidden="false"/>
        </infoLinks>
      </selectionEntry></selectionEntries></catalogue>"#;
    let (ir, _diags) = parse_bytes(xml, false).unwrap();
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.profiles.is_empty(), "hidden profile link and rule-type link are not inlined");
}
