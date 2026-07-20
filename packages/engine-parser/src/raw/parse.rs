use std::collections::BTreeMap;
use quick_xml::events::{BytesStart, Event};
use crate::error::ParseError;
use crate::xml::SafeXmlReader;
use super::model::{
    RawCatalogue, RawCatalogueLink, RawCategoryLink, RawCharacteristic, RawCondition, RawConditionGroup,
    RawConstraint, RawCost, RawEntry, RawEntryLink, RawForce, RawGroup, RawInfoLink, RawModifier, RawProfile,
};

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|c| c.into_owned()))
}

fn attr_f64(e: &BytesStart, key: &[u8]) -> Option<f64> {
    attr(e, key).and_then(|s| s.parse().ok())
}

fn attr_bool(e: &BytesStart, key: &[u8]) -> bool {
    matches!(attr(e, key).as_deref(), Some("true") | Some("1"))
}

fn set_header(cat: &mut RawCatalogue, e: &BytesStart) {
    cat.id = attr(e, b"id").unwrap_or_default();
    cat.name = attr(e, b"name").unwrap_or_default();
    cat.revision = attr(e, b"revision").and_then(|s| s.parse().ok()).unwrap_or(0);
    cat.game_system_id = attr(e, b"gameSystemId");
}

pub fn parse_raw(bytes: &[u8]) -> Result<RawCatalogue, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut cat = RawCatalogue::default();
    while let Some(ev) = r.read_event()? {
        match ev.event {
            Event::Start(e) => match e.local_name().as_ref() {
                b"catalogue" | b"gameSystem" => set_header(&mut cat, &e),
                // flat containers: children (costType/categoryEntry) are handled
                // directly below as they stream through this same loop.
                b"costTypes" | b"categoryEntries" => {}
                b"costType" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        cat.cost_types.insert(id, name);
                    }
                }
                b"categoryEntry" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        cat.categories.insert(id, name);
                    }
                }
                b"profileTypes" => {
                    read_profile_types_into(&mut cat.characteristic_types, &mut r)?
                }
                b"sharedSelectionEntries" => {
                    read_entries_into(&mut cat.shared_entries, &mut r, b"sharedSelectionEntries")?
                }
                b"sharedSelectionEntryGroups" => {
                    read_groups_into(&mut cat.shared_groups, &mut r, b"sharedSelectionEntryGroups")?
                }
                b"selectionEntries" => read_entries_into(&mut cat.entries, &mut r, b"selectionEntries")?,
                b"forceEntries" => read_forces_into(&mut cat.force_entries, &mut r, b"forceEntries")?,
                b"catalogueLinks" => read_cataloguelinks_into(&mut cat.catalogue_links, &mut r)?,
                b"entryLinks" => read_entrylinks_into(&mut cat.entry_links, &mut r)?,
                b"sharedProfiles" => {
                    read_profiles_into(&mut cat.shared_profiles, &mut r, b"sharedProfiles")?
                }
                other => {
                    let name = other.to_vec();
                    skip_element(&mut r, &name)?;
                }
            },
            Event::Empty(e) => match e.local_name().as_ref() {
                b"catalogue" | b"gameSystem" => set_header(&mut cat, &e),
                b"costType" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        cat.cost_types.insert(id, name);
                    }
                }
                b"categoryEntry" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        cat.categories.insert(id, name);
                    }
                }
                // any other self-closing container (e.g. <sharedSelectionEntries/>)
                // has no children — nothing to read.
                _ => {}
            },
            _ => {}
        }
    }
    // Rule definitions live both in top-level <sharedRules>/<rules> (game system)
    // and nested inside selectionEntries/forceEntries (faction rules). The main
    // structural loop above skips nested <rules>; a flat second pass captures every
    // <rule> definition regardless of nesting.
    cat.rules = read_all_rules(bytes)?;
    Ok(cat)
}

