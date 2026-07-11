use std::collections::HashSet;
use crate::error::{Diagnostic, ParseError};
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

// Resolution inlines every entryLink into a resolved copy of its target,
// recursively, clearing entry_links. A path visited-set makes a reference CYCLE
// a typed error; a node budget and depth cap make acyclic fan-out/long chains
// typed errors too (both are DoS vectors past the parse-time limits). An
// unresolvable target (defined in another file) is a diagnostic + drop, never
// an error and never an invented subtree.

/// Resolve, discarding diagnostics. Kept for callers that don't need them.
pub fn resolve(cat: RawCatalogue) -> Result<RawCatalogue, ParseError> {
    let mut diags = Vec::new();
    resolve_with_caps(cat, MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH, &mut diags)
}

/// Resolve, collecting diagnostics (unresolvable entryLinks). Used by the
/// pipeline (`parse_bytes`) so incompleteness is loud, not silent.
pub fn resolve_with_diags(cat: RawCatalogue, diags: &mut Vec<Diagnostic>)
    -> Result<RawCatalogue, ParseError> {
    resolve_with_caps(cat, MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH, diags)
}

pub(crate) fn resolve_with_caps(mut cat: RawCatalogue, max_nodes: u64, max_depth: usize,
    diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let symbols = SymbolTable::build(&cat)?;
    let mut path: HashSet<String> = HashSet::new();
    let mut budget = Budget { nodes: 0, max_nodes, max_depth };
    let mut resolved = Vec::with_capacity(cat.entries.len());
    for e in &cat.entries {
        resolved.push(resolve_entry(e, &symbols, &mut path, &mut budget, diags, 1)?);
    }
    cat.entries = resolved;

    // Surface catalogue-level entryLinks (roster roots) as resolved root
    // entries, reusing the same inlining, cycle-guard and shared node/depth
    // budget. Danglers (target in another file) are diagnosed and dropped —
    // never invented.
    let root_links = std::mem::take(&mut cat.entry_links);
    for link in &root_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        // Seed the path with this root's target so a descendant that links back
        // to it is caught as a cycle inside resolve_entry. Roots are processed
        // sequentially with an empty path each iteration, so no pre-check here.
        path.insert(link.target_id.clone());
        let root = resolve_entry(target, &symbols, &mut path, &mut budget, diags, 1)?;
        path.remove(&link.target_id);
        cat.entries.push(root);
    }
    Ok(cat)
}

/// A dropped entryLink whose target is not in this file (root or nested).
fn unresolved_link_diag(target_id: &str) -> Diagnostic {
    Diagnostic {
        code: "entryLink.unresolved".to_string(),
        message: format!("entryLink target {} not found in this file (dropped)", target_id),
    }
}

fn resolve_entry(entry: &RawEntry, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize) -> Result<RawEntry, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = entry.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &entry.entries {
        children.push(resolve_entry(child, symbols, path, budget, diags, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &entry.groups {
        groups.push(resolve_group(g, symbols, path, budget, diags, depth + 1)?);
    }
    for link in &entry.entry_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved_target);
    }
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}

fn resolve_group(group: &RawGroup, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize) -> Result<RawGroup, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = group.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &group.entries {
        children.push(resolve_entry(child, symbols, path, budget, diags, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &group.groups {
        groups.push(resolve_group(g, symbols, path, budget, diags, depth + 1)?);
    }
    for link in &group.entry_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        children.push(resolve_entry(target, symbols, path, budget, diags, depth + 1)?);
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
        assert!(matches!(resolve_with_caps(cat, 1000, 10_000, &mut Vec::new()), Err(ParseError::ResolvedTooLarge(_))));
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
        assert!(matches!(resolve_with_caps(cat, u64::MAX, 10, &mut Vec::new()), Err(ParseError::ResolveTooDeep(_))));
    }
}
