use std::collections::HashSet;
use crate::error::ParseError;
use crate::limits::{MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH};
use crate::raw::{RawCatalogue, RawEntry, RawGroup};
use super::symbols::SymbolTable;

struct Budget { nodes: u64, max_nodes: u64, max_depth: usize }

impl Budget {
    fn account(&mut self) -> Result<(), ParseError> {
        self.nodes += 1;
        if self.nodes > self.max_nodes {
            return Err(ParseError::ResolvedTooLarge(self.max_nodes));
        }
        Ok(())
    }
    fn check_depth(&self, depth: usize) -> Result<(), ParseError> {
        if depth > self.max_depth {
            return Err(ParseError::ResolveTooDeep(self.max_depth));
        }
        Ok(())
    }
}

/// Inline every entryLink into a resolved copy of its target, recursively,
/// clearing entry_links. A path visited-set makes a reference CYCLE a typed
/// error; a node budget and depth cap make acyclic fan-out/long chains typed
/// errors too (both are DoS vectors past the parse-time limits).
pub fn resolve(cat: RawCatalogue) -> Result<RawCatalogue, ParseError> {
    resolve_with_caps(cat, MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH)
}

pub(crate) fn resolve_with_caps(mut cat: RawCatalogue, max_nodes: u64, max_depth: usize)
    -> Result<RawCatalogue, ParseError> {
    let symbols = SymbolTable::build(&cat)?;
    let mut path: HashSet<String> = HashSet::new();
    let mut budget = Budget { nodes: 0, max_nodes, max_depth };
    let resolved: Result<Vec<_>, _> = cat.entries.iter()
        .map(|e| resolve_entry(e, &symbols, &mut path, &mut budget, 1)).collect();
    cat.entries = resolved?;
    Ok(cat)
}

fn resolve_entry(entry: &RawEntry, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, depth: usize) -> Result<RawEntry, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = entry.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &entry.entries {
        children.push(resolve_entry(child, symbols, path, budget, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &entry.groups {
        groups.push(resolve_group(g, symbols, path, budget, depth + 1)?);
    }
    for link in &entry.entry_links {
        let target = symbols.entry(&link.target_id)
            .ok_or_else(|| ParseError::UnresolvedRef(link.target_id.clone()))?;
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, symbols, path, budget, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved_target);
    }
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}

fn resolve_group(group: &RawGroup, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, depth: usize) -> Result<RawGroup, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = group.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &group.entries {
        children.push(resolve_entry(child, symbols, path, budget, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &group.groups {
        groups.push(resolve_group(g, symbols, path, budget, depth + 1)?);
    }
    for link in &group.entry_links {
        let target = symbols.entry(&link.target_id)
            .ok_or_else(|| ParseError::UnresolvedRef(link.target_id.clone()))?;
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        children.push(resolve_entry(target, symbols, path, budget, depth + 1)?);
        path.remove(&link.target_id);
    }
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw::RawEntryLink;

    fn link(target: &str) -> RawEntryLink {
        RawEntryLink { target_id: target.to_string(), link_type: String::new() }
    }
    fn entry(id: &str, links: Vec<RawEntryLink>) -> RawEntry {
        RawEntry { id: id.to_string(), entry_type: "upgrade".into(), entry_links: links, ..Default::default() }
    }

    #[test]
    fn fanout_diamond_hits_node_budget() {
        // root -> A0; each Ai links TWICE to A(i+1). Acyclic (no cycle guard hit),
        // but resolves to O(2^k) nodes. A small node budget must stop it.
        let k = 20;
        let mut shared = Vec::new();
        for i in 0..k {
            shared.push(entry(&format!("A{i}"), vec![link(&format!("A{}", i + 1)), link(&format!("A{}", i + 1))]));
        }
        shared.push(entry(&format!("A{k}"), vec![]));
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![entry("root", vec![link("A0")])],
            shared_entries: shared,
            ..Default::default()
        };
        assert!(matches!(resolve_with_caps(cat, 1000, 10_000), Err(ParseError::ResolvedTooLarge(_))));
    }

    #[test]
    fn linear_chain_hits_depth_cap() {
        // A single long chain L0->L1->...->Ln recurses n deep; a small depth cap
        // must stop it before a native stack overflow (node budget huge so depth trips first).
        let n = 100;
        let mut shared = Vec::new();
        for i in 0..n {
            shared.push(entry(&format!("L{i}"), vec![link(&format!("L{}", i + 1))]));
        }
        shared.push(entry(&format!("L{n}"), vec![]));
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![entry("root", vec![link("L0")])],
            shared_entries: shared,
            ..Default::default()
        };
        assert!(matches!(resolve_with_caps(cat, u64::MAX, 10), Err(ParseError::ResolveTooDeep(_))));
    }
}