/// Consume events until the matching close of an element already opened by
/// the caller (whose `Start` event was already read). Counts generically:
/// +1 on any `Start`, -1 on any `End`; returns once the count returns to 0.
fn skip_element(r: &mut SafeXmlReader, end_name: &[u8]) -> Result<(), ParseError> {
    let mut depth: i64 = 1;
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(_) => depth += 1,
                Event::End(_) => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(());
                    }
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(format!(
                    "unexpected EOF while skipping <{}>",
                    String::from_utf8_lossy(end_name)
                )))
            }
        }
    }
}

fn read_entries_into(
    dst: &mut Vec<RawEntry>,
    r: &mut SafeXmlReader,
    container_end: &[u8],
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"selectionEntry" => {
                    dst.push(read_entry(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"selectionEntry" => {
                    dst.push(RawEntry {
                        id: attr(&e, b"id").unwrap_or_default(),
                        name: attr(&e, b"name").unwrap_or_default(),
                        entry_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in selectionEntries container".to_string(),
                ))
            }
        }
    }
}

fn read_entry(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawEntry, ParseError> {
    let mut entry = RawEntry {
        id: attr(start, b"id").unwrap_or_default(),
        name: attr(start, b"name").unwrap_or_default(),
        entry_type: attr(start, b"type").unwrap_or_default(),
        hidden: attr_bool(start, b"hidden"),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"costs" => read_costs_into(&mut entry.costs, r)?,
                    b"categoryLinks" => read_catlinks_into(&mut entry.category_links, r)?,
                    b"constraints" => read_constraints_into(&mut entry.constraints, r)?,
                    b"selectionEntries" => {
                        read_entries_into(&mut entry.entries, r, b"selectionEntries")?
                    }
                    b"selectionEntryGroups" => {
                        read_groups_into(&mut entry.groups, r, b"selectionEntryGroups")?
                    }
                    b"entryLinks" => read_entrylinks_into(&mut entry.entry_links, r)?,
                    b"modifiers" => read_modifiers_into(&mut entry.modifiers, r)?,
                    b"profiles" => read_profiles_into(&mut entry.profiles, r, b"profiles")?,
                    b"infoLinks" => read_infolinks_into(&mut entry.info_links, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                // Self-closing containers (e.g. <costs/>) have no children to read.
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"selectionEntry" => {
                    return Ok(entry)
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in selectionEntry".to_string(),
                ))
            }
        }
    }
}

fn read_groups_into(
    dst: &mut Vec<RawGroup>,
    r: &mut SafeXmlReader,
    container_end: &[u8],
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"selectionEntryGroup" => {
                    dst.push(read_group(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"selectionEntryGroup" => {
                    dst.push(RawGroup {
                        id: attr(&e, b"id").unwrap_or_default(),
                        name: attr(&e, b"name").unwrap_or_default(),
                        default_selection_entry_id: attr(&e, b"defaultSelectionEntryId").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in selectionEntryGroups container".to_string(),
                ))
            }
        }
    }
}

fn read_group(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawGroup, ParseError> {
    let mut group = RawGroup {
        id: attr(start, b"id").unwrap_or_default(),
        name: attr(start, b"name").unwrap_or_default(),
        default_selection_entry_id: attr(start, b"defaultSelectionEntryId").unwrap_or_default(),
        hidden: attr_bool(start, b"hidden"),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"constraints" => read_constraints_into(&mut group.constraints, r)?,
                    b"selectionEntries" => {
                        read_entries_into(&mut group.entries, r, b"selectionEntries")?
                    }
                    b"selectionEntryGroups" => {
                        read_groups_into(&mut group.groups, r, b"selectionEntryGroups")?
                    }
                    b"entryLinks" => read_entrylinks_into(&mut group.entry_links, r)?,
                    b"modifiers" => read_modifiers_into(&mut group.modifiers, r)?,
                    b"profiles" => read_profiles_into(&mut group.profiles, r, b"profiles")?,
                    b"infoLinks" => read_infolinks_into(&mut group.info_links, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"selectionEntryGroup" => {
                    return Ok(group)
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in selectionEntryGroup".to_string(),
                ))
            }
        }
    }
}

