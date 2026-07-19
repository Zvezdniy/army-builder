# 11e JSON Catalogue Reader — Design

**Date:** 2026-07-19
**Status:** Approved (design); implementation pending plan
**Scope:** Sub-project #1 of the "edition selection" effort. Adds a JSON front-end
to the Rust parser so BSData's 11th-edition catalogues (distributed as JSON, not
BattleScribe XML) produce the same `IrCatalogue` as the existing XML path. The
edition-selector UX (manifest/roster/creation flow) is sub-project #2, brainstormed
separately after this lands.

## Goal

Parse a wh40k-11e faction JSON (+ its game-system JSON) into the existing
`RawCatalogue`, so all downstream stages — `resolve` → `to_ir` → `pack` — and the
whole engine/roster/web stack work on 11e data unchanged. The 10e XML path is not
touched.

## Background / evidence

wh40k-11e (`github.com/BSData/wh40k-11e`, gameSystem "Warhammer 40,000 11th Edition"
rev 4, faction files rev ~5) ships **JSON**, e.g. `Imperium - Space Marines.json` and
`Warhammer 40,000.json`. Probing the real Space Marines file confirmed:

- The JSON is the **same BattleScribe semantic model**, serialized as JSON with a
  `$text` convention for element text. Every top-level catalogue key is one our
  `RawCatalogue` already models — **no unknown top-level constructs**.
- Field shapes (real samples):
  - root wrapper: `{"catalogue": {…}}` or `{"gameSystem": {…}}`; inner `type` = `"catalogue"` / `"gameSystem"`.
  - cost: `{name, typeId, value}`
  - constraint: `{id, type, value, field, scope, includeChildSelections, shared}`
  - modifier: `{type, field, value, conditions?, conditionGroups?}`
  - condition: `{type, value, field, scope, childId, shared?, includeChildSelections?, includeChildForces?, childName?}`
  - profile: `{id, name, typeName, typeId, hidden, characteristics:[{name, typeId, $text}]}`
  - entryLink: `{id, name, targetId, type, import, hidden}` (`type` ∈ `selectionEntry` | `selectionEntryGroup`)
  - catalogueLink: `{name, targetId, importRootEntries}`
  - categoryEntry: `{id, name, hidden}`
  - costType (game system): `{id, name, defaultCostLimit, hidden, modifiers?}`
  - forceEntry (game system): `{id, name, categoryLinks, constraints, modifiers, hidden, readme}`
  - rule: `{id, name, alias?, description, hidden, page?, publicationId?}`
- 11e mechanics that motivated this:
  - **Detachment Points** — a real `costType` (`82ae-1066-5107-6ae0`); detachments are
    `upgrade` entries carrying a DP cost. Already representable as an `IrCost`; the DP
    *budget* surfacing is sub-project #2's concern, not this reader's.
  - **Leader/attachment** — modeled on the `main` branch as an `Abilities` profile named
    "Leader" (same as 10e). No new structural construct to parse.
  - **Invulnerable save** — in 11e it is a native Unit-statline characteristic (`InSv`),
    not an Abilities profile. It flows through as an ordinary characteristic; the web
    invuln chip's 11e handling is out of scope here (tracked separately).
- 11e condition comparators `instanceOf` / `notInstanceOf` are **already handled** by
  `to_ir::map_condition` (mapped to `atLeast 1` / `lessThan 1`); the reader only needs to
  carry the comparator string faithfully — no new work, no drop.
- Genuinely-unmodeled 11e detail with no `RawCatalogue` slot: the condition field
  `includeChildForces` (ignored — our conditions have no forces-child notion) and an
  `associations` array on a handful of entries (dropped **loudly** with a diagnostic,
  never silently).

## The one clean seam

The whole parser funnels through `raw::parse_raw(xml_bytes) -> RawCatalogue`. Adding a
sibling `raw::parse_raw_json(json_bytes) -> RawCatalogue` means `resolve`, `to_ir`,
`merge_supporting`, and `pack` are reused with zero changes. Both `<catalogue>` and
`<gameSystem>` roots are already handled by `parse_raw`; the JSON reader handles both
inner types the same way (a game system parses into a `RawCatalogue` merged as a
supporting file, exactly like a `.gst`).

## Architecture

### Approach: serde DTOs

Define `#[derive(Deserialize)]` DTO structs mirroring the BS-JSON shapes (with
`#[serde(rename_all = "camelCase")]` and explicit `#[serde(rename = "$text")]` for text
nodes), then a pure `From`/mapping layer DTO → `RawCatalogue`. Rationale over the two
alternatives: a `serde_json::Value` hand-walk is stringly-typed and error-prone; a
JSON→XML transcode double-parses and breaks on the `$text`/attribute distinction. DTOs
are type-safe, self-documenting, and make schema drift a compile error. `#[serde(default)]`
on every optional field means unknown/absent fields never fail the parse.

### New module: `raw/parse_json.rs`

- `pub fn parse_raw_json(bytes: &[u8]) -> Result<RawCatalogue, ParseError>`
- Internal DTOs: `JsonRoot { catalogue: Option<Cat>, game_system: Option<Cat> }` and
  `Cat`, `JsonEntry`, `JsonGroup`, `JsonEntryLink`, `JsonCost`, `JsonConstraint`,
  `JsonModifier`, `JsonCondition`, `JsonConditionGroup`, `JsonProfile`,
  `JsonCharacteristic`, `JsonCategoryEntry`, `JsonForce`, `JsonCategoryLink`,
  `JsonCatalogueLink`, `JsonCostType`, `JsonRule`.
