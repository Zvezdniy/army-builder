# entryLink inline content (Sub-project E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An `<entryLink>`'s own children — the content it declares for that placement only —
survive parsing and land on the resolved clone, instead of being skipped.

**Architecture:** See the spec `docs/superpowers/specs/2026-07-20-entrylink-inline-content-design.md`
— implementers READ IT FIRST. Widen `RawEntryLink` to carry the child collections, read them in
both the XML and the JSON front-end, then merge them onto the clone in `resolve_link` using the
per-collection rules the spec fixes (append for structure and constraints; merge-by-type for
costs; append-deduped for categories).

**Tech Stack:** Rust (cargo), `quick-xml`, `serde_json`.

## Global Constraints

- The `mini40k` 10e golden MUST stay **byte-identical** — it declares no inline link content,
  so any diff means the change stopped being additive.
- XML and JSON front-ends stay at parity: the same catalogue in either syntax yields the same IR.
- No IR schema change (`packages/domain` untouched), no TypeScript change.
- The existing cycle path-set, node budget and depth cap govern inline content too — do not add
  a second budget, do not bypass the shared one.
- A merge rule that could double a value (costs, categories) must be verified by a test that
  fails under naive appending.
- `modifierGroups` on links stay unsupported — out of scope, do not add them.
- No GW data in git (`apps/web/public` is gitignored). Do NOT run `git stash` or `git add -A`.
- Do NOT run `scripts/update-catalogues.mjs` (clones repos + builds Rust, ~20 min); the
  controller handles repacking.

---

### Task E1: raw layer — read what an entryLink declares

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs` (`RawEntryLink`, line ~55)
- Modify: `packages/engine-parser/src/raw/parse.rs` (`read_entrylinks_into`, line ~760)
- Modify: `packages/engine-parser/src/raw/parse_json.rs` (`JsonEntryLink` ~line 119,
  `map_entry_link` ~line 286)
- Tests: the parse tests alongside each front-end, plus the XML/JSON parity fixture

**Interfaces:**

Produces the widened struct that Task E2 consumes:

```rust
#[derive(Debug, Default, Clone)]
pub struct RawEntryLink {
    pub id: String,
    pub target_id: String,
    pub link_type: String,
    pub hidden: bool,
    pub modifiers: Vec<RawModifier>,
    // Content declared ON the link: it applies to THIS placement only, never to the
    // shared target. resolve_link merges it onto the per-placement clone.
    pub entries: Vec<RawEntry>,
    pub groups: Vec<RawGroup>,
    pub entry_links: Vec<RawEntryLink>,
    pub constraints: Vec<RawConstraint>,
    pub category_links: Vec<RawCategoryLink>,
    pub costs: Vec<RawCost>,
    pub profiles: Vec<RawProfile>,
    pub info_links: Vec<RawInfoLink>,
}
```

- [ ] **Step 1 (TDD):** add a failing XML parse test — an `<entryLink>` carrying one
  `<selectionEntries>`, one `<selectionEntryGroups>`, one nested `<entryLinks>`, one
  `<constraints>`, one `<categoryLinks>`, one `<costs>`, one `<profiles>` and one
  `<infoLinks>` child. Assert every collection on the parsed `RawEntryLink` has exactly one
  element with the expected id. Add the mirror test for JSON with the same fixture in JSON
  syntax. Run `cargo test` → FAIL (fields do not exist).

- [ ] **Step 2 (impl, model):** widen `RawEntryLink` exactly as above, with that comment.
  The recursion (`RawEntryLink` → `RawEntry` → `RawEntryLink`) goes through `Vec`, so no
  boxing is needed.

- [ ] **Step 3 (impl, XML):** in `read_entrylinks_into`'s `Event::Start` arm, replace the
  catch-all `Event::Start(other) => skip_element(...)` with dispatch on the child's local
  name, reusing the existing readers — `selectionEntries` → `read_entries_into`,
  `selectionEntryGroups` → `read_groups_into`, `entryLinks` → `read_entrylinks_into`
  (recursive), `constraints` → `read_constraints_into`, `categoryLinks` → `read_catlinks_into`,
  `costs` → `read_costs_into`, `profiles` → `read_profiles_into`, `infoLinks` →
  `read_infolinks_into`, `modifiers` → `read_modifiers_into` (already there). Keep
  `skip_element` as the fallback for anything else (`modifierGroups`, `associations`,
  `comment`). Note that `read_entries_into` / `read_groups_into` / `read_profiles_into` take
  a container-end tag argument — pass the matching one.

- [ ] **Step 4 (impl, JSON):** give `JsonEntryLink` the same eight fields with the existing
  `Json*` element types (`selection_entries: Vec<JsonEntry>`,
  `selection_entry_groups: Vec<JsonGroup>`, `entry_links: Vec<JsonEntryLink>`,
  `constraints: Vec<JsonConstraint>`, `category_links: Vec<JsonCategoryLink>`,
  `costs: Vec<JsonCost>`, `profiles: Vec<JsonProfile>`, `info_links: Vec<JsonInfoLink>`) and
  map them in `map_entry_link` with the existing `map_*` helpers, recursing through
  `map_entry` / `map_group` / `map_entry_link`.

- [ ] **Step 5:** run `cargo test` → PASS. Confirm the `mini40k` golden is byte-identical.

- [ ] **Step 6: commit** — `fix(parser): read the content an entryLink declares`.

---

### Task E2: resolve — merge a link's own content onto its clone

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs` (`resolve_link` ~line 97,
  `apply_link_modifiers` ~line 151)
