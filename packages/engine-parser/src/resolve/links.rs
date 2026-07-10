use std::collections::HashSet;

use crate::error::ParseError;
use crate::raw::{RawCatalogue, RawEntry, RawGroup};

use super::symbols::SymbolTable;

/// Inline every entryLink into a resolved copy of its target, recursively,
/// clearing entry_links. A visited-set over the current inlining PATH makes a
/// reference cycle a typed error instead of unbounded recursion.
pub fn resolve(mut cat: RawCatalogue) -> Result<RawCatalogue, ParseError> {
    let symbols = SymbolTable::build(&cat)?;
    let mut path: HashSet<String> = HashSet::new();

    let resolved: Result<Vec<_>, _> = cat
        .entries
        .iter()
        .map(|e| resolve_entry(e, &symbols, &mut path))
        .collect();
    cat.entries = resolved?;

    Ok(cat)
}

fn resolve_entry(
    entry: &RawEntry,
    symbols: &SymbolTable,
    path: &mut HashSet<String>,
) -> Result<RawEntry, ParseError> {
    let mut out = entry.clone();

    // Resolve pre-existing nested children first.
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &entry.entries {
        children.push(resolve_entry(child, symbols, path)?);
    }

    // Resolve nested groups.
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &entry.groups {
        groups.push(resolve_group(g, symbols, path)?);
    }

    // Inline each entry link as a resolved child.
    for link in &entry.entry_links {
        let target = symbols
            .entry(&link.target_id)
            .ok_or_else(|| ParseError::UnresolvedRef(link.target_id.clone()))?;
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, symbols, path);
        path.remove(&link.target_id);
        children.push(resolved_target?);
    }

    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}

fn resolve_group(
    group: &RawGroup,
    symbols: &SymbolTable,
    path: &mut HashSet<String>,
) -> Result<RawGroup, ParseError> {
    let mut out = group.clone();

    let mut children: Vec<RawEntry> = Vec::new();
    for child in &group.entries {
        children.push(resolve_entry(child, symbols, path)?);
    }

    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &group.groups {
        groups.push(resolve_group(g, symbols, path)?);
    }

    for link in &group.entry_links {
        let target = symbols
            .entry(&link.target_id)
            .ok_or_else(|| ParseError::UnresolvedRef(link.target_id.clone()))?;
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, symbols, path);
        path.remove(&link.target_id);
        children.push(resolved_target?);
    }

    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}
