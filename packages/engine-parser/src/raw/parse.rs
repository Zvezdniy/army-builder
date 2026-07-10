use quick_xml::events::{BytesStart, Event};
use crate::error::ParseError;
use crate::xml::SafeXmlReader;
use super::model::{
    RawCatalogue, RawCategoryLink, RawConstraint, RawCost, RawEntry, RawEntryLink, RawForce,
    RawGroup,
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
                b"sharedSelectionEntries" => {
                    read_entries_into(&mut cat.shared_entries, &mut r, b"sharedSelectionEntries")?
                }
                b"sharedSelectionEntryGroups" => {
                    read_groups_into(&mut cat.shared_groups, &mut r, b"sharedSelectionEntryGroups")?
                }
                b"selectionEntries" => read_entries_into(&mut cat.entries, &mut r, b"selectionEntries")?,
                b"forceEntries" => read_forces_into(&mut cat.force_entries, &mut r, b"forceEntries")?,
                b"catalogueLinks" => skip_element(&mut r, b"catalogueLinks")?,
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
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
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
                    // Task 7 replaces this skip with real modifier/condition parsing.
                    b"modifiers" => skip_element(r, b"modifiers")?,
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
                        ..Default::default()
                    });
                }
                Event::End(end) if end.local_name().as_ref() == container_end => return Ok(()),
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
                    b"modifiers" => skip_element(r, b"modifiers")?,
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
                _ => {}
            },
            None => return Err(ParseError::MalformedXml("unexpected EOF in costs".to_string())),
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
                Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"categoryLink" => {
                    dst.push(RawCategoryLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        primary: attr_bool(&e, b"primary"),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"categoryLinks" => return Ok(()),
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

fn read_entrylinks_into(
    dst: &mut Vec<RawEntryLink>,
    r: &mut SafeXmlReader,
) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"entryLink" => {
                    dst.push(RawEntryLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                    });
                }
                Event::End(end) if end.local_name().as_ref() == b"entryLinks" => return Ok(()),
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
