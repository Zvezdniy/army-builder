use quick_xml::events::{BytesStart, Event};
use crate::error::ParseError;
use crate::xml::SafeXmlReader;
use super::model::RawCatalogue;

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|c| c.into_owned()))
}

pub fn parse_raw(bytes: &[u8]) -> Result<RawCatalogue, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut cat = RawCatalogue::default();
    while let Some(ev) = r.read_event()? {
        if let Event::Start(e) | Event::Empty(e) = &ev.event {
            match e.local_name().as_ref() {
                b"catalogue" | b"gameSystem" => {
                    cat.id = attr(e, b"id").unwrap_or_default();
                    cat.name = attr(e, b"name").unwrap_or_default();
                    cat.revision = attr(e, b"revision").and_then(|s| s.parse().ok()).unwrap_or(0);
                    cat.game_system_id = attr(e, b"gameSystemId");
                }
                b"costType" => {
                    if let (Some(id), Some(name)) = (attr(e, b"id"), attr(e, b"name")) {
                        cat.cost_types.insert(id, name);
                    }
                }
                b"categoryEntry" => {
                    if let (Some(id), Some(name)) = (attr(e, b"id"), attr(e, b"name")) {
                        cat.categories.insert(id, name);
                    }
                }
                _ => {}
            }
        }
    }
    Ok(cat)
}