- Mapping DTO → `RawCatalogue` mirrors, field-for-field, what `raw/parse.rs` extracts
  from XML (the authoritative target). Reference mapping:

  | RawCatalogue field | JSON source |
  |---|---|
  | `id`, `name`, `revision`, `game_system_id` | inner object scalars |
  | `cost_types: id→name` | `costTypes[].{id,name}` (game system) |
  | `categories: id→name` | `categoryEntries[].{id,name}` |
  | `rules: name/alias→description` | all `rules`/`sharedRules` (+ nested) `{name,alias,description}` |
  | `shared_entries` | `sharedSelectionEntries[]` |
  | `shared_groups` | `sharedSelectionEntryGroups[]` |
  | `entries` | `selectionEntries[]` |
  | `force_entries` | `forceEntries[].{id,name,constraints,categoryLinks}` |
  | `catalogue_links` | `catalogueLinks[].{targetId,importRootEntries}` |
  | `entry_links` | `entryLinks[].{id,targetId,type,hidden,modifiers}` |

  Per-entry: `costs`→`RawCost{type_id,value}`, `constraints`→`RawConstraint`,
  `modifiers`→`RawModifier`, nested `selectionEntries`/`selectionEntryGroups`,
  `entryLinks`, `profiles`→`RawProfile` (characteristics `{name, $text→value}`).
  Conditions map `type`→`comparator`, `childId`→`child_id`.

- Rules capture must match XML's behavior: rules live both at top level
  (`rules`/`sharedRules`) and nested inside entries/forces. The DTO tree captures nested
  ones structurally; a small recursive collect walks the DTO tree to fill
  `RawCatalogue.rules` (mirroring `read_all_rules`'s flat second pass).

### Dispatch by format

Introduce an input `Format` so the front-end is chosen once, near I/O:

```rust
enum Format { Xml, XmlZip, Json }
```

- `read_input(path)` returns `(Vec<u8>, Format)`: extension `.json` → `Json`;
  `.catz/.gstz/.rosz/.zip` → `XmlZip`; else `Xml`.
- A single `parse_bytes_fmt(bytes, Format)` dispatches: `Json` → `parse_raw_json`;
  `Xml`/`XmlZip` → `to_xml` + `parse_raw`. `parse_bytes(bytes, is_zip)` stays as a thin
  wrapper (back-compat for the existing golden/test callers).
- `parse_system` / `parse_system_files` thread `Format` per input so a JSON faction can
  be assembled with a JSON game system, exactly as `.cat` + `.gst` today.
- **Pipeline impact:** `scripts/update-catalogues.mjs` needs no logic change — it passes
  file paths to `muster-parse`; extension dispatch does the rest. Switching a faction to
  11e is then a `catalogues.config.json` change (repo + `.json` filenames), which is
  sub-project #2's wiring, not this reader's.

## Error handling & diagnostics

- Malformed JSON / missing required scalars (`id`, `name`) → `ParseError` (hard fail),
  same posture as the XML parser on structural breakage.
- Neither `catalogue` nor `gameSystem` present at the root → `ParseError`.
- Representable-but-unmodeled 11e details:
  - `associations` array on an entry → dropped **loudly**:
    `diag("entry <id> associations dropped (unsupported)")` (never silent, matching the
    codebase convention).
  - `includeChildForces` on a condition → ignored (documented), since our conditions have
    no forces-child notion. No diagnostic: it never changes a mapping we make.
  - Condition comparators `instanceOf` / `notInstanceOf` need **no** special handling —
    `to_ir::map_condition` already maps them (`atLeast 1` / `lessThan 1`). A truly unknown
    comparator still hits that function's existing `condition.comparator_unmapped` drop.
- `MAX_INPUT_BYTES` size cap applies before parsing (same guard as XML).

## Scope / non-goals

**In scope:** JSON→`RawCatalogue` for `catalogue` and `gameSystem` roots; format
dispatch; faithful mapping of every field the XML parser reads; loud diagnostics for the
known 11e deltas; unit + parity + real-data tests.

**Out of scope (explicit):** zipped JSON (repo ships plain `.json`); the edition-selector
UX; Detachment-Points budget surfacing in engine/roster/UI; the web invuln chip's `InSv`
handling; repointing `catalogues.config.json` to 11e in production (prod stays 10e until
BSData 11e matures — currently gameSystem rev 4).

## Testing

1. **Unit fixtures** — small hand-written 11e-shaped JSON fixtures (mirroring the
   `mini40k` XML fixtures) exercising: a catalogue with entries/groups/constraints/
   modifiers/profiles/costs; a game system with costTypes/categories/forceEntries/rules;
   `$text` characteristics; a catalogueLink with `importRootEntries`; an entry with
   `associations` (asserts the drop diagnostic).
2. **Parity test** — the same logical catalogue authored once in XML and once in JSON must
   produce byte-identical `to_ir` output (`serde_json::to_value` equality), mirroring the
   existing `.cat`/`.catz` parity test. This is the load-bearing correctness gate: it
   proves the JSON front-end and the XML front-end converge on the identical IR.
3. **Real-data verification (tangible)** — parse the real wh40k-11e Space Marines JSON +
   game-system JSON end-to-end; assert a non-trivial root/unit count and a bounded,
   inspected diagnostic set; optionally pack and load into the web inspector to view 11e
   units. Reported as tangible output, not a spec sign-off.

## Risks

- **Data maturity** — 11e is gameSystem rev 4; the schema may still shift. The DTO's
  `#[serde(default)]` tolerance and loud-drop diagnostics contain this: new fields are
  ignored, new drops are visible, and the parity test guards the mapping we do support.
- **Silent-drift blind spot** — `#[serde(default)]` tolerance means a genuinely new,
  meaningful field could be ignored without a diagnostic. Mitigation: the real-data
  verification reviews the full diagnostic set and root/unit counts against expectations,
  so a material omission shows up as a count/shape anomaly rather than passing silently.
