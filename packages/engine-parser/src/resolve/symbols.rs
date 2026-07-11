use std::collections::HashMap;

use crate::error::ParseError;
use crate::raw::{RawCatalogue, RawEntry, RawGroup};

/// Symbol table indexing all shared entries and groups (and their nested
/// entries/groups) by id. Entries resolve `selectionEntry` links; groups resolve
/// `selectionEntryGroup` links.
#[derive(Debug)]
pub struct SymbolTable {
    entries: HashMap<String, RawEntry>,
    groups: HashMap<String, RawGroup>,
}

impl SymbolTable {
    /// Build a symbol table from a raw catalogue, indexing all shared entries and
    /// groups and their nested entries/groups by id. Returns an error on any
    /// duplicate entry id or duplicate group id.
    pub fn build(cat: &RawCatalogue) -> Result<SymbolTable, ParseError> {
        let mut entries = HashMap::new();
        let mut groups = HashMap::new();

        for entry in &cat.shared_entries {
            walk_entry(entry, &mut entries, &mut groups)?;
        }
        for group in &cat.shared_groups {
            walk_group(group, &mut entries, &mut groups)?;
        }

        Ok(SymbolTable { entries, groups })
    }

    /// Look up an entry by id (selectionEntry link target).
    pub fn entry(&self, id: &str) -> Option<&RawEntry> {
        self.entries.get(id)
    }

    /// Look up a group by id (selectionEntryGroup link target).
    pub fn group(&self, id: &str) -> Option<&RawGroup> {
        self.groups.get(id)
    }
}

/// Recursively walk an entry and all its nested entries/groups, inserting each
/// entry into `entries` and each group into `groups`. Errors on a duplicate id.
fn walk_entry(
    entry: &RawEntry,
    entries: &mut HashMap<String, RawEntry>,
    groups: &mut HashMap<String, RawGroup>,
) -> Result<(), ParseError> {
    if entries.contains_key(&entry.id) {
        return Err(ParseError::MalformedXml(format!(
            "Duplicate entry id in catalogue: {}",
            entry.id
        )));
    }
    entries.insert(entry.id.clone(), entry.clone());

    for nested_entry in &entry.entries {
        walk_entry(nested_entry, entries, groups)?;
    }
    for group in &entry.groups {
        walk_group(group, entries, groups)?;
    }

    Ok(())
}

/// Recursively walk a group: index the group itself by id, then recurse into its
/// nested entries/groups. Errors on a duplicate group id. Groups with an empty id
/// (not link-addressable) are indexed-skipped but still recursed.
fn walk_group(
    group: &RawGroup,
    entries: &mut HashMap<String, RawEntry>,
    groups: &mut HashMap<String, RawGroup>,
) -> Result<(), ParseError> {
    if !group.id.is_empty() {
        if groups.contains_key(&group.id) {
            return Err(ParseError::MalformedXml(format!(
                "Duplicate group id in catalogue: {}",
                group.id
            )));
        }
        groups.insert(group.id.clone(), group.clone());
    }

    for entry in &group.entries {
        walk_entry(entry, entries, groups)?;
    }
    for nested_group in &group.groups {
        walk_group(nested_group, entries, groups)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> RawEntry {
        RawEntry { id: id.into(), entry_type: "upgrade".into(), ..Default::default() }
    }
    fn group(id: &str) -> RawGroup {
        RawGroup { id: id.into(), ..Default::default() }
    }

    #[test]
    fn indexes_top_level_and_nested_groups() {
        let mut nested = group("g.nested");
        nested.entries.push(entry("e.in.group"));
        let mut shared = entry("e.shared");
        shared.groups.push(group("g.in.entry"));
        let cat = RawCatalogue {
            id: "c".into(),
            shared_entries: vec![shared],
            shared_groups: vec![nested],
            ..Default::default()
        };
        let st = SymbolTable::build(&cat).unwrap();
        assert!(st.group("g.nested").is_some(), "top-level shared group indexed");
        assert!(st.group("g.in.entry").is_some(), "group nested in an entry indexed");
        assert!(st.entry("e.in.group").is_some(), "entry nested in a group still indexed");
        assert!(st.entry("e.shared").is_some());
        assert!(st.group("nope").is_none());
    }

    #[test]
    fn duplicate_group_id_is_malformed() {
        let cat = RawCatalogue {
            id: "c".into(),
            shared_groups: vec![group("dup"), group("dup")],
            ..Default::default()
        };
        assert!(matches!(SymbolTable::build(&cat), Err(ParseError::MalformedXml(_))));
    }

    #[test]
    fn empty_id_groups_do_not_collide() {
        // The raw parser defaults a missing group id to "" (unwrap_or_default), so
        // real files can carry several id-less groups. They are not link-addressable
        // and must not spuriously trip the duplicate-id hard error.
        let cat = RawCatalogue {
            id: "c".into(),
            shared_groups: vec![group(""), group("")],
            ..Default::default()
        };
        let st = SymbolTable::build(&cat).unwrap();
        assert!(st.group("").is_none(), "empty-id groups are not indexed");
    }
}
