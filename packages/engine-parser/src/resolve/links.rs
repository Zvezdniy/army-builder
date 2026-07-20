use std::collections::HashSet;
use crate::error::{Diagnostic, ParseError};
use crate::limits::{MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH};
use crate::raw::{RawCatalogue, RawEntry, RawEntryLink, RawGroup, RawInfoLink, RawProfile};
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
        let mut root = resolve_entry(target, &symbols, &mut path, &mut budget, diags, 1)?;
        // Applied while the target is still on the path, so inline content that
        // links back to it is caught as a cycle like any other descendant.
        apply_link_content(link, &mut root, &symbols, &mut path, &mut budget, diags, 1)?;
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

/// Resolve one entryLink into either a child entry or an inlined group,
/// dispatching on the link's declared target type. A `selectionEntryGroup` target
/// is looked up in the group index and pushed to `groups`; anything else is an
/// entry, looked up in the entry index and pushed to `children`. An unresolvable
/// target (absent from the index its type names) is diagnosed and dropped — never
/// cross-resolved against the other index. A link into a node already on the path
/// is a reference cycle. The node budget/depth cap are shared with entry resolution.
// The parameter list mirrors resolve_entry/resolve_group's threaded state (symbols,
// path, budget, diags, depth) plus the two output sinks; a context struct would
// diverge from that established threading style for no real gain.
#[allow(clippy::too_many_arguments)]
fn resolve_link(
    link: &RawEntryLink, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize,
    children: &mut Vec<RawEntry>, groups: &mut Vec<RawGroup>,
) -> Result<(), ParseError> {
    if link.link_type == "selectionEntryGroup" {
        let target = match symbols.group(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); return Ok(()); }
        };
        // STRICT cycle guard: unlike the softer diagnose-and-drop treatment
        // `resolve_link_children` gives a link's own directly-nested `entryLinks`
        // (see the comment there), this check does not distinguish a genuine
        // cross-catalogue cycle from an inline entry/group whose OWN ordinary
        // subtree (its normal `<entryLinks>`, resolved the standard way via
        // `resolve_entry`/`resolve_group`) links back to `link.target_id`. That
        // shape would abort as a typed `ReferenceCycle` here instead of being
        // dropped. Risk knowingly accepted: no real catalogue (10e or 11e) has
        // it today, unlike the direct nested-link case, which real data does
        // exercise (`Chaos - Chaos Knights Library`'s "Warlord", see below) and
        // which is why THAT case gets the relaxation and this one does not.
        // Widening this guard to cover arbitrary subtrees risks the same
        // duplicate-id-under-itself hazard the nested-link relaxation avoids. If
        // a real faction ever vanishes here, that is the signal to revisit.
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let mut resolved = resolve_group(target, symbols, path, budget, diags, depth + 1)?;
        // The link's own content applies to THIS placement only; `resolved` is a
        // fresh clone, so nothing written here reaches the shared target. Resolved
        // while the target is still on the path and with the same budget/depth
        // state, so cycles and the caps cover inline content unchanged.
        let mut inline_entries: Vec<RawEntry> = Vec::new();
        let mut inline_groups: Vec<RawGroup> = Vec::new();
        resolve_link_children(link, symbols, path, budget, diags, depth + 1,
            &mut inline_entries, &mut inline_groups)?;
        path.remove(&link.target_id);
        drop_inline_duplicate_ids(&link.target_id, &resolved.entries, &mut inline_entries,
            &resolved.groups, &mut inline_groups, diags);
        resolved.entries.extend(inline_entries);
        resolved.groups.extend(inline_groups);
        // Link constraints are additions, never overrides (verified across 11e:
        // zero link constraints share an id with one on their target).
        resolved.constraints.extend(link.constraints.iter().cloned());
        // A RawGroup has no costs/categoryLinks, and its profiles/infoLinks are not
        // mapped to IR (see resolve_group). Diagnose rather than mis-file or drop silently.
        // Name only what is actually present, so real-data triage of this code
        // reads as a list of concrete gaps rather than the same four words every time.
        let mut unsupported: Vec<&str> = Vec::new();
        if !link.costs.is_empty() { unsupported.push("costs"); }
        if !link.category_links.is_empty() { unsupported.push("categoryLinks"); }
        if !link.profiles.is_empty() { unsupported.push("profiles"); }
        if !link.info_links.is_empty() { unsupported.push("infoLinks"); }
        if !unsupported.is_empty() {
            diags.push(Diagnostic {
                code: "entryLink.group_content_unsupported".to_string(),
                message: format!(
                    "entryLink to group {} carries {}; unsupported (dropped)",
                    link.target_id, unsupported.join("/")),
            });
        }
        if link.hidden || link.modifiers.iter().any(|m| m.field == "hidden") {
            diags.push(Diagnostic {
                code: "entryLink.group_hidden_unsupported".to_string(),
                message: format!("entryLink to group {} carries hidden visibility; unsupported (dropped)", link.target_id),
            });
        }
        // Non-hidden link modifiers ride onto the cloned group; map_group_constraint
        // attaches any that target one of the group's own limits (per-placement
        // constraint override). Group visibility itself is not modeled, so hidden
        // modifiers are excluded (diagnosed above).
        for m in link.modifiers.iter().filter(|m| m.field != "hidden") {
            resolved.modifiers.push(m.clone());
        }
        groups.push(resolved);
    } else {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); return Ok(()); }
        };
        // STRICT cycle guard — same narrow-acceptance shape as the group branch
        // above: an inline entry/group's own ordinary subtree linking back to
        // `link.target_id` (as opposed to a link's directly-nested `entryLinks`,
        // which get the softer treatment in `resolve_link_children`) still lands
        // here and aborts as `ReferenceCycle`. No real catalogue has this shape
        // today; see the group-branch comment above for the full reasoning.
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let mut resolved = resolve_entry(target, symbols, path, budget, diags, depth + 1)?;
        apply_link_content(link, &mut resolved, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved);
    }
    Ok(())
}

