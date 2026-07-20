# entryLink inline content (Sub-project E) — Design

**Date:** 2026-07-20
**Status:** Approved (backend mechanics decided autonomously per project workflow; the
owner's report is the acceptance test).
**Scope:** `engine-parser` only (`raw/model.rs`, `raw/parse.rs`, `raw/parse_json.rs`,
`resolve/links.rs`). No IR schema change, no TS change.

## The report

11e Space Wolves, detachment *Legends of Saga and Song*: Wolf Guard Terminators offer
exactly one enhancement (*Thirst for Glory*). Upstream also gives them *Fierce Example*.

## Findings — the parser drops everything an entryLink declares except modifiers

In BattleScribe an `<entryLink>` is not a bare pointer. It is a *placement*: it names a
shared target and may carry its own children, which apply to that placement only.
`Imperium - Space Wolves.json` says exactly that:

```
sharedSelectionEntries[Wolf Guard Terminators]
  entryLink type=selectionEntryGroup targetId=946d-…  name="Legends of Saga and Song Enhancements"
    selectionEntries: [ Fierce Example ]        <-- local addition
```

The shared group (defined in `Imperium - Space Marines.json`) contains only *Thirst for
Glory*. *Fierce Example* exists nowhere else. So the enhancement is not missing from the
data — it is discarded on the way in.

`RawEntryLink` carries only `id`, `target_id`, `link_type`, `hidden`, `modifiers`. Both
readers behave accordingly: `read_entrylinks_into` reads `<modifiers>` and calls
`skip_element` on every other child; `JsonEntryLink` deserializes the same five fields and
`serde` drops the rest. `resolve_link` therefore has nothing to apply beyond modifiers.

**This is not a Space Wolves quirk.** Counted over every catalogue in both upstream repos:

| child of an entryLink | 10e | 11e |
|---|---|---|
| `constraints` | 3453 | 3467 |
| `entryLinks` | 3369 | 3369 |
| `categoryLinks` | 268 | 268 |
| `selectionEntryGroups` | 255 | 257 |
| `infoLinks` | 118 | 121 |
| `costs` | 5 | 24 |
| `profiles` | 3 | 3 |
| `selectionEntries` | 2 | 7 |
| `modifiers` (already handled) | 732 | 727 |

Roughly 7 500 declarations per edition are read and thrown away. The visible symptoms are
not limited to enhancements: the ~3 400 dropped constraints are overwhelmingly the
`min 1 / max 1` pairs that pin a wargear option to one per model, so weapon loadouts lose
their limits; the ~3 400 dropped nested `entryLinks` are the extra options a pack leader
gets over the squad's basic model.

## Design

Give `RawEntryLink` the child collections a real entryLink can carry, read them in both
front-ends, and merge them onto the resolved clone in `resolve_link`. The clone is already
unique per placement, so nothing leaks back to the shared target.

The merge rule is per collection, chosen from what the data actually contains:

- **`selectionEntries`, `selectionEntryGroups`, `entryLinks` — append, dropping an id the
  placement already carries.** They resolve through the existing `resolve_entry` /
  `resolve_group` / `resolve_link` recursion, into the same `children`/`groups` sinks,
  after the target's own. Nested links reuse the existing cycle path-set, node budget and
  depth cap unchanged. An inline entry/group whose id the clone already has — from the
  target's own content, from a sibling nested link's content, OR from any group's member
  tree (existing or itself just inlined; `flatten_group_members` hoists group members into
  the owning entry's IR children too) — is diagnosed (`entryLink.inline_duplicate_id`) and
  DROPPED, keeping the first occurrence only. Real data: 56 observed cases across both
  editions, overwhelmingly byte-identical duplicates of content already reachable another
  way — one residual case only closes once the check also walks group member trees, not
  just top-level ids.
- **`constraints` — append.** Verified across all of 11e: 6 244 link constraints, **zero**
  share an id with a constraint on their target, so a link constraint is always an
  addition and never an override. Appending cannot double a limit.
- **`costs` — merge by cost-type id, link wins.** Appending is wrong here: the Aeldari
  *Warlock* link declares `pts 45` and its target declares `pts 45`, so appending would
  charge 90. Most link costs name a type the target lacks, where merge and append agree.
- **`categoryLinks` — append, de-duplicated by target category id; the duplicate's
  `constraints` are merged onto the surviving link, also de-duplicated by constraint id.**
  The *Warlock* link repeats four of its target's categories; a repeated category is
  meaningless, and duplicates would inflate any category-scoped count. But `map_entry`
  concatenates every categoryLink's constraints onto the entry regardless, so simply
  dropping the duplicate categoryLink would silently discard a per-category min/max it
  carries — its constraints are merged onto the one that survives instead. If that merge
  would itself put two constraints with the same id on the entry, the repeat is diagnosed
  (`entryLink.categoryLink_constraint_duplicate_id`) and dropped, mirroring the
  duplicate-id handling above. Inert on real data today (zero 11e link categoryLinks carry
  constraints at all) but the one place this change could otherwise add a duplicate-id
  path.
- **`infoLinks`, `profiles` — append**, through the same `resolve_info_links` path an
  entry uses, so a link-declared profile reaches the datasheet like any other.
- **`modifiers` — unchanged.** Already appended; `hidden` handling stays as it is.

An entryLink whose target is a `selectionEntryGroup` gets the same treatment against the
cloned group. A group cannot hold `costs` or `categoryLinks`; those on such a link are
diagnosed and dropped rather than silently mis-filed.

`modifierGroups` (181 on 10e links) stay out: they are not modeled anywhere in the parser
today, so link-level support would be the wrong place to start.

## Scope / non-goals

**In:** the eight collections above, in both the XML and the JSON front-end, with the
merge rules stated.
**Out:** `modifierGroups`; `associations` (already diagnosed and dropped elsewhere);
any IR schema change; any change to how ids are made unique.

## Testing

- **Parser unit:** a fixture where a link carries one of each collection — assert the
  clone gains the inline entry, group, nested-link child, constraint, profile and category,
  and that a link cost on a type the target already prices REPLACES rather than adds.
- **XML/JSON parity:** the same fixture in both syntaxes yields identical IR.
- **Golden:** `mini40k` declares no inline link content, so its golden must stay
  byte-identical — that is the regression guard for the change being additive.
- **Real data:** repack both editions; 11e Space Wolves Wolf Guard Terminators must list
  *Fierce Example* alongside *Thirst for Glory* under *Legends of Saga and Song*; the
  packed-entry and diagnostic counts must move in the direction the table above predicts,
  with no new unresolved-link diagnostics.
- **Browser:** the owner's exact path — Space Wolves 11e, *Legends of Saga and Song*, add
  Wolf Guard Terminators, both enhancements offered, and the group's `max 1` still holds.

## Risks

- **Points inflation** is the one direction that silently corrupts a legal-looking roster.
  The cost merge rule exists solely for it, and the real-data check compares a known
  unit's points before and after.
- **Node-budget growth.** Inline content adds resolved nodes; the caps are shared and
  already sized for the full catalogues, but the repack must report zero skips.
- **Over-constraining.** Appending link constraints tightens legality. The zero-id-clash
  count is the evidence that this is addition, not duplication; the repack's legality
  spot-check on a known-legal roster is the confirmation.
