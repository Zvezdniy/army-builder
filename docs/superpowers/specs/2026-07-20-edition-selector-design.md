# Edition Selector (Sub-project C) — Design

**Date:** 2026-07-20
**Status:** Approved (design; backend mechanics decided autonomously per project workflow)
**Scope:** `scripts/` (data pipeline), `apps/web` (registry + setup wizard).

Give the app an **edition dimension**: the catalogue library carries both 10th- and
11th-edition factions, and the user picks the edition when creating an army. This is the
original ask of the 11e work (sub-projects A and B shipped first). It also carries the data
plumbing that finally makes B visible in the browser — the packed catalogues currently in
`apps/web/public` predate B and carry no `characteristicModifiers`.

## Findings that shape the design

- **Catalogue ids collide across editions.** `BSData/wh40k-11e`'s Space Marines catalogue has
  the *same* id (`e0af-67df-9d63-8fb7`) and the *same* name as `wh40k-10e`'s. `loadRegistry`
  dedups by `descriptor.id`, so a naive flat merge silently drops one edition's entire
  faction list. Descriptor identity must therefore be **`<edition>:<catalogueId>`**.
- **`gameSystemId` already distinguishes the editions** in the IR (11e = `sys-352e-adc2-7639-d610`,
  10e = its own). It is a reliable cross-check but a poor UI key, so the human-readable
  edition id (`10e`/`11e`) comes from the pipeline config and travels in the manifest.
- **11e ships JSON, 10e ships XML.** The parser already dispatches on extension (11e JSON
  reader shipped earlier), but `update-catalogues.mjs`'s acquisition guard
  (`assertCatalogueFile`) hard-codes the XML root tags `<catalogue` / `<gameSystem` and would
  reject every 11e file before the parser ever ran.
- **The faction sets are near-identical** (47 files in 11e vs 35 configured 10e factions):
  same naming convention, same split-library pattern. 11e has no Ynnari; it adds Titanicus /
  Unaligned Forces / Legends content that stays out of the matched-play config.
- **Nothing persists across reloads** — `App` holds catalogue/roster in state only. Edition
  is therefore purely a selection-time dimension; no migration concern.

## Design

### 1. Pipeline config — `scripts/catalogues.config.json` v2

```
{ "editions": [
    { "id": "10e", "name": "10th Edition", "repo": "BSData/wh40k-10e", "ref": "main",
      "gameSystem": "Warhammer 40,000.gst",  "catalogues": [ … as today … ] },
    { "id": "11e", "name": "11th Edition", "repo": "BSData/wh40k-11e", "ref": "main",
      "gameSystem": "Warhammer 40,000.json", "catalogues": [ … .json filenames … ] } ] }
```

`update-catalogues.mjs` loops editions: one shallow clone per edition repo, parse/pack each
faction into **`apps/web/public/catalogues/<editionId>/<slug>.ir.json`**. A legacy flat config
(no `editions` key) is normalized to a single `10e` edition, so the ad-hoc smoke configs used
during investigations keep working. Per-faction failure still warns and continues; a failing
*edition* (clone failure) warns and continues to the next edition rather than aborting the run.

`assertCatalogueFile(path, kind)` becomes format-aware: for `.json` inputs it requires a
parseable object carrying the `catalogue`/`gameSystem` key; for XML it keeps today's root-tag
check. Same purpose — catch a truncated or HTML-error download before it becomes a silent
0-root catalogue.

### 2. Manifest v2 — `apps/web/public/catalogues.json`

```
{ "version": 2,
  "editions":   [ { "id": "10e", "name": "10th Edition" }, { "id": "11e", "name": "11th Edition" } ],
  "catalogues": [ { "id": "e0af-…", "edition": "11e", "name": "…", "file": "catalogues/11e/space-marines.ir.json" } ] }
```

`build-catalogue-manifest.mjs` scans each edition subdirectory of
`apps/web/public/catalogues/`, taking edition ids from the directory names and edition display
names from the pipeline config (falling back to the id). Loose `*.ir.json` directly under
`catalogues/` are still picked up and attributed to edition `10e`, so a stale flat output
directory degrades instead of vanishing.

