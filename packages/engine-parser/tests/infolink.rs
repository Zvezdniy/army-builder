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
}
