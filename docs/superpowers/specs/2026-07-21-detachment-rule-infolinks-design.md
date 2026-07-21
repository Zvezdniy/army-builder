# Sub-project D — Resolve `type="rule"` infoLinks into `ruleNames`

**Status:** design, awaiting user review
**Date:** 2026-07-21
**Branch (implementation):** `feat/rule-infolink-resolution`

## Goal

Detachment rule descriptions are missing for many factions in the setup wizard's
detachment step (Adepta Sororitas shows 5 of 8 detachments with no rule text,
Necrons 9 of 12, plus World Eaters, Chaos Daemons, and others). Make the parser
capture a detachment's rule when it is attached by reference so those
descriptions appear.

## Root cause (verified against real BSData)

The Rust parser populates an entry's `rule_names` **only** from a directly-nested
`<rules><rule/></rules>` block (`raw/parse.rs` `read_entry_rule_names_into`;
`raw/parse_json.rs` `rule_names`). BSData attaches a rule to an entry in **two**
shapes, and only the first is read:

| Attachment shape | Example (Sororitas detachment) | Parser today |
|---|---|---|
| Direct `<rules><rule name="X"/></rules>` | Chorus of Condemnation → `Angelic Judgement` | ✅ read |
| `<infoLink type="rule" name="X" targetId="…"/>` | Hallowed Martyrs → `The Blood of Martyrs` | ❌ dropped |

Confirmed from the live catalogues (`raw.githubusercontent.com/BSData/wh40k-11e`
and `…/wh40k-10e`):
- `Hallowed Martyrs` carries `infoLinks: [{type:"rule", name:"The Blood of Martyrs", targetId:"afa4-169c-3aaa-650"}]` and no own `rules`.
- `Army of Faith` → `infoLink type="rule" name:"Sacred Rites"`.
- The rule **text** for both already lands in `IrCatalogue.ruleTexts` (keyed by
  name — "The Blood of Martyrs", "Sacred Rites" are present). Only the
  entry→rule **association** (the `ruleNames` entry) is lost.

The single consumer of `ruleNames` is the detachment panel
(`apps/web/src/components/SetupWizard.tsx:261`), which renders
`ruleTexts[name]`. So restoring the association is sufficient — no text plumbing,
no schema change (`ruleNames` is already in the IR and packed contracts).

## Chosen approach (Approach 1 — generic, user-approved)

Resolve **every** `type="rule"` infoLink on **every** entry into that entry's
`rule_names`, mirroring how `type="profile"` infoLinks are already inlined into
`profiles` (`resolve/links.rs` `resolve_info_links`). The parser stays faithful
to the data and convention-agnostic: it does **not** learn what a "detachment"
is — that knowledge stays entirely in the consumer (`@muster/roster` /
SetupWizard), which already reads `ruleNames` only off detachment options.

**Why the link's `name`, not targetId resolution (unlike profiles).** A profile
infoLink must resolve its target by id because the link carries no profile
*content*. A rule infoLink is different: the rule *text* is already collected
globally into `ruleTexts` **keyed by name**, and the link carries that same
`name` attribute. So for rules the link's `name` *is* the association key into
the global text map — no id→rule symbol table is needed. Verified: every rule
infoLink's `name` matches its target rule's collected `ruleTexts` key across the
sampled catalogues.

**Accepted cost (per Approach 1).** Rule infoLinks also carry weapon/unit
keywords (Pistol, Lethal Hits, Leader, …) — in Sororitas, 102 of 455 entries,
25 distinct names, mostly keywords already surfaced via the "Keywords"
characteristic. Those names will now also appear in each weapon/unit's
`ruleNames`. Only the detachment panel reads `ruleNames`, so this is invisible
to every other feature; it is a modest, bounded IR-size increase (entries are
interned in the packed pool, so the growth is per-unique-entry, not
per-occurrence). This is the deliberate price of keeping the parser generic; a
future scoping pass can trim it if size ever matters (YAGNI now).

## Components & changes

All changes are in `packages/engine-parser` (Rust) plus a data republish. No
TypeScript/domain/schema change.

### 1. `raw/model.rs` — carry the link name
`RawInfoLink` gains `pub name: String` (alongside `target_id`, `link_type`,
`hidden`). Needed because the association key for a rule link is its name.