- Tests: the `mod tests` block in the same file

**Interfaces:**
- Consumes E1's widened `RawEntryLink`. Produces no new public API — `resolve_link`'s
  signature is unchanged.

**Merge rules (from the spec — these exact behaviours are the requirement):**

| collection | rule | why |
|---|---|---|
| `entries`, `groups`, `entry_links` | resolve, then append after the target's own | placement-local additions |
| `constraints` | append | 6 244 link constraints across 11e, zero id-clash with their target |
| `costs` | merge by `type_id`, link value REPLACES | the Aeldari *Warlock* link repeats its target's `pts 45`; appending charges 90 |
| `category_links` | append, skipping a `target_id` the clone already has | the *Warlock* link repeats four of its target's categories |
| `profiles`, `info_links` | append (info_links via `resolve_info_links`) | same path an entry uses |
| `modifiers`, `hidden` | unchanged | already handled |

- [ ] **Step 1 (TDD):** failing tests in `links.rs`'s test module.
  - `link_inline_entry_and_group_land_on_the_clone`: target with one child; link adds one
    inline entry and one inline group → clone has both the target's child and the link's, and
    the shared target in the symbol table is unchanged (resolve it a second time via a second
    link that adds nothing, and assert that clone has only the target's child — this is the
    leak guard).
  - `link_nested_entrylink_resolves`: link carries an `entryLinks` child pointing at another
    shared entry → that entry appears as a child of the clone.
  - `link_constraints_are_added`: clone carries the target's constraint plus the link's.
  - `link_cost_replaces_a_cost_of_the_same_type`: target `pts 45`, link `pts 45` → clone has
    exactly ONE `pts` cost of 45. Also assert a link cost of a type the target lacks is added.
  - `link_category_is_not_duplicated`: target and link both name category `c1`, link also
    names `c2` → clone has `c1` once and `c2` once.
  - `group_link_inline_entry_becomes_a_member`: a `type="selectionEntryGroup"` link carrying
    an inline `selectionEntry` → the resolved group's `entries` contains it (this is the
    owner's *Fierce Example* shape).
  - `group_link_cost_or_category_is_diagnosed`: a group-targeted link carrying `costs` or
    `categoryLinks` → a diagnostic is pushed and nothing is silently mis-filed (a `RawGroup`
    has no such fields).
  Run `cargo test` → FAIL.

- [ ] **Step 2 (impl):** implement the table in `resolve_link`. Resolve the link's own
  `entries`/`groups`/`entry_links` with the same `resolve_entry`/`resolve_group`/`resolve_link`
  calls and the same threaded `symbols, path, budget, diags, depth` — so cycles, the node
  budget and the depth cap cover inline content with no new machinery. Put the entry-target
  merge in `apply_link_modifiers`' place, renaming it to reflect that it now applies the
  link's whole placement contribution (e.g. `apply_link_content`) and updating its doc
  comment; the group-target branch gets the group-appropriate subset inline. Use the
  diagnostic code `entryLink.group_content_unsupported` for the group/cost/category case,
  matching the existing `entryLink.group_hidden_unsupported` wording style.

- [ ] **Step 3:** run `cargo test` → PASS. Confirm the `mini40k` golden is byte-identical.

- [ ] **Step 4: commit** — `fix(parser): apply an entryLink's own content to its placement`.

---

### Task E3: real-data verification (controller, not committed)

- [ ] Repack both editions, then verify: 11e Space Wolves `Wolf Guard Terminators` has BOTH
  *Fierce Example* and *Thirst for Glory* in its `Legends of Saga and Song Enhancements`
  group, with the group's `max 1` intact; a known unit's points total is unchanged from
  before the branch (the cost-merge guard on real data); packed faction count stays 69/69
  with zero skips; no new `entryLink.unresolved` diagnostics. Then walk the owner's exact
  browser path. Record results in the ledger.
