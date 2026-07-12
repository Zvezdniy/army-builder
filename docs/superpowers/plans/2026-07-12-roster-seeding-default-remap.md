# Roster-seeding fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Stop `addUnit`+`evaluate` from crashing (`Unknown entryId`) on real battleline units by (a) remapping a group's default from an entryLink id to the member's target id in the parser, and (b) guarding roster seeding to never inject an unresolvable id.

**Architecture:** Parser (`engine-parser`, Rust) captures `RawEntryLink.id` and remaps `default_selection_entry_id` in `resolve_group`; `map_group` drops the `"none"` sentinel. Roster (`@muster/roster`) `initialChildren` seeds only materialized children.

**Tech Stack:** Rust (quick-xml/serde, clippy -D warnings, byte-identical golden), TypeScript (strict, 100% coverage), Vitest.

## Global Constraints
- Golden fixture byte-identical (mini default is a direct member → remap no-op).
- `#![forbid(unsafe_code)]`, clippy clean. Roster 100% coverage.
- Runtime `IrCatalogue` / evaluate / keystone semantics unchanged.

---

### Task 1: parser — capture link id + remap group default + drop "none"
**Files:** `packages/engine-parser/src/raw/model.rs`, `raw/parse.rs`, `resolve/links.rs`, `ir/map.rs`; tests in `resolve/links.rs` (unit) + `tests/map.rs`.
- [x] `RawEntryLink` gains `id: String`; both entryLink parse sites read `id`.
- [x] `resolve_group`: if `default_selection_entry_id` == a `group.entry_links[].id`, replace with that link's `target_id` (before clearing entry_links). Direct member default = no-op.
- [x] `map_group`: treat `default_selection_entry_id == "none"` (and empty) as absent.
- [x] Tests: link-id default remapped to target; direct default unchanged; `"none"` → absent. Golden unchanged. clippy + cargo test green.

### Task 2: roster — guard seeding to real children
**Files:** `packages/roster/src/builder.ts`, `src/builder.test.ts`.
- [x] `initialChildren` builds a `childById` map; `groupSeed(g, childById)` returns the child entry to seed: declared default if a real child, else first resolvable member of a required group, else none. `seedChild(child)` takes the entry directly.
- [x] Tests: unresolvable default → first member; required group with no resolvable member → nothing; optional unresolvable → nothing; existing default/min tests still green. 100% coverage.

### Task 3: end-to-end verification (controller)
- [x] Re-parse real SM → all 132 roots `addUnit`+`evaluate` without throwing (0 crashes). Web: add Intercessor Squad renders.

## Self-Review
- Spec coverage: remap (T1), none sentinel (T1), roster guard (T2), e2e (T3). Covered.
- Golden byte-identical verified. Roster 100%. No placeholders.
