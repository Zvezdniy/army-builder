# infoLink Profile Resolution — Design

**Date:** 2026-07-19
**Status:** Approved (design); implementation pending plan
**Scope:** Rust engine-parser. Resolve `<infoLink type="profile">` references — currently
ignored — by inlining the referenced shared profile into the owning entry/group, so
units whose invuln (and other shared abilities) are linked rather than inlined regain
those profiles.

## Goal

Make `<infoLink type="profile">` resolve like `<entryLink>` does: look the target up in
a profile pool and inline a copy into the owning `RawEntry`/`RawGroup`'s `profiles`.
After this, the datasheet's existing profile mapping and the web invuln chip work with
no downstream changes.

## Background / evidence

The parser explicitly ignores `<infoLink>` (comment at `packages/engine-parser/src/raw/parse.rs:453`:
"`<infoLink>` references have no description and are ignored"). An infoLink references a
SHARED profile/rule by id — the profile analogue of an entryLink.

Measured against real wh40k-10e BSData:
- 1459 `type="profile"` infoLinks across all `.cat`, of which **94 reference an
  "Invulnerable Save" profile across 11 factions**: Adeptus Custodes 26, Space Marines 19,
  Space Wolves 14, Blood Angels 11, Black Templars 7, Ultramarines 7, Imperial Fists 3,
  Raven Guard/Salamanders/White Scars 2 each, Iron Hands 1.
- Concrete symptom: **Logan Grimnar** carries `<infoLink name="Invulnerable Save"
  type="profile" id="66d-…" targetId="db19-dee7-9530-ef0e"/>`. The parser drops it, so his
  IR has no invuln profile and the web chip shows nothing. Custodes (26 links) likely show
  no invuls at all.
- infoLink shape: `{ name, type ∈ profile|rule|infoGroup, id (the link's own id),
  targetId (referenced id), hidden }`. In Space Wolves: 182 `rule`, 20 `profile`, 4
  `infoGroup`.
- The target profile is defined in a `<sharedProfiles>` pool — e.g. the "Invulnerable Save"
  target `db19-…` is in `Imperium - Space Marines.cat`'s `<sharedProfiles>`, reachable
  because Space Wolves imports the SM library via `catalogueLink importRootEntries`. The
  parser does NOT currently read `<sharedProfiles>` at all (it reads
  `sharedSelectionEntries`/`sharedSelectionEntryGroups` only).

## Architecture

Mirror the existing entryLink resolution machinery (`resolve/symbols.rs` +
`resolve/links.rs`), for profiles.

### 1. Raw model (`raw/model.rs`)

- `RawInfoLink { target_id: String, link_type: String, hidden: bool }`.
- `info_links: Vec<RawInfoLink>` on `RawEntry` and `RawGroup` (infoLinks appear inside
  both — 206 infoLinks / 176 groups in the SW file).
- `shared_profiles: Vec<RawProfile>` on `RawCatalogue`.

### 2. Raw parse (`raw/parse.rs`)

- Read `<sharedProfiles><profile.../></sharedProfiles>` into `cat.shared_profiles` (new;
  reuses the existing `read_profiles_into` used for entry/group profiles).
- Read `<infoLinks><infoLink .../></infoLinks>` inside entries and groups into
  `info_links` (targetId → target_id, type → link_type, hidden). This replaces the current
  ignore-and-skip behavior. The flat rule-capture pass (`read_all_rules`) is unchanged, so
  `type="rule"` texts remain globally available regardless of this change.

### 3. Merge (`raw/merge.rs`)

- Carry `shared_profiles` from each supporting/library file into the primary (dedup by id,
  first-wins), exactly like `shared_entries`/`shared_groups`. This is what makes the SM
  library's shared "Invulnerable Save" profile reachable when assembling Space Wolves.

### 4. Symbols (`resolve/symbols.rs`)

- Add `profiles: HashMap<String, RawProfile>` and a `profile(&self, id) -> Option<&RawProfile>`
  accessor. Populate from `cat.shared_profiles` and from every profile encountered while
  walking shared entries/groups (`walk_entry`/`walk_group`), so both pooled and inline
  profile targets resolve. On a duplicate profile id, first-wins (do NOT error — unlike
  entries/groups, duplicate profile ids across merged libraries are benign and must not
  abort the parse).

### 5. Resolve (`resolve/links.rs`)