/// Apply everything an entryLink declares — its static `hidden`, its
/// `<modifiers>` and the whole content it carries — onto the freshly-cloned
/// inlined instance. An entryLink is a PLACEMENT, not a bare pointer: the
/// children it declares belong to this placement only. `resolved` is unique per
/// placement, so nothing written here leaks to the shared target.
///
/// Modifiers are appended and routed downstream by map_entry exactly like one of
/// the target's own (hidden→visibility, cost-type→cost, error→validation,
/// category→category, constraint-id→constraint, else→modifier.target_unmapped).
/// The content merge is per collection:
/// - `entries`/`groups`/`entry_links` — resolved through the same recursion and
///   appended after the target's own, sharing the cycle path-set, node budget and
///   depth cap (`depth` here is the CLONE's depth). A nested `entry_link` back to
///   something already on the path is dropped with a diagnostic, not a cycle error
///   — see `resolve_link_children`. An inline entry/group whose id the clone
///   already carries is diagnosed and DROPPED, not kept — see
///   `drop_inline_duplicate_ids`.
/// - `constraints` — appended; a link constraint is always an addition (across all
///   of 11e, no link constraint shares an id with one on its target).
/// - `costs` — merged by cost-type id with the link's value WINNING, never
///   appended: a link that repeats its target's `pts 45` must not charge 90.
/// - `category_links` — merged by target category id: a repeat is skipped (never
///   appended a second time, since that would inflate category-scoped counts),
///   but its `constraints` are still merged onto the surviving link so a repeat
///   never silently discards a per-category limit.
/// - `profiles`/`info_links` — appended through the same path an entry uses.
#[allow(clippy::too_many_arguments)]
fn apply_link_content(
    link: &RawEntryLink, resolved: &mut RawEntry, symbols: &SymbolTable,
    path: &mut HashSet<String>, budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize,
) -> Result<(), ParseError> {
    if link.hidden {
        resolved.hidden = true;
    }
    for m in &link.modifiers {
        resolved.modifiers.push(m.clone());
    }

    let mut inline_entries: Vec<RawEntry> = Vec::new();
    let mut inline_groups: Vec<RawGroup> = Vec::new();
    resolve_link_children(link, symbols, path, budget, diags, depth,
        &mut inline_entries, &mut inline_groups)?;
    drop_inline_duplicate_ids(&link.target_id, &resolved.entries, &mut inline_entries,
        &resolved.groups, &mut inline_groups, diags);
    resolved.entries.extend(inline_entries);
    resolved.groups.extend(inline_groups);

    resolved.constraints.extend(link.constraints.iter().cloned());

    for c in &link.costs {
        match resolved.costs.iter_mut().find(|t| t.type_id == c.type_id) {
            Some(existing) => existing.value = c.value,
            None => resolved.costs.push(c.clone()),
        }
    }

    for cl in &link.category_links {
        // A repeated category target is meaningless and would inflate any
        // category-scoped count if kept as a second entry — so the DUPLICATE
        // is what gets dropped, never its `constraints`: those are merged onto
        // the category link that survives, so a link's own per-category
        // min/max is never silently discarded just because the category
        // itself was already named (map_entry concatenates a categoryLink's
        // constraints onto the entry, keyed off the surviving link).
        match resolved.category_links.iter_mut().find(|e| e.target_id == cl.target_id) {
            Some(existing) => {
                // map_entry concatenates EVERY categoryLink's constraints onto the
                // entry unconditionally (ir/map.rs), so merging two constraints
                // that share an id here would put both on the entry — mirror
                // drop_inline_duplicate_ids and drop the repeat, diagnosed. Inert
                // on real data today (verified: zero 11e link categoryLinks carry
                // constraints at all), but it is the one place this branch would
                // otherwise ADD a duplicate-id path.
                let mut seen: HashSet<String> =
                    existing.constraints.iter().map(|c| c.id.clone()).collect();
                for c in &cl.constraints {
                    if seen.insert(c.id.clone()) {
                        existing.constraints.push(c.clone());
                    } else {
                        diags.push(Diagnostic {
                            code: "entryLink.categoryLink_constraint_duplicate_id".to_string(),
                            message: format!(
                                "entryLink's categoryLink to {} declares constraint {}, which this placement's categoryLink already has (dropped)",
                                cl.target_id, c.id),
                        });
                    }
                }
            }
            None => resolved.category_links.push(cl.clone()),
        }
    }

    resolved.profiles.extend(link.profiles.iter().cloned());
    resolve_info_links(&link.info_links, symbols, diags, &mut resolved.profiles);
    Ok(())
}