### 3. Registry — `apps/web/src/registry/catalogueRegistry.ts`

- `CatalogueDescriptor` gains `edition: string`, `editionName: string`, and `catalogueId: string`
  (the raw BSData id). Its `id` becomes the composite `"<edition>:<catalogueId>"` — the collision
  fix. Nothing outside the registry parses `id`; it is an opaque key.
- `parseManifest` accepts **v2** and, unchanged in spirit, **v1** (every entry attributed to
  edition `10e`, edition name "10th Edition"). Any other shape → `null` + the existing warning,
  degrading to bundled-only.
- `bundledDescriptor(data, edition)` takes the edition explicitly; `App` passes `10e` (mini40k
  is a 10e-shaped fixture). `loadRegistry` dedups by composite id, bundled still wins.
- `loadCatalogueFor` is unchanged (it already joins `baseUrl` + `file`, and `file` now carries
  the edition subdirectory).

### 4. Wizard — the edition control

The Faction step gains a **segmented edition control above the faction grid**, rendered only
when the registry contains **two or more editions**. Picking an edition filters the grid to that
edition's factions; picking a faction behaves exactly as today. The control defaults to the
active descriptor's edition.

Chosen over a separate wizard step: edition and faction are one decision ("11th-edition Space
Marines"), it costs the user no extra click, and it leaves the existing step indices — which
`App`, `SetupBar` and the wizard tests all address by number — untouched. With a bundled-only
registry (one edition) the control is hidden and the wizard is pixel-identical to today.

Faction cards keep showing the faction name; the edition is unambiguous from the active
segment, so the colliding names never appear side by side.

### 5. Data

Run the pipeline for both editions locally and verify in the browser that an 11e unit shows
**effective** characteristics (sub-project B's payoff) — the packed data currently served
predates B.

## Scope / non-goals

**In:** edition dimension through config → manifest → registry → wizard; format-aware
acquisition guard; both editions packed and served; browser verification of 11e + B.
**Out:** persisting the chosen edition across reloads (nothing persists today); cross-edition
roster migration; surfacing edition in the roster export/print; 11e Crusade/narrative content;
any change to points/legality or the parser.

## Testing

- **Registry (vitest):** v2 manifest parses with editions; v1 manifest parses as all-`10e`;
  the **same catalogue id in two editions produces two descriptors** (the collision
  regression); malformed manifest still degrades to bundled-only with the warning; composite
  id round-trips through `loadCatalogueFor`.
- **Wizard (vitest):** with a two-edition registry the segmented control renders and filters
  the faction grid; with a one-edition registry it is absent and the existing faction tests
  pass unchanged; switching edition then picking a faction calls `onSelectFaction` with the
  composite id.
- **Pipeline:** unit-level checks are impractical (network + cargo); verification is the real
  run — both edition directories populated, manifest v2 lists both, `<edition>/<slug>` paths
  resolve.
- **Real-data / browser:** load 11e Space Marines in the running app; a unit with an
  Artificer-Armour-style enhancement shows the modified save; 10e Space Marines still loads
  and is unchanged.

## Risks

- **Id collision** is the sharpest failure mode and is silent — covered by an explicit
  registry test, not just by inspection.
- **11e data churn** (gameSystem revision 5): a faction that fails to parse is skipped with a
  warning, exactly as 10e faction failures are today; the edition still ships its other factions.
- **Manifest/registry version skew:** a v1 manifest left over from an earlier run keeps working
  (attributed to 10e), so a stale `public/` never blanks the faction list.
- **Deploy ordering (the skew in the OTHER direction).** The reverse pairing is *not* tolerant:
  a pre-edition app build rejects a v2 manifest outright (`version !== 1` → null) and degrades
  to bundled-only, i.e. the whole faction list disappears for that client. The scheduled
  pipeline publishes catalogue data independently of the app, so **ship the app build before
  the first v2 data publish**. Until then local dev is also affected: `apps/web/.env.local`
  points `VITE_CATALOGUES_BASE` at the deployed GitHub Pages library, so the running app keeps
  reading the old v1 10e-only data and shows no edition picker — indistinguishable from a
  regression. Move that file aside to work against `apps/web/public`.
