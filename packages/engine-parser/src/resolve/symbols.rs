use std::collections::HashMap;

use crate::error::ParseError;
use crate::raw::{RawCatalogue, RawEntry, RawGroup};

/// Symbol table indexing all shared entries (and nested entries) by id.
/// Used for resolving entryLinks (Task 9).
#[derive(Debug)]
pub struct SymbolTable {
    entries: HashMap<String, RawEntry>,
}

impl SymbolTable {
    /// Build a symbol table from a raw catalogue, indexing all shared entries
    /// and their nested entries by id. Returns an error if any duplicate ids
    /// are found.
    pub fn build(cat: &RawCatalogue) -> Result<SymbolTable, ParseError> {
        let mut entries = HashMap::new();

        // Walk all top-level shared entries
        for entry in &cat.shared_entries {
            walk_entry(entry, &mut entries)?;
        }

        // Walk all top-level shared groups (and their nested entries)
        for group in &cat.shared_groups {
            walk_group(group, &mut entries)?;
        }

        Ok(SymbolTable { entries })
    }

    /// Look up an entry by id.
    pub fn entry(&self, id: &str) -> Option<&RawEntry> {
        self.entries.get(id)
    }
}

/// Recursively walk an entry and all its nested entries/groups, inserting each
/// into the symbol table. Returns an error if a duplicate id is found.
fn walk_entry(
    entry: &RawEntry,
    table: &mut HashMap<String, RawEntry>,
) -> Result<(), ParseError> {
    // Check for duplicate id
    if table.contains_key(&entry.id) {
        return Err(ParseError::MalformedXml(format!(
            "Duplicate entry id in catalogue: {}",
            entry.id
        )));
    }

    // Insert this entry
    table.insert(entry.id.clone(), entry.clone());

    // Recurse into nested entries
    for nested_entry in &entry.entries {
        walk_entry(nested_entry, table)?;
    }

    // Recurse into nested groups
    for group in &entry.groups {
        walk_group(group, table)?;
    }

    Ok(())
}

/// Recursively walk a group and all its nested entries/groups, inserting each
/// entry into the symbol table. Returns an error if a duplicate id is found.
fn walk_group(
    group: &RawGroup,
    table: &mut HashMap<String, RawEntry>,
) -> Result<(), ParseError> {
    // Recurse into nested entries
    for entry in &group.entries {
        walk_entry(entry, table)?;
    }

    // Recurse into nested groups
    for nested_group in &group.groups {
        walk_group(nested_group, table)?;
    }

    Ok(())
}