fn read_forces_into(
    dst: &mut Vec<RawForce>,
    r: &mut SafeXmlReader,
    container_end: &[u8],
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"forceEntry" => {
                    dst.push(read_force(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"forceEntry" => {
                    dst.push(RawForce {
                        id: attr(&e, b"id").unwrap_or_default(),
                        name: attr(&e, b"name").unwrap_or_default(),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in forceEntries container".to_string(),
                ))
            }
        }
    }
}

fn read_force(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawForce, ParseError> {
    let mut force = RawForce {
        id: attr(start, b"id").unwrap_or_default(),
        name: attr(start, b"name").unwrap_or_default(),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"constraints" => read_constraints_into(&mut force.constraints, r)?,
                    b"categoryLinks" => read_catlinks_into(&mut force.category_links, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"forceEntry" => return Ok(force),
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in forceEntry".to_string(),
                ))
            }
        }
    }
}

fn read_costs_into(dst: &mut Vec<RawCost>, r: &mut SafeXmlReader) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"cost" => {
                    dst.push(RawCost {
                        type_id: attr(&e, b"typeId").unwrap_or_default(),
                        value: attr_f64(&e, b"value").unwrap_or(0.0),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"costs" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => return Err(ParseError::MalformedXml("unexpected EOF in costs".to_string())),
        }
    }
}

fn read_profiles_into(
    dst: &mut Vec<RawProfile>,
    r: &mut SafeXmlReader,
    container_end: &[u8],
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"profile" => {
                    dst.push(read_profile(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"profile" => {
                    dst.push(RawProfile {
                        id: attr(&e, b"id").unwrap_or_default(),
                        name: attr(&e, b"name").unwrap_or_default(),
                        type_name: attr(&e, b"typeName").unwrap_or_default(),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in profiles".to_string()))
            }
        }
    }
}

/// Read a `<profileTypes>` block: each `<profileType>` nests its own
/// `<characteristicTypes>` list of `<characteristicType id name/>` — the
/// id->name decode a characteristic-modifier's `field` is looked up against.
/// Flattened across every profileType into one map (see RawCatalogue's field doc).
fn read_profile_types_into(
    dst: &mut std::collections::HashMap<String, String>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"profileType" => {
                    read_profile_type_into(dst, r)?;
                }
                Event::Empty(e) if e.local_name().as_ref() == b"profileType" => {}
                Event::End(end) if end.local_name().as_ref() == b"profileTypes" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in profileTypes".to_string(),
                ))
            }
        }
    }
}

fn read_profile_type_into(
    dst: &mut std::collections::HashMap<String, String>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"characteristicTypes" => {
                    read_characteristic_types_into(dst, r)?;
                }
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"profileType" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in profileType".to_string(),
                ))
            }
        }
    }
}

fn read_characteristic_types_into(
    dst: &mut std::collections::HashMap<String, String>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"characteristicType" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        dst.insert(id, name);
                    }
                    skip_element(r, b"characteristicType")?;
                }
                Event::Empty(e) if e.local_name().as_ref() == b"characteristicType" => {
                    if let (Some(id), Some(name)) = (attr(&e, b"id"), attr(&e, b"name")) {
                        dst.insert(id, name);
                    }
                }
                Event::End(end) if end.local_name().as_ref() == b"characteristicTypes" => {
                    return Ok(())
                }
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in characteristicTypes".to_string(),
                ))
            }
        }
    }
}

/// Read a `<infoLinks>` block (typically inside a selectionEntry/Group). An
/// <infoLink> is normally self-closing; a rare one with children (e.g. its own
/// modifiers) has them skipped, since only the target/type/hidden matter here.
fn read_infolinks_into(dst: &mut Vec<RawInfoLink>, r: &mut SafeXmlReader) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Empty(e) if e.local_name().as_ref() == b"infoLink" => {
                    dst.push(RawInfoLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                    });
                }
                Event::Start(e) if e.local_name().as_ref() == b"infoLink" => {
                    dst.push(RawInfoLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                    });
                    skip_element(r, b"infoLink")?; // consume the (rare) child subtree
                }
                Event::End(end) if end.local_name().as_ref() == b"infoLinks" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => return Err(ParseError::MalformedXml("unexpected EOF in infoLinks".to_string())),
        }
    }
}