- In `resolve_entry` and `resolve_group`, after resolving `entry_links`, resolve
  `info_links`: for each with `link_type == "profile"` and `!hidden`, look up
  `symbols.profile(target_id)`; on hit, push a clone onto the node's `profiles`; on miss,
  push a tolerant diagnostic (`code: "infolink.unresolved"`, message naming the target id)
  and continue. Non-`profile` link types are skipped silently (rule text is already global;
  `infoGroup` is out of scope). Clear `info_links` on the resolved node (like `entry_links`
  are cleared). No cycle concern: a profile is a leaf (it has no further links).

### 6. IR mapping (`ir/map.rs`)

- No change. Inlined profiles are ordinary `RawProfile`s in `node.profiles` and flow
  through the existing profile mapping into `IrProfile`.

### 7. JSON reader parity (`raw/parse_json.rs`)

- The resolve step is shared by both front-ends, so the JSON reader must also populate the
  new raw fields or 11e catalogues would silently drop infoLinks. Add `infoLinks` +
  `sharedProfiles` to the JSON DTOs (`JsonEntry`/`JsonGroup` gain `info_links`; `JsonCat`
  gains `shared_profiles`) and map them into `RawInfoLink`/`shared_profiles`. This keeps
  both front-ends producing the same `RawCatalogue`.

## Result

Logan's "Invulnerable Save" profile — and the other 93 invuln links plus every other
shared profile referenced by infoLink — inline into their entries, appear in the datasheet
Abilities section, and the existing `findInvuln` chip renders. No web-layer change.

## Scope / non-goals

**In scope:** reading `<sharedProfiles>` and `<infoLinks>`; merging shared profiles;
resolving `type="profile"` infoLinks (XML and JSON front-ends); tolerant unresolved
diagnostic; tests.

**Out of scope (explicit):**
- `type="rule"` infoLinks (182 in SW) — rule text is already globally captured by
  `read_all_rules`; surfacing a linked rule AS a unit's keyword/ability is a separate
  concern.
- `type="infoGroup"` infoLinks (4 in SW).
- The wargear/enhancement-granted invuln gap (Storm Shield, Blessed Hull, Veil-of-Ancients
  enhancement) — that is selection-provenance in `@muster/roster`'s `datasheet()`, tracked
  separately.
- Republishing the deployed catalogue data — the deployed Pages data updates only after the
  update-catalogues pipeline re-runs (owner CI/push); this parser fix reaches users only
  after a repack+redeploy.

## Error handling & diagnostics

- Unresolved infoLink target → `Diagnostic { code: "infolink.unresolved", … }`, dropped and
  skipped (tolerant, mirroring `entryLink target … not found`).
- A `hidden="true"` profile infoLink is skipped (not inlined), consistent with how hidden
  entryLinks are treated.
- Duplicate profile ids in the pool → first-wins, no error.

## Testing

1. **Unit — resolution:** a single-file fixture with a `<sharedProfiles>` "Invulnerable
   Save" profile and a `<selectionEntry>` carrying an `<infoLink type="profile"
   targetId=…>`; assert the resolved entry's `profiles` contains the inlined "Invulnerable
   Save" (and that it maps into IR).
2. **Unit — multi-file assembly:** the shared profile in a supporting file, the infoLink in
   the primary; assert resolution across the merge (the Space Wolves ↔ SM-library shape).
3. **Unit — unresolved:** an infoLink whose target is absent → `infolink.unresolved`
   diagnostic, no crash, entry keeps its other profiles.
4. **Unit — non-profile / hidden:** a `type="rule"` infoLink and a `hidden="true"` profile
   infoLink are not inlined.
5. **Golden:** `parser_output_matches_golden` — mini40k has no infoLinks, so it must stay
   green unchanged; if adding an infoLink to the fixture, regenerate the golden.
6. **XML/JSON parity:** extend the twin parity fixtures with a `sharedProfiles` + `infoLink`
   case so both front-ends produce identical IR (proves the JSON reader reads them).
7. **Real-data verification (tangible):** re-parse the real Space Wolves (+ SM library +
   gst) and assert Logan Grimnar's IR now carries an "Invulnerable Save" Abilities profile;
   spot-check a Custodes unit. Not committed (real data is gitignored/large).

## Risks

- **Duplicate-id abort:** entries/groups error on duplicate ids; profiles must NOT, or
  merging libraries that redefine a shared profile would abort. Mitigated by first-wins in
  the profile pool (§4).
- **Pool completeness:** if a target lives somewhere the pool doesn't scan (e.g. a
  gameSystem-level sharedProfiles), it stays unresolved-with-diagnostic rather than
  crashing; the real-data verification (§7 test 7) measures the residual unresolved count.