/// Resolve the `selectionEntries` / `selectionEntryGroups` / `entryLinks` an
/// entryLink declares, into the caller's sinks. `depth` is the depth of the clone
/// they attach to, so direct children resolve one deeper and nested links resolve
/// at the clone's own depth — identical to how resolve_entry treats its own
/// children. All other state (`symbols`, `path`, `budget`, `diags`) is the shared
/// one, so no second budget exists. The path-set is shared too; the ONE difference
/// from ordinary resolution is that a nested entryLink already on the path is
/// diagnosed and dropped rather than raised as a cycle (see the comment below).
#[allow(clippy::too_many_arguments)]
fn resolve_link_children(
    link: &RawEntryLink, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize,
    children: &mut Vec<RawEntry>, groups: &mut Vec<RawGroup>,
) -> Result<(), ParseError> {
    for child in &link.entries {
        children.push(resolve_entry(child, symbols, path, budget, diags, depth + 1)?);
    }
    for g in &link.groups {
        groups.push(resolve_group(g, symbols, path, budget, diags, depth + 1)?);
    }
    for nested in &link.entry_links {
        // A link's OWN nested entryLink pointing at something already on the
        // resolution path is NOT a cycle: the inline content lives on the LINK,
        // not on the target, so resolving that target a second time terminates.
        // Real data has this shape — `Chaos - Chaos Knights Library` (both
        // editions) has two entryLinks to the "Warlord" entry 3bee-8c85-68f7-e54b,
        // each carrying a nested entryLink to that SAME entry. Treating it as a
        // cycle aborts the whole catalogue file and the faction disappears.
        //
        // Resolving it is wrong too: it would inline a copy of Warlord as a child
        // of Warlord, i.e. a node whose child repeats its own id, and duplicate
        // ids have broken the downstream evaluator before. So: diagnose + drop.
        //
        // This relaxation is deliberately narrow — it covers ONLY the links a link
        // declares inline. An ordinary link (one reached through a target's own
        // subtree, via resolve_entry/resolve_group) keeps the strict guard in
        // resolve_link and a genuine cycle there stays a typed ReferenceCycle.
        if path.contains(&nested.target_id) {
            diags.push(Diagnostic {
                code: "entryLink.inline_self_reference".to_string(),
                message: format!(
                    "entryLink to {} declares a nested entryLink to {}, which is already being resolved on this path (dropped)",
                    link.target_id, nested.target_id),
            });
            continue;
        }
        resolve_link(nested, symbols, path, budget, diags, depth, children, groups)?;
    }
    Ok(())
}

/// Drop an inline entry/group whose id the placement already carries — either
/// from the target's own children or from a sibling nested link (both are
/// already present in `existing_*`/earlier in `inline_*` by the time this runs,
/// since `resolve_link_children` folds a nested entryLink's resolved output into
/// the same `inline_entries`/`inline_groups` sink before this is called). On real
/// data this fires 56 times across 26 factions in both editions — e.g. Chaos -
/// Thousand Sons' shared `Autopistol` (`71c8-…`) already carries an entryLink to
/// the `Weapon Modifications` group (`f9da-…`); two separate placement links to
/// Autopistol each also declare a nested entryLink to that SAME group, so without
/// this drop the clone gets `f9da-…` twice, byte-identical. All 56 observed cases
/// are byte-identical duplicates, so nothing is lost by keeping only the first —
/// a genuine duplicate-id sibling would otherwise reach the IR, and downstream
/// consumers that key by id (`UnitConfig.tsx`'s `key={g.id}`, `builder.ts`'s
/// last-wins `Map` vs `engine-eval`'s first-wins `Map`) disagree about which
/// clone is meant. The diagnostic still fires so a real-data repack surfaces the
/// shape.
fn drop_inline_duplicate_ids(
    target_id: &str,
    existing_entries: &[RawEntry], inline_entries: &mut Vec<RawEntry>,
    existing_groups: &[RawGroup], inline_groups: &mut Vec<RawGroup>,
    diags: &mut Vec<Diagnostic>,
) {
    // `flatten_group_members` (ir/map.rs) hoists a group's members — recursively
    // through its own sub-groups — into the OWNING ENTRY's IR children. So an id
    // that reaches this placement only via a group's member tree is exactly as
    // "already on this placement" as a top-level entry id, even though it never
    // appears in `existing_entries`/`inline_entries` themselves. Seed the entries
    // `seen` set with every id in that reachable member tree — BOTH from
    // `existing_groups` (already on the target before this link) AND from
    // `inline_groups` (this SAME link's own additions, already fully resolved by
    // the time this runs) — or an inline entry repeating one survives the check
    // below and reaches `children` a second time.
    //
    // Real case (`Imperium - Space Marines.json`): the placement link to "Twin
    // lightning claws" declares two of its OWN nested entryLinks — one straight to
    // entry `4485-…` ("Archeotech Armament upgrade"), the other to group `8cf2-…`
    // ("Weapon Upgrades"), which itself nests down to group `eb04-…` ("Codex
    // Crusade Relic Upgrades") whose member is that SAME `4485-…`. Neither
    // `existing_entries` nor `existing_groups` has it — "Twin lightning claws" (the
    // link's target) carries no groups of its own at all — so only cross-checking
    // against `inline_groups` catches it. This is the one real-data 11e regression
    // this fix closes (measured against a `main` baseline over both editions); it
    // is a collision between a link's own two nested declarations, not a
    // pre-existing-target-group collision.
    //
    // Symmetric case deliberately NOT closed here: two DIFFERENT (non-colliding by
    // their own ids) groups — existing/existing, existing/inline or inline/inline —
    // whose MEMBER trees collide with each other without either colliding with a
    // top-level entry id. An id-collision on a group's own id can just drop the
    // whole group, like any other duplicate; a collision buried inside two
    // otherwise-legitimate groups' members cannot be resolved by dropping either
    // group whole without also discarding its other, non-colliding members and
    // corrupting its own choose-N accounting (member count, default) — that needs
    // per-member surgery this function does not attempt. No real 10e/11e catalogue
    // exercises this narrower shape (verified over both editions against the same
    // `main` baseline); if one ever does, this is the place to extend the check.
    let mut seen: HashSet<String> = existing_entries.iter().map(|e| e.id.clone()).collect();
    for g in existing_groups.iter().chain(inline_groups.iter()) {
        collect_group_member_ids(g, &mut seen);
    }
    inline_entries.retain(|e| {
        if seen.insert(e.id.clone()) {
            true
        } else {
            diags.push(Diagnostic {
                code: "entryLink.inline_duplicate_id".to_string(),
                message: format!(
                    "entryLink to {} declares inline content with id {}, which this placement already has (dropped)",
                    target_id, e.id),
            });
            false
        }
    });
    let mut seen: HashSet<String> = existing_groups.iter().map(|g| g.id.clone()).collect();
    inline_groups.retain(|g| {
        if seen.insert(g.id.clone()) {
            true
        } else {
            diags.push(Diagnostic {
                code: "entryLink.inline_duplicate_id".to_string(),
                message: format!(
                    "entryLink to {} declares inline content with id {}, which this placement already has (dropped)",
                    target_id, g.id),
            });
            false
        }
    });
}