fn read_profile(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawProfile, ParseError> {
    let mut p = RawProfile {
        id: attr(start, b"id").unwrap_or_default(),
        name: attr(start, b"name").unwrap_or_default(),
        type_name: attr(start, b"typeName").unwrap_or_default(),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"characteristics" => read_characteristics_into(&mut p.characteristics, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"profile" => return Ok(p),
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in profile".to_string()))
            }
        }
    }
}

fn read_characteristics_into(
    dst: &mut Vec<RawCharacteristic>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"characteristic" => {
                    let name = attr(&e, b"name").unwrap_or_default();
                    let value = read_text_until(r, b"characteristic")?;
                    dst.push(RawCharacteristic { name, value });
                }
                Event::Empty(e) if e.local_name().as_ref() == b"characteristic" => {
                    dst.push(RawCharacteristic {
                        name: attr(&e, b"name").unwrap_or_default(),
                        value: String::new(),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"characteristics" => {
                    return Ok(())
                }
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in characteristics".to_string(),
                ))
            }
        }
    }
}

/// Second flat pass collecting every rule definition's text, keyed by the rule's
/// `name` and (when present) its `<alias>`. <rule> elements are definitions that
/// carry a <description>; <infoLink> references have no description and are ignored
/// because they are not <rule> elements. Self-closing <rule/> has no body and is
/// skipped. Keyed into a BTreeMap for deterministic serialization downstream.
fn read_all_rules(bytes: &[u8]) -> Result<BTreeMap<String, String>, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    while let Some(ev) = r.read_event()? {
        if let Event::Start(e) = ev.event {
            if e.local_name().as_ref() == b"rule" {
                let name = attr(&e, b"name");
                let (desc, alias) = read_rule_body(&mut r)?;
                if let Some(desc) = desc.filter(|d| !d.is_empty()) {
                    if let Some(name) = name.filter(|n| !n.is_empty()) {
                        out.insert(name, desc.clone());
                    }
                    if let Some(alias) = alias.filter(|a| !a.is_empty()) {
                        out.insert(alias, desc);
                    }
                }
            }
        }
    }
    Ok(out)
}

/// Read a <rule>'s children until </rule>, returning (description, alias) text.
fn read_rule_body(r: &mut SafeXmlReader) -> Result<(Option<String>, Option<String>), ParseError> {
    let mut desc: Option<String> = None;
    let mut alias: Option<String> = None;
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"description" => desc = Some(read_text_until(r, b"description")?),
                    b"alias" => alias = Some(read_text_until(r, b"alias")?),
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                // Self-closing children (e.g. <alias/>) carry no text.
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"rule" => {
                    return Ok((desc, alias))
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in rule".to_string(),
                ))
            }
        }
    }
}

/// Collect text content until the matching end tag, unescaping XML entities.
fn read_text_until(r: &mut SafeXmlReader, end: &[u8]) -> Result<String, ParseError> {
    let mut out = String::new();
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Text(t) => {
                    let s = t
                        .decode()
                        .map_err(|e| ParseError::MalformedXml(e.to_string()))?;
                    out.push_str(&s);
                }
                // quick-xml 0.41 splits `&entity;` references out of `Text` into their
                // own `GeneralRef` event rather than pre-unescaping them inline.
                Event::GeneralRef(bref) => {
                    match bref
                        .resolve_char_ref()
                        .map_err(|e| ParseError::MalformedXml(e.to_string()))?
                    {
                        Some(ch) => out.push(ch),
                        None => {
                            let name = bref
                                .decode()
                                .map_err(|e| ParseError::MalformedXml(e.to_string()))?;
                            match quick_xml::escape::resolve_xml_entity(&name) {
                                Some(resolved) => out.push_str(resolved),
                                None => {
                                    return Err(ParseError::MalformedXml(format!(
                                        "unknown XML entity &{};",
                                        name
                                    )))
                                }
                            }
                        }
                    }
                }
                Event::End(e) if e.local_name().as_ref() == end => return Ok(out.trim().to_string()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml("unexpected EOF in text element".to_string()))
            }
        }
    }
}