### 2. `raw/parse.rs` (XML / 10e) — capture the `name` attribute
`read_infolinks_into` already reads `targetId`, `type`, `hidden` from each
`<infoLink>`; also read the `name` attribute into `RawInfoLink.name` (default
`""` when absent). No other XML change.

### 3. `raw/parse_json.rs` (JSON / 11e) — capture the `name` field
`JsonInfoLink` gains `name: String` (serde default `""`); `map_info_links`
copies it into `RawInfoLink.name`. No other JSON change.

### 4. `resolve/links.rs` — emit rule-link names into `rule_names`
In `resolve_entry`, after the existing `resolve_info_links(...)` profile pass,
append the names of the entry's non-hidden `type="rule"` infoLinks to
`out.rule_names`, **deduped** against names already present (so an entry with
both a direct `<rule name="X">` and an `infoLink name="X"` lists `X` once).
Skip hidden rule links (mirrors the profile pass; a hidden rule link is an
intentionally non-surfaced rule). Group-level rule infoLinks are a documented
no-op — `IrGroup` has no `rule_names` field and detachment rules live on entry
options, not groups (parallel to the existing group-level profile-infoLink
no-op).

Concretely, factor the rule-name emission into a small helper called from
`resolve_entry` with `&mut out.rule_names` and `&entry.info_links`; leave
`resolve_info_links` (profiles) untouched.

## Data flow

`raw::parse_*` (now records each infoLink's `name`) → `resolve` (rule links →
`rule_names`, deduped; then `info_links` cleared as today) → `to_ir`
(`rule_names` copied to `IrEntry.ruleNames` as today) → `pack` → published IR →
SetupWizard renders `ruleTexts[name]` for each detachment's `ruleNames`.

## Testing

**Unit (Rust, `resolve/links.rs` tests):**
- An entry with a `type="rule"` infoLink (name "R", non-hidden) ends up with
  `"R"` in `rule_names`.
- Dedup: an entry with a direct `<rule "R">` **and** an `infoLink` name "R"
  lists `"R"` exactly once.
- A hidden rule infoLink is skipped.
- A `type="profile"` / `type="infoGroup"` infoLink does **not** add to
  `rule_names` (only profiles inline, unchanged).
- Order: direct rule names precede link-derived names (stable, deterministic).

**Reader unit tests:** `raw/parse.rs` and `raw/parse_json.rs` each assert an
`<infoLink>` / JSON infoLink round-trips its `name` into `RawInfoLink.name`.

**Golden/parity fixtures:** regenerate any affected golden (`mini40k`,
`parity/twin`) only if it actually contains rule infoLinks; if a golden changes,
inspect the diff to confirm it is purely added rule names, then commit the
regenerated golden.

**Real-data verification (the acceptance gate):** after republish, re-run the
detachment audit (scratchpad `det-audit.mjs`) and confirm `rulesMissing` drops
to near-zero across factions — specifically Sororitas 5/8 → 0/8, Necrons 9/12 →
low, World Eaters and Chaos Daemons resolved. Then browser-verify in the setup
wizard that Adepta Sororitas → Hallowed Martyrs shows the "The Blood of Martyrs"
rule text (was blank).

## Publish & rollout

This changes parsed data, so it needs a data republish (unlike the naming-variant
fix, which was app-only):
1. Merge the parser change.
2. Run `update-catalogues.yml` (`workflow_dispatch`) — or `scripts/update-catalogues.mjs`
   locally (NOT inside a subagent; ~20 min) — to reparse, repack, and publish IR.
3. Verify the deployed IR carries the new `ruleNames` (fetch a republished
   Sororitas IR and check Hallowed Martyrs).

## Out of scope

- **Sub-project C** (enhancement → detachment gating): the enhancement pool's
  per-detachment gating is absent from the IR entirely and needs a separate
  design. Tracked separately; this spec does not address enhancement previews.
- **Genestealer Cults empty detachment root** (root present but `children`/
  `groups` empty — options not inlined): a distinct ingestion/link gap, not a
  rule-association problem. Out of scope here.
- No change to `ruleNames` semantics beyond "inline **and** linked rules"; no new
  fields, no packing/interning changes.