/// Collect a group's member entry ids, recursively through its sub-groups —
/// the same walk `flatten_group_members` (ir/map.rs) does when it hoists group
/// members into the owning entry's IR children.
fn collect_group_member_ids(g: &RawGroup, out: &mut HashSet<String>) {
    for e in &g.entries {
        out.insert(e.id.clone());
    }
    for sub in &g.groups {
        collect_group_member_ids(sub, out);
    }
}

/// Inline each `type="profile"` infoLink's target profile into `profiles`.
/// Non-`profile` link types are skipped (rule text is global; infoGroup unmodeled);
/// hidden links are skipped; an unresolvable target is diagnosed and dropped.
fn resolve_info_links(
    info_links: &[RawInfoLink], symbols: &SymbolTable,
    diags: &mut Vec<Diagnostic>, profiles: &mut Vec<RawProfile>,
) {
    for link in info_links {
        if link.link_type != "profile" || link.hidden {
            continue;
        }
        match symbols.profile(&link.target_id) {
            Some(p) => profiles.push(p.clone()),
            None => diags.push(Diagnostic {
                code: "infolink.unresolved".to_string(),
                message: format!("infoLink target {} not found (dropped)", link.target_id),
            }),
        }
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
        resolve_link(link, symbols, path, budget, diags, depth, &mut children, &mut groups)?;
    }
    resolve_info_links(&entry.info_links, symbols, diags, &mut out.profiles);
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    out.info_links = Vec::new();
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
        resolve_link(link, symbols, path, budget, diags, depth, &mut children, &mut groups)?;
    }
    // Group-level type="profile" infoLinks are not inlined: RawGroup.profiles is not
    // mapped to IR (map_group emits no profiles), so inlining here would silently
    // drop. Real 10e catalogues put profile infoLinks only on selectionEntry (0 on
    // groups), so this is a documented no-op, not a gap.
    // A group's `defaultSelectionEntryId` may name one of its `<entryLink>`s by the
    // LINK's own id, but link members are inlined under their TARGET id (that is
    // what map_group emits as memberEntryIds and what lands in children). Remap the
    // default from link id to target id so it matches a real member; a direct
    // (non-link) member default already equals the member's entry id (no-op). Done
    // here while entry_links are still available (cleared just below).
    if !out.default_selection_entry_id.is_empty() {
        if let Some(link) = group
            .entry_links
            .iter()
            .find(|l| l.id == out.default_selection_entry_id)
        {
            out.default_selection_entry_id = link.target_id.clone();
        }
    }
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    out.info_links = Vec::new();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw::{RawCategoryLink, RawConstraint, RawCost};

    fn link(target: &str) -> RawEntryLink {
        RawEntryLink { target_id: target.to_string(), link_type: String::new(), ..Default::default() }
    }
    fn entry(id: &str, links: Vec<RawEntryLink>) -> RawEntry {
        RawEntry { id: id.to_string(), entry_type: "upgrade".into(), entry_links: links, ..Default::default() }
    }
    fn group_link(target: &str) -> RawEntryLink {
        RawEntryLink { target_id: target.to_string(), link_type: "selectionEntryGroup".to_string(), ..Default::default() }
    }

    #[test]
    fn group_targeted_link_inlines_a_group() {
        // A shared group g0 with one member; an entry links it as a group.
        let mut g0 = RawGroup { id: "g0".into(), name: "Opt".into(), ..Default::default() };
        g0.entries.push(entry("m0", vec![]));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_groups: vec![g0],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let owner = resolved.entries.iter().find(|e| e.id == "owner").unwrap();
        assert_eq!(owner.groups.len(), 1, "group inlined into .groups, not children");
        assert_eq!(owner.groups[0].id, "g0");
        assert!(owner.groups[0].entries.iter().any(|m| m.id == "m0"));
        assert!(owner.entries.is_empty(), "group did not leak into children");
    }

    #[test]
    fn group_targeted_link_missing_is_diagnosed() {
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g.absent")], ..Default::default()
        };
        let cat = RawCatalogue { id: "c".into(), entries: vec![owner], ..Default::default() };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        assert!(resolved.entries[0].groups.is_empty());
        assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("g.absent")));
    }

    #[test]
    fn group_targeted_link_into_cycle_is_typed_error() {
        // Group g0 contains an entry that links back to g0 as a group → cycle.
        let mut g0 = RawGroup { id: "g0".into(), ..Default::default() };
        g0.entries.push(RawEntry {
            id: "inner".into(), entry_type: "upgrade".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0], ..Default::default()
        };
        assert!(matches!(resolve(cat), Err(ParseError::ReferenceCycle(_))));
    }

    #[test]
    fn group_typed_link_does_not_fall_back_to_entry_index() {
        // An id present ONLY in the entry index; a selectionEntryGroup-typed link
        // to it must diagnose+drop, never cross-resolve against the entry index.
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("x")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_entries: vec![entry("x", vec![])],
            ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        let owner = resolved.entries.iter().find(|e| e.id == "owner").unwrap();
        assert!(owner.groups.is_empty() && owner.entries.is_empty(), "no cross-fallback into entries");
        assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("x")));
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
    fn group_default_link_id_is_remapped_to_target_id() {
        // A group whose defaultSelectionEntryId names an <entryLink> by the LINK id;
        // the link targets member "m.real". After resolve, the group's default must
        // point at the target id (the id the member is inlined under), not the link id.
        let member = entry("m.real", vec![]);
        let mut g0 = RawGroup {
            id: "g0".into(),
            name: "Weapon".into(),
            default_selection_entry_id: "lnk1".into(),
            ..Default::default()
        };
        g0.entry_links.push(RawEntryLink {
            id: "lnk1".into(),
            target_id: "m.real".into(),
            ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(),
            entry_type: "unit".into(),
            entry_links: vec![group_link("g0")],
            ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_groups: vec![g0],
            shared_entries: vec![member],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let owner = resolved.entries.iter().find(|e| e.id == "owner").unwrap();
        let g = &owner.groups[0];
        assert_eq!(g.default_selection_entry_id, "m.real", "link-id default remapped to target id");
        assert!(g.entries.iter().any(|m| m.id == "m.real"), "member inlined under target id");
    }

    #[test]
    fn group_default_link_remaps_even_when_target_is_a_dangler() {
        // Default names a link whose target is absent (another file). The link is
        // dropped (diag), but the default is still remapped to the target id — the
        // roster guard tolerates the now-absent member. Locks the remap contract.
        let mut g0 = RawGroup {
            id: "g0".into(),
            name: "Weapon".into(),
            default_selection_entry_id: "lnk1".into(),
            ..Default::default()
        };
        g0.entry_links.push(RawEntryLink {
            id: "lnk1".into(),
            target_id: "absent.target".into(),
            ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(),
            entry_type: "unit".into(),
            entry_links: vec![group_link("g0")],
            ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_groups: vec![g0],
            ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        let g = &resolved.entries.iter().find(|e| e.id == "owner").unwrap().groups[0];
        assert_eq!(g.default_selection_entry_id, "absent.target", "remap applies even for a dangling target");
        assert!(g.entries.is_empty(), "dangling member is not inlined");
        assert!(diags.iter().any(|d| d.code == "entryLink.unresolved"));
    }

    #[test]
    fn group_default_direct_member_id_is_unchanged() {
        // defaultSelectionEntryId names a DIRECT entry member by its own id → no remap.
        let mut g0 = RawGroup {
            id: "g0".into(),
            name: "Weapon".into(),
            default_selection_entry_id: "m0".into(),
            ..Default::default()
        };
        g0.entries.push(entry("m0", vec![]));
        let owner = RawEntry {
            id: "owner".into(),
            entry_type: "unit".into(),
            entry_links: vec![group_link("g0")],
            ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_groups: vec![g0],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let g = &resolved.entries.iter().find(|e| e.id == "owner").unwrap().groups[0];
        assert_eq!(g.default_selection_entry_id, "m0", "direct member default is a no-op");
    }

    // --- an entryLink's own content applies to its placement (Task E2) ---

    fn constraint(id: &str, value: f64) -> RawConstraint {
        RawConstraint { id: id.into(), kind: "max".into(), value, field: "selections".into(),
            scope: "parent".into(), ..Default::default() }
    }
    fn cost(type_id: &str, value: f64) -> RawCost {
        RawCost { type_id: type_id.into(), value }
    }
    fn cat_link(target: &str) -> RawCategoryLink {
        RawCategoryLink { target_id: target.into(), ..Default::default() }
    }

    #[test]
    fn link_inline_entry_and_group_land_on_the_clone() {
        // Shared target `t` has one child of its own; the link adds an inline entry
        // and an inline group. A SECOND link to the same target adds nothing — its
        // clone must show only the target's own child (the leak guard).
        let mut target = entry("t", vec![]);
        target.entries.push(entry("t.own", vec![]));
        let mut rich = link("t");
        rich.entries.push(entry("inline.e", vec![]));
        rich.groups.push(RawGroup { id: "inline.g".into(), ..Default::default() });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let plain = RawEntry {
            id: "plain".into(), entry_type: "unit".into(),
            entry_links: vec![link("t")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner, plain],
            shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries.iter().find(|e| e.id == "owner").unwrap().entries[0];
        let ids: Vec<&str> = clone.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["t.own", "inline.e"], "inline entry appended after the target's own");
        assert_eq!(clone.groups.len(), 1);
        assert_eq!(clone.groups[0].id, "inline.g");

        let plain_clone = &resolved.entries.iter().find(|e| e.id == "plain").unwrap().entries[0];
        let ids: Vec<&str> = plain_clone.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["t.own"], "link content did not leak onto the shared target");
        assert!(plain_clone.groups.is_empty(), "inline group did not leak either");
    }

    #[test]
    fn link_nested_entrylink_resolves() {
        // The link carries an entryLinks child pointing at another shared entry.
        let mut rich = link("t");
        rich.entry_links.push(link("other"));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            shared_entries: vec![entry("t", vec![]), entry("other", vec![])],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        assert!(clone.entries.iter().any(|e| e.id == "other"),
            "the link's nested entryLink resolved onto the clone");
    }

    #[test]
    fn link_constraints_are_added() {
        let mut target = entry("t", vec![]);
        target.constraints.push(constraint("t.max", 2.0));
        let mut rich = link("t");
        rich.constraints.push(constraint("lnk.max", 1.0));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        let ids: Vec<&str> = clone.constraints.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["t.max", "lnk.max"], "the link's constraint is added to the target's");
    }

    #[test]
    fn link_cost_replaces_a_cost_of_the_same_type() {
        // The Aeldari Warlock shape: the link repeats its target's `pts 45`.
        // Appending would charge 90.
        let mut target = entry("t", vec![]);
        target.costs.push(cost("pts", 45.0));
        let mut rich = link("t");
        rich.costs.push(cost("pts", 45.0));
        rich.costs.push(cost("cp", 1.0));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        let pts: Vec<f64> = clone.costs.iter().filter(|c| c.type_id == "pts").map(|c| c.value).collect();
        assert_eq!(pts, vec![45.0], "exactly ONE pts cost, still 45 — not doubled");
        let cp: Vec<f64> = clone.costs.iter().filter(|c| c.type_id == "cp").map(|c| c.value).collect();
        assert_eq!(cp, vec![1.0], "a cost type the target lacks is added");
    }

    #[test]
    fn link_cost_of_the_same_type_overrides_the_targets_value() {
        let mut target = entry("t", vec![]);
        target.costs.push(cost("pts", 45.0));
        let mut rich = link("t");
        rich.costs.push(cost("pts", 60.0));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.costs.len(), 1);
        assert_eq!(clone.costs[0].value, 60.0, "the link's value wins for a type both price");
    }

    #[test]
    fn link_category_is_not_duplicated() {
        let mut target = entry("t", vec![]);
        target.category_links.push(cat_link("c1"));
        let mut rich = link("t");
        rich.category_links.push(cat_link("c1"));
        rich.category_links.push(cat_link("c2"));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        let ids: Vec<&str> = clone.category_links.iter().map(|c| c.target_id.as_str()).collect();
        assert_eq!(ids, vec!["c1", "c2"], "c1 once (not repeated), c2 added");
    }

    #[test]
    fn link_duplicate_category_still_merges_its_constraints() {
        // Finding 3: skipping a duplicate categoryLink must not drop the
        // `constraints` it carries — those are merged onto the surviving link
        // (`map_entry` in ir/map.rs concatenates a categoryLink's constraints
        // onto the entry, keyed off the target category id, so a dropped
        // constraint here is a silently-vanished per-category min/max).
        let mut target = entry("t", vec![]);
        target.category_links.push(RawCategoryLink {
            target_id: "c1".into(), constraints: vec![constraint("t.cat.max", 2.0)], ..Default::default()
        });
        let mut rich = link("t");
        rich.category_links.push(RawCategoryLink {
            target_id: "c1".into(), constraints: vec![constraint("lnk.cat.max", 1.0)], ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.category_links.len(), 1, "still de-duplicated to one categoryLink for c1");
        let ids: Vec<&str> = clone.category_links[0].constraints.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["t.cat.max", "lnk.cat.max"],
            "the duplicate's constraint is merged onto the surviving categoryLink, not dropped");
    }

    #[test]
    fn link_duplicate_category_constraint_sharing_an_id_is_dropped_not_duplicated() {
        // Finding 2 (review minor): the merge above appends a duplicate
        // categoryLink's constraints unconditionally, so if the target's own
        // categoryLink constraint and the link's constraint happen to SHARE an
        // id, map_entry (ir/map.rs) would concatenate both onto the entry as two
        // constraints with the same id. Mirror drop_inline_duplicate_ids: the
        // repeat is dropped, diagnosed, exactly one constraint with that id
        // survives.
        let mut target = entry("t", vec![]);
        target.category_links.push(RawCategoryLink {
            target_id: "c1".into(), constraints: vec![constraint("shared.max", 2.0)], ..Default::default()
        });
        let mut rich = link("t");
        rich.category_links.push(RawCategoryLink {
            target_id: "c1".into(), constraints: vec![constraint("shared.max", 1.0)], ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.category_links.len(), 1);
        let matches: Vec<&RawConstraint> = clone.category_links[0].constraints.iter()
            .filter(|c| c.id == "shared.max").collect();
        assert_eq!(matches.len(), 1, "exactly one constraint with the shared id survives");
        assert_eq!(matches[0].value, 2.0, "the target's own constraint (processed first) wins");
        assert!(diags.iter().any(|d| d.code == "entryLink.categoryLink_constraint_duplicate_id"
            && d.message.contains("shared.max") && d.message.contains("dropped")));
    }

    #[test]
    fn link_profile_and_infolink_reach_the_clone() {
        let target = entry("t", vec![]);
        let mut rich = link("t");
        rich.profiles.push(RawProfile { id: "inline.p".into(), ..Default::default() });
        rich.info_links.push(RawInfoLink {
            target_id: "shared.p".into(), link_type: "profile".into(), hidden: false });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target],
            shared_profiles: vec![RawProfile { id: "shared.p".into(), ..Default::default() }],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let clone = &resolved.entries[0].entries[0];
        let ids: Vec<&str> = clone.profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["inline.p", "shared.p"], "inline profile and infoLink target both land");
    }

    #[test]
    fn group_link_inline_entry_becomes_a_member() {
        // The owner's real shape: Wolf Guard Terminators link the shared group
        // "Legends of Saga and Song Enhancements" (Thirst for Glory) and declare
        // "Fierce Example" on the link itself.
        let mut g0 = RawGroup { id: "g0".into(), name: "Enhancements".into(), ..Default::default() };
        g0.entries.push(entry("thirst", vec![]));
        let mut gl = group_link("g0");
        gl.entries.push(entry("fierce", vec![]));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![gl], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let g = &resolved.entries[0].groups[0];
        let ids: Vec<&str> = g.entries.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["thirst", "fierce"], "the link's inline entry is a member of the placement");
    }

    #[test]
    fn group_link_constraint_is_added() {
        let mut g0 = RawGroup { id: "g0".into(), ..Default::default() };
        g0.constraints.push(constraint("g.max", 2.0));
        let mut gl = group_link("g0");
        gl.constraints.push(constraint("lnk.max", 1.0));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![gl], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let ids: Vec<&str> = resolved.entries[0].groups[0]
            .constraints.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["g.max", "lnk.max"]);
    }

    #[test]
    fn group_link_nested_link_and_group_resolve() {
        let g0 = RawGroup { id: "g0".into(), ..Default::default() };
        let mut gl = group_link("g0");
        gl.entry_links.push(link("member"));
        gl.groups.push(RawGroup { id: "sub".into(), ..Default::default() });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![gl], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0],
            shared_entries: vec![entry("member", vec![])], ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let g = &resolved.entries[0].groups[0];
        assert!(g.entries.iter().any(|e| e.id == "member"), "nested link resolved into the group");
        assert!(g.groups.iter().any(|s| s.id == "sub"), "inline subgroup landed on the group");
    }

    #[test]
    fn group_link_cost_or_category_is_diagnosed() {
        // A RawGroup has no costs/categoryLinks — diagnose, never mis-file.
        let g0 = RawGroup { id: "g0".into(), ..Default::default() };
        let mut gl = group_link("g0");
        gl.costs.push(cost("pts", 5.0));
        gl.category_links.push(cat_link("c1"));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![gl], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        let d = diags.iter().find(|d| d.code == "entryLink.group_content_unsupported")
            .expect("group content diagnosed");
        assert!(d.message.contains("g0"));
        assert!(d.message.contains("costs/categoryLinks"), "names what is present: {}", d.message);
        assert!(!d.message.contains("profiles") && !d.message.contains("infoLinks"),
            "does not name absent collections: {}", d.message);
        let g = &resolved.entries[0].groups[0];
        assert!(g.entries.is_empty() && g.groups.is_empty(), "nothing silently mis-filed");
    }

    #[test]
    fn link_inline_content_shares_the_cycle_guard() {
        // The link's inline entry links back to the link's own target → cycle.
        let mut rich = link("t");
        rich.entries.push(entry("inline", vec![link("t")]));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            shared_entries: vec![entry("t", vec![])], ..Default::default()
        };
        assert!(matches!(resolve(cat), Err(ParseError::ReferenceCycle(_))));
    }

    #[test]
    fn link_nested_link_to_its_own_target_is_dropped_not_fatal() {
        // The real Chaos Knights shape: an entryLink to the "Warlord" entry that
        // itself carries a nested entryLink to that SAME entry. Under a naive cycle
        // guard the whole catalogue file aborts and the faction disappears.
        // Required: resolve fine, drop the nested link with a diagnostic, and do
        // NOT produce a Warlord whose child is another Warlord (duplicate ids).
        let mut rich = link("warlord");
        rich.entry_links.push(link("warlord"));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            shared_entries: vec![entry("warlord", vec![])], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags)
            .expect("a link's self-referential inline link must not abort the file");
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.id, "warlord");
        assert!(clone.entries.iter().all(|e| e.id != "warlord"),
            "the clone did not gain a child carrying its own id");
        assert!(diags.iter().any(|d| d.code == "entryLink.inline_self_reference"
            && d.message.contains("warlord")));
    }

    #[test]
    fn link_nested_link_to_an_ancestor_is_dropped_not_fatal() {
        // Same relaxation one level up: the nested link points at an ANCESTOR
        // (the outer target `a`), still on the path. Dropped, same diagnostic.
        let mut rich = link("b");
        rich.entry_links.push(link("a"));
        let a = entry("a", vec![rich]);
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![link("a")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            shared_entries: vec![a, entry("b", vec![])], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).expect("not fatal");
        let a_clone = &resolved.entries[0].entries[0];
        let b_clone = &a_clone.entries[0];
        assert_eq!(b_clone.id, "b");
        assert!(b_clone.entries.is_empty(), "the ancestor was not re-inlined");
        assert!(diags.iter().any(|d| d.code == "entryLink.inline_self_reference"));
    }

    #[test]
    fn link_inline_duplicate_id_is_dropped_not_kept() {
        // Finding 1 (real-data regression, 56x across 26 factions/both editions):
        // the link declares an inline entry AND an inline group whose ids the
        // target already carries — the Chaos - Thousand Sons "Autopistol" shape,
        // where a placement link's nested entryLink re-declares a group the
        // target's own entryLink already contributed. The duplicate must be
        // DROPPED, yielding exactly ONE child/group with that id, not kept as a
        // genuine duplicate-id sibling.
        let mut target = entry("t", vec![]);
        target.entries.push(entry("dup", vec![]));
        target.groups.push(RawGroup { id: "gdup".into(), ..Default::default() });
        let mut rich = link("t");
        rich.entries.push(entry("dup", vec![]));
        rich.groups.push(RawGroup { id: "gdup".into(), ..Default::default() });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        let hits: Vec<&Diagnostic> = diags.iter()
            .filter(|d| d.code == "entryLink.inline_duplicate_id").collect();
        assert_eq!(hits.len(), 2, "one for the duplicate entry id, one for the duplicate group id");
        assert!(hits.iter().any(|d| d.message.contains("dup") && d.message.contains("dropped")));
        assert!(hits.iter().any(|d| d.message.contains("gdup") && d.message.contains("dropped")));
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.entries.iter().filter(|e| e.id == "dup").count(), 1,
            "exactly one child carries the duplicate id, the inline copy was dropped");
        assert_eq!(clone.groups.iter().filter(|g| g.id == "gdup").count(), 1,
            "exactly one group carries the duplicate id, the inline copy was dropped");
    }

    #[test]
    fn link_inline_duplicate_id_within_the_links_own_content_is_also_dropped() {
        // Neither duplicate comes from the target this time — both "gdup" groups
        // are declared by the SAME link (the sibling-nested-link shape from real
        // data: two separate entryLinks under one link each resolving to a group
        // with the same id). The second occurrence must still be dropped.
        let target = entry("t", vec![]);
        let mut rich = link("t");
        rich.groups.push(RawGroup { id: "gdup".into(), ..Default::default() });
        rich.groups.push(RawGroup { id: "gdup".into(), ..Default::default() });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        assert!(diags.iter().any(|d| d.code == "entryLink.inline_duplicate_id"
            && d.message.contains("gdup") && d.message.contains("dropped")));
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.groups.iter().filter(|g| g.id == "gdup").count(), 1,
            "the second inline group with the same id was dropped");
    }

    #[test]
    fn link_inline_duplicate_id_via_existing_group_member_is_dropped() {
        // Finding 1 (residual, real-data): a duplicate id can reach the clone via
        // a GROUP's member, not only a top-level child — `flatten_group_members`
        // (ir/map.rs) hoists a group's members into IrEntry.children too, so an id
        // buried in an EXISTING group's members is just as "already here" as a
        // top-level one. The target already carries group "g0" whose member is
        // "dup"; the link also declares an inline entry with that SAME id
        // directly. Exactly one "dup" must reach the entry.
        let mut target = entry("t", vec![]);
        let mut g0 = RawGroup { id: "g0".into(), ..Default::default() };
        g0.entries.push(entry("dup", vec![]));
        target.groups.push(g0);
        let mut rich = link("t");
        rich.entries.push(entry("dup", vec![]));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_entries: vec![target], ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        assert!(diags.iter().any(|d| d.code == "entryLink.inline_duplicate_id"
            && d.message.contains("dup") && d.message.contains("dropped")));
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.entries.iter().filter(|e| e.id == "dup").count(), 0,
            "the inline entry duplicating an existing group's member was dropped, not kept as a top-level duplicate");
        assert_eq!(clone.groups[0].entries.iter().filter(|e| e.id == "dup").count(), 1,
            "the group's own member is untouched — \"dup\" still reaches the entry exactly once");
    }

    #[test]
    fn link_inline_duplicate_id_via_a_sibling_nested_links_group_member_is_dropped() {
        // The actual real-data 11e shape (`Imperium - Space Marines.json`'s "Twin
        // lightning claws"): the collision is between the link's OWN two nested
        // declarations, not a pre-existing target group — the target carries no
        // groups at all. One nested entryLink resolves straight to entry "dup"; a
        // SIBLING nested entryLink resolves to a group whose member is that SAME
        // "dup". Exactly one "dup" must reach the entry.
        let target = entry("t", vec![]);
        let mut g0 = RawGroup { id: "g0".into(), ..Default::default() };
        g0.entries.push(entry("dup", vec![]));
        let mut rich = link("t");
        rich.entry_links.push(link("dup"));
        rich.entry_links.push(group_link("g0"));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            // "dup" is registered ONLY as g0's member — the symbol table indexes
            // group members too, so `link("dup")` resolves against that same
            // registered copy without a second, colliding top-level declaration.
            shared_entries: vec![target],
            shared_groups: vec![g0],
            ..Default::default()
        };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        assert!(diags.iter().any(|d| d.code == "entryLink.inline_duplicate_id"
            && d.message.contains("dup") && d.message.contains("dropped")));
        let clone = &resolved.entries[0].entries[0];
        assert_eq!(clone.entries.iter().filter(|e| e.id == "dup").count(), 0,
            "the direct inline entry was dropped, not kept as a top-level duplicate");
        assert_eq!(clone.groups[0].entries.iter().filter(|e| e.id == "dup").count(), 1,
            "\"dup\" still reaches the entry exactly once, via the inline group's member");
    }

    #[test]
    fn link_inline_content_shares_the_node_budget() {
        // Inline content resolves through the SAME budget: a link whose inline
        // entries fan out past a small cap is a typed error, not a second budget.
        let mut rich = link("t");
        for i in 0..50 {
            rich.entries.push(entry(&format!("i{i}"), vec![]));
        }
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![rich], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner],
            shared_entries: vec![entry("t", vec![])], ..Default::default()
        };
        assert!(matches!(
            resolve_with_caps(cat, 5, 10_000, &mut Vec::new()),
            Err(ParseError::ResolvedTooLarge(_))
        ));
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