fn read_catlinks_into(
    dst: &mut Vec<RawCategoryLink>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                // A <categoryLink> with children (its nested <constraints> carry the
                // per-category min/max, e.g. "1-2 HQ") is read fully; the category
                // it targets is this link's own targetId — an unambiguous FK.
                Event::Start(e) if e.local_name().as_ref() == b"categoryLink" => {
                    dst.push(read_catlink(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"categoryLink" => {
                    dst.push(RawCategoryLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        primary: attr_bool(&e, b"primary"),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"categoryLinks" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in categoryLinks".to_string(),
                ))
            }
        }
    }
}

fn read_catlink(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawCategoryLink, ParseError> {
    let mut link = RawCategoryLink {
        target_id: attr(start, b"targetId").unwrap_or_default(),
        primary: attr_bool(start, b"primary"),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"constraints" => read_constraints_into(&mut link.constraints, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"categoryLink" => {
                    return Ok(link)
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in categoryLink".to_string(),
                ))
            }
        }
    }
}

fn read_entrylinks_into(
    dst: &mut Vec<RawEntryLink>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Empty(e) if e.local_name().as_ref() == b"entryLink" => {
                    dst.push(RawEntryLink {
                        id: attr(&e, b"id").unwrap_or_default(),
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        ..Default::default()
                    });
                }
                Event::Start(e) if e.local_name().as_ref() == b"entryLink" => {
                    let mut link = RawEntryLink {
                        id: attr(&e, b"id").unwrap_or_default(),
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        modifiers: Vec::new(),
                        ..Default::default()
                    };
                    loop {
                        match r.read_event()? {
                            Some(inner) => match inner.event {
                                Event::Start(m) => match m.local_name().as_ref() {
                                    b"modifiers" => read_modifiers_into(&mut link.modifiers, r)?,
                                    b"selectionEntries" => {
                                        read_entries_into(&mut link.entries, r, b"selectionEntries")?
                                    }
                                    b"selectionEntryGroups" => {
                                        read_groups_into(&mut link.groups, r, b"selectionEntryGroups")?
                                    }
                                    b"entryLinks" => read_entrylinks_into(&mut link.entry_links, r)?,
                                    b"constraints" => read_constraints_into(&mut link.constraints, r)?,
                                    b"categoryLinks" => read_catlinks_into(&mut link.category_links, r)?,
                                    b"costs" => read_costs_into(&mut link.costs, r)?,
                                    b"profiles" => read_profiles_into(&mut link.profiles, r, b"profiles")?,
                                    b"infoLinks" => read_infolinks_into(&mut link.info_links, r)?,
                                    other => {
                                        let name = other.to_vec();
                                        skip_element(r, &name)?;
                                    }
                                },
                                Event::End(end) if end.local_name().as_ref() == b"entryLink" => break,
                                _ => {}
                            },
                            None => return Err(ParseError::MalformedXml(
                                "unexpected EOF in entryLink".to_string(),
                            )),
                        }
                    }
                    dst.push(link);
                }
                Event::End(end) if end.local_name().as_ref() == b"entryLinks" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in entryLinks".to_string(),
                ))
            }
        }
    }
}

/// Read a catalogue-level `<catalogueLinks>` block. We keep only what root-import
/// needs: the link's `targetId` (which equals the target catalogue's `id`) and its
/// `importRootEntries` flag. A link is normally self-closing; a rare one with
/// children (e.g. its own modifiers) has them skipped.
fn read_cataloguelinks_into(
    dst: &mut Vec<RawCatalogueLink>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Empty(e) if e.local_name().as_ref() == b"catalogueLink" => {
                    dst.push(RawCatalogueLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        import_root_entries: attr_bool(&e, b"importRootEntries"),
                    });
                }
                Event::Start(e) if e.local_name().as_ref() == b"catalogueLink" => {
                    dst.push(RawCatalogueLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        import_root_entries: attr_bool(&e, b"importRootEntries"),
                    });
                    skip_element(r, b"catalogueLink")?;
                }
                Event::End(end) if end.local_name().as_ref() == b"catalogueLinks" => return Ok(()),
                Event::Start(e) => skip_element(r, e.local_name().as_ref())?,
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in catalogueLinks".to_string(),
                ))
            }
        }
    }
}

fn read_constraints_into(
    dst: &mut Vec<RawConstraint>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"constraint" => {
                    dst.push(RawConstraint {
                        id: attr(&e, b"id").unwrap_or_default(),
                        kind: attr(&e, b"type").unwrap_or_default(),
                        value: attr_f64(&e, b"value").unwrap_or(0.0),
                        field: attr(&e, b"field").unwrap_or_default(),
                        scope: attr(&e, b"scope").unwrap_or_default(),
                        include_child_selections: attr_bool(&e, b"includeChildSelections"),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"constraints" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in constraints".to_string(),
                ))
            }
        }
    }
}

fn read_modifiers_into(
    dst: &mut Vec<RawModifier>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"modifier" => {
                    dst.push(read_modifier(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"modifier" => {
                    dst.push(RawModifier {
                        kind: attr(&e, b"type").unwrap_or_default(),
                        field: attr(&e, b"field").unwrap_or_default(),
                        value: attr_f64(&e, b"value").unwrap_or(0.0),
                        value_raw: attr(&e, b"value").unwrap_or_default(),
                        scope: attr(&e, b"scope").unwrap_or_default(),
                        affects: attr(&e, b"affects").unwrap_or_default(),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"modifiers" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in modifiers".to_string(),
                ))
            }
        }
    }
}

fn read_modifier(start: &BytesStart, r: &mut SafeXmlReader) -> Result<RawModifier, ParseError> {
    let mut modifier = RawModifier {
        kind: attr(start, b"type").unwrap_or_default(),
        field: attr(start, b"field").unwrap_or_default(),
        value: attr_f64(start, b"value").unwrap_or(0.0),
        value_raw: attr(start, b"value").unwrap_or_default(),
        scope: attr(start, b"scope").unwrap_or_default(),
        affects: attr(start, b"affects").unwrap_or_default(),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"conditions" => read_conditions_into(&mut modifier.conditions, r)?,
                    b"conditionGroups" => {
                        read_condition_groups_into(&mut modifier.condition_groups, r)?
                    }
                    b"repeats" => {
                        modifier.has_repeats = true;
                        skip_element(r, b"repeats")?;
                    }
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(e) if e.local_name().as_ref() == b"repeats" => {
                    modifier.has_repeats = true;
                }
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"modifier" => {
                    return Ok(modifier)
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in modifier".to_string(),
                ))
            }
        }
    }
}

fn read_conditions_into(
    dst: &mut Vec<RawCondition>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"condition" => {
                    dst.push(RawCondition {
                        comparator: attr(&e, b"type").unwrap_or_default(),
                        field: attr(&e, b"field").unwrap_or_default(),
                        scope: attr(&e, b"scope").unwrap_or_default(),
                        value: attr_f64(&e, b"value").unwrap_or(0.0),
                        child_id: attr(&e, b"childId").unwrap_or_default(),
                        include_child_selections: attr_bool(&e, b"includeChildSelections"),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"conditions" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in conditions".to_string(),
                ))
            }
        }
    }
}

fn read_condition_groups_into(
    dst: &mut Vec<RawConditionGroup>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) if e.local_name().as_ref() == b"conditionGroup" => {
                    dst.push(read_condition_group(&e, r)?);
                }
                Event::Empty(e) if e.local_name().as_ref() == b"conditionGroup" => {
                    dst.push(RawConditionGroup {
                        kind: attr(&e, b"type").unwrap_or_default(),
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"conditionGroups" => {
                    return Ok(())
                }
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in conditionGroups".to_string(),
                ))
            }
        }
    }
}

fn read_condition_group(
    start: &BytesStart,
    r: &mut SafeXmlReader,
) -> Result<RawConditionGroup, ParseError> {
    let mut group = RawConditionGroup {
        kind: attr(start, b"type").unwrap_or_default(),
        ..Default::default()
    };
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"conditions" => read_conditions_into(&mut group.conditions, r)?,
                    b"conditionGroups" => read_condition_groups_into(&mut group.groups, r)?,
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"conditionGroup" => {
                    return Ok(group)
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in conditionGroup".to_string(),
                ))
            }
        }
    }
}
