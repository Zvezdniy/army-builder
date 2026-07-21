# Stratagems — S-A: Data Pipeline — Design

**Date:** 2026-07-21
**Status:** Design (sub-project S-A of the Stratagems project; scope approved: Wahapedia full-text source)

## Where this sits

The Stratagems project is decomposed into three sub-projects, each with its own
spec → plan → implementation cycle:

- **S-A — Data pipeline (this doc).** Fetch the Wahapedia stratagem export,
  transform it into per-faction JSON under `apps/web/public/stratagems/`, and
  write a manifest. The foundation everything else reads.
- **S-B — Domain + selection logic.** A `Stratagem` type, a loader, and
  `stratagemsForRoster(...)` = Core stratagems + the selected detachment's
  stratagems. Consumes S-A's output shape.
- **S-C — UI panel.** A collapsible `StratagemPanel` grouping Core / Detachment
  stratagems with full effect text and a "powered by Wahapedia" attribution.

This spec covers **S-A only**. It defines the output JSON shape precisely,
because S-B consumes it, but implements no domain type, selection logic, or UI.

## Problem

BSData's 10e/11e catalogues do **not** carry stratagem text — the ~90 "stratagem"
hits in the packed IR are incidental mentions inside ability rule text, not
stratagem entities. The community reference builders (New Recruit, War Organ)
source 10e stratagem descriptions from the **Wahapedia data export**. We adopt the
same posture (owner decision, memory `ip-posture-grey-zone`): host/redistribute the
data with a "powered by Wahapedia" attribution, keep git light (data on the CDN/CI
path, not in source), and refresh it out-of-band from app deploys — exactly how the
catalogue library already works.

## Source data (verified 2026-07-21)

Wahapedia publishes pipe-delimited CSVs. We fetch one:

- `https://wahapedia.ru/wh40k10ed/Stratagems.csv` (~1.06 MB, 1481 records)

`Factions.csv` (26 codes) was used once, offline, to author the faction-mapping
table below; it is **not fetched at build time** — the mapping ships in
`scripts/stratagems.config.json`, so the pipeline has a single network dependency.
The fetch requires a browser `User-Agent` header (a bare curl UA gets blocked).

### Edition note — 11e currently mirrors 10e

`https://wahapedia.ru/wh40k11ed/Stratagems.csv` and `.../Factions.csv` return
HTTP 200 but are **byte-identical** to the 10e files (same 1.06 MB, same 1481
records; the 11e `Factions.csv` links even point back at `wh40k10ed/`). Wahapedia
has not yet published distinct 11th-edition stratagem data.

**Consequence for scope:** the stratagem dataset is **edition-agnostic** right now
— one shared body of data keyed by faction, not two edition-specific datasets. So
S-A produces a **single, flat, per-faction** output (no `10e/` `11e/`
subdirectories, unlike the catalogue library). The app serves the same stratagem
data whether the user is on 10e or 11e. When Wahapedia eventually diverges the two
editions, S-A grows an edition axis then — deferred until the data actually splits,
not built speculatively (YAGNI). The `sourceUrl` is configurable so we can point at
`wh40k11ed` the moment it carries real 11e content.

### Stratagems.csv columns

```
faction_id | name | id | type | cp_cost | legend | turn | phase | detachment | detachment_id | description |
```

(trailing empty 11th field). Field meanings, from the real data:

| Column | Meaning | Example |
|--------|---------|---------|
| `faction_id` | Wahapedia faction code, **empty for Core stratagems** | `SM`, `NEC`, `` |
| `name` | Stratagem display name (ALL-CAPS in source) | `ARMOUR OF CONTEMPT` |
| `id` | Wahapedia's **stable, globally-unique** stratagem id (all 1481 distinct) | `000008495003` |
| `type` | `"<owner> – <category> Stratagem"`; owner is `Core` for universal core | `1st Company Task Force – Battle Tactic Stratagem` |
| `cp_cost` | Command-point cost | `1`, `2` |
| `legend` | Flavour text (may be empty) | `…` |
| `turn` | Whose turn it may be used | `Either Player's turn` |
| `phase` | Phase(s) | `Shooting or Fight phase` |
| `detachment` | Detachment name (empty for Core) | `1st Company Task Force` |
| `detachment_id` | Stable detachment id (empty for Core) | `000000798` |
| `description` | **Full HTML effect text** (`<b>WHEN:</b> … <b>TARGET:</b> … <b>EFFECT:</b> …`) | `<b>WHEN:</b> Your Shooting phase…` |

### Two clean tiers (drives S-B selection)

Two tiers matter for matched play; a third slice is game-mode noise we drop.
The `type` column encodes the owning "detachment" as its prefix (`"<owner> –
<category> Stratagem"`), and that prefix is what classifies the empty-faction rows:

- **Universal Core stratagems** — `faction_id == "" AND type-prefix == "Core"`.
  **11 records** — exactly GW's matched-play core (Command Re-roll, Counter-offensive,
  Epic Challenge, Insane Bravery, Go to Ground, Smokescreen, Grenade, Tank Shock,
  Rapid Ingress, Fire Overwatch, Heroic Intervention). Apply to every army.
- **Detachment stratagems** — `faction_id != ""`. **1453 records.** Each belongs to
  exactly one detachment (`detachment_id`) inside its faction. (All 1453 carry a
  `detachment_id`; game-mode pseudo-detachments never match a real BSData detachment
  choice, so no extra filtering is needed on this side — S-B keys on the roster's
  chosen `detachment_id`.)
- **Dropped — game-mode / artefact** — the other **17** empty-faction rows:
  Boarding Actions (5) and Challenger (9) are narrative-mode stratagems, not matched
  play; three duplicate "NEW ORDERS" rows (type-prefix `"Core Stratagem"`, not
  `"Core"`) are a source artefact. S-A drops all 17 and logs the count. Detecting
  Core by the exact `"Core"` prefix — not merely by an empty `faction_id` — is what
  excludes them.

So S-B's `stratagemsForRoster` will be **Core (always) + the selected detachment's
stratagems** — a two-set union, nothing more. S-A's job is to make those two sets
trivially addressable.

### Parsing hazard — embedded newlines

`description` contains **literal newline characters** (real line breaks inside the
HTML), so naive line-based CSV splitting corrupts records (this bit an earlier
probe). The robust reader, verified to recover all 1481 records:

1. Strip the UTF-8 BOM; take the header line; count its `|` delimiters (11).
2. Walk the remaining physical lines, **accumulating** into a record buffer,
   re-joining with `\n`, until the buffer's `|` count reaches the header count.
   Emit the record and reset. Flush any non-empty trailing buffer.
3. Split each record on `|`; the 11 columns map by position as above.

No quoting is used by Wahapedia (no `"`-escaping); the delimiter is a bare `|` and
descriptions do not contain `|`. The header pipe-count reassembly is the whole trick.

## Faction mapping

Wahapedia's `Factions.csv` gives 23 playable-army codes we care about (plus
Titanicus/Unaligned/Unbound we ignore). Our catalogue library (`catalogues.config.json`)
has **35 slugs** — more, because Space Marine chapters and the Aeldari Ynnari are
separate catalogues for us but fold into a parent faction on Wahapedia.

S-A ships an explicit `ourSlug → wahapediaFactionId` table. Every one of our 35
slugs maps to a Wahapedia faction; chapters map to `SM`, Ynnari maps to `AE`:

| Wahapedia | Our slug(s) |
|-----------|-------------|
| `SM` | `space-marines`, `blood-angels`, `dark-angels`, `space-wolves`, `black-templars`, `deathwatch`, `ultramarines`, `imperial-fists`, `iron-hands`, `raven-guard`, `salamanders`, `white-scars` |
| `CSM` | `chaos-space-marines` |
| `AE` | `aeldari`, `ynnari` |
| `DRU` | `drukhari` |
| `NEC` | `necrons` |
| `ORK` | `orks` |
| `TYR` | `tyranids` |
| `GC` | `genestealer-cults` |
| `AM` | `astra-militarum` |
| `AoI` | `agents-of-the-imperium` |
| `AdM` | `adeptus-mechanicus` |
| `AC` | `adeptus-custodes` |
| `AS` | `adepta-sororitas` |
| `GK` | `grey-knights` |
| `QI` | `imperial-knights` |
| `TAU` | `tau-empire` |
| `LoV` | `leagues-of-votann` |
| `CD` | `chaos-daemons` |
| `QT` | `chaos-knights` |
| `DG` | `death-guard` |
| `TS` | `thousand-sons` |
| `EC` | `emperors-children` |
| `WE` | `world-eaters` |

Chapters point at the same `SM` stratagem set as vanilla Space Marines; S-B narrows
by the **selected detachment**, so a Blood Angels roster on a BA detachment surfaces
that detachment's stratagems from the SM set (and Core), while unrelated SM
detachment stratagems stay hidden. The mapping is total: no slug degrades to
"core-only" by accident; if a future slug is added with no Wahapedia parent, the
build **warns and skips** that faction file (never emits a broken/empty one),
mirroring the catalogue pipeline's per-faction warn-and-continue.

## Output

Written under `apps/web/public/stratagems/` (gitignored, same as
`public/catalogues/`). Flat, per-faction, edition-agnostic.

### `stratagems/_core.json` — the 11 universal Core stratagems

```json
{
  "source": "Wahapedia",
  "kind": "core",
  "stratagems": [ /* Stratagem[] — see shape below */ ]
}
```

### `stratagems/<wahapedia-faction>.json` — one per Wahapedia faction

Filename uses a **stable, Wahapedia-derived slug** so that many of our catalogue
slugs (all SM chapters) share one file without duplication. We name each file after
the *canonical* catalogue slug for that Wahapedia faction — `space-marines.json`,
`aeldari.json`, `necrons.json`, … (the first/vanilla slug in the mapping row).

```json
{
  "source": "Wahapedia",
  "kind": "faction",
  "wahapediaFactionId": "SM",
  "stratagems": [ /* Stratagem[] */ ]
}
```

### `Stratagem` shape (the S-A ↔ S-B contract)

Each element of `stratagems[]`:

```jsonc
{
  "id": "000008495003",       // rec.id verbatim — Wahapedia's stable, globally-unique id
  "name": "HEROES OF THE CHAPTER",
  "category": "Battle Tactic", // parsed from `type`: the "<X>" in "… – <X> Stratagem"; "" for Core
  "cpCost": 1,                 // integer; parsed from cp_cost, non-numeric → 0
  "turn": "Either Player's turn",
  "phase": "Shooting or Fight phase",
  "detachment": "1st Company Task Force", // "" for Core
  "detachmentId": "000000798",            // "" for Core
  "legend": "",                // flavour; may be ""
  "description": "<b>WHEN:</b> …"          // raw Wahapedia HTML, preserved verbatim
}
```

- `description` is stored **as-is** (Wahapedia HTML). Sanitising / rendering is S-C's
  concern, not S-A's — S-A does not strip or rewrite the markup.
- `category` is derived for display/grouping only; selection keys on
  `detachmentId` (and the Core file), never on `category`.

### `stratagems.json` — manifest

Mirrors `catalogues.json`'s role: the app fetches this first.

```json
{
  "version": 1,
  "source": "Wahapedia",
  "attribution": "Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop.",
  "core": { "file": "stratagems/_core.json", "count": 11 },
  "factions": [
    { "slug": "space-marines", "wahapediaFactionId": "SM", "file": "stratagems/space-marines.json", "count": 255 },
    { "slug": "blood-angels",  "wahapediaFactionId": "SM", "file": "stratagems/space-marines.json", "count": 255 }
    /* … every one of our 35 slugs → its faction file … */
  ]
}
```

every one of our 35 catalogue slugs appears in `factions[]`, so S-B resolves a
roster's faction slug directly to a file (SM chapters all resolve to
`space-marines.json`). The manifest is the only lookup S-B needs; it never parses
the faction-mapping table itself.

## Architecture

One new script + one config addition + a gitignore entry. Nothing in the app
changes in S-A (the app wiring is S-B/S-C).

```
scripts/update-stratagems.mjs   (new)  fetch → parse → transform → write
scripts/stratagems.config.json  (new)  sourceUrl, faction slug→wahapedia map, attribution
apps/web/public/stratagems/     (new, gitignored)  _core.json + <faction>.json + stratagems.json
.gitignore                       (edit) ignore apps/web/public/stratagems/
```

### `scripts/update-stratagems.mjs`

A standalone Node ESM script, same shape and error-handling discipline as
`update-catalogues.mjs`:

1. Read `scripts/stratagems.config.json` (source base URL, the slug→faction map,
   attribution string).
2. Fetch `Stratagems.csv` with a browser `User-Agent`. Guard the response: non-200,
   or a body under a sanity floor (e.g. < 100 KB), or a body whose first line is not
   the expected pipe header → **throw** (a truncated/HTML error page must never
   overwrite good data).
3. Parse with the header-pipe-count reassembly reader (above). Assert the record
   count is within a sane band (e.g. ≥ 1000) — a thin parse means the reader broke.
4. Split into Core (`faction_id == ""`) and per-faction buckets keyed by
   `faction_id`; drop any `faction_id` not in the mapping's value set (Titanicus,
   Unaligned, Unbound) with a logged count.
5. Transform each record into the `Stratagem` shape; derive `category` from `type`;
   coerce `cpCost` to an integer (non-numeric → 0).
6. Write `_core.json`, one `<canonical-slug>.json` per Wahapedia faction, and
   `stratagems.json` (expanding every one of our 35 slugs to its file). Write to a
   temp path and move into place only after the whole build validates, so a failed
   run never leaves a half-written directory (mirrors the catalogue pipeline's
   place-on-success rule).

The script is runnable locally (`node scripts/update-stratagems.mjs`) and is the
unit a future CI job (`update-stratagems.yml`, out of scope here) would run on a
schedule. It does **not** touch the parser, the catalogue pipeline, or the app.

### `scripts/stratagems.config.json`

```json
{
  "sourceBase": "https://wahapedia.ru/wh40k10ed",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "attribution": "Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop.",
  "factionMap": {
    "space-marines": "SM", "blood-angels": "SM", "dark-angels": "SM", "space-wolves": "SM",
    "black-templars": "SM", "deathwatch": "SM", "ultramarines": "SM", "imperial-fists": "SM",
    "iron-hands": "SM", "raven-guard": "SM", "salamanders": "SM", "white-scars": "SM",
    "chaos-space-marines": "CSM", "aeldari": "AE", "ynnari": "AE", "drukhari": "DRU",
    "necrons": "NEC", "orks": "ORK", "tyranids": "TYR", "genestealer-cults": "GC",
    "astra-militarum": "AM", "agents-of-the-imperium": "AoI", "adeptus-mechanicus": "AdM",
    "adeptus-custodes": "AC", "adepta-sororitas": "AS", "grey-knights": "GK",
    "imperial-knights": "QI", "tau-empire": "TAU", "leagues-of-votann": "LoV",
    "chaos-daemons": "CD", "chaos-knights": "QT", "death-guard": "DG",
    "thousand-sons": "TS", "emperors-children": "EC", "world-eaters": "WE"
  },
  "canonicalSlug": {
    "SM": "space-marines", "CSM": "chaos-space-marines", "AE": "aeldari", "DRU": "drukhari",
    "NEC": "necrons", "ORK": "orks", "TYR": "tyranids", "GC": "genestealer-cults",
    "AM": "astra-militarum", "AoI": "agents-of-the-imperium", "AdM": "adeptus-mechanicus",
    "AC": "adeptus-custodes", "AS": "adepta-sororitas", "GK": "grey-knights",
    "QI": "imperial-knights", "TAU": "tau-empire", "LoV": "leagues-of-votann",
    "CD": "chaos-daemons", "QT": "chaos-knights", "DG": "death-guard",
    "TS": "thousand-sons", "EC": "emperors-children", "WE": "world-eaters"
  }
}
```

## Testing

S-A is a build script, not library code, so the coverage gate (`@muster/roster`'s
100%) does not apply. Tests target the **pure transform**, which is extracted into a
small importable module so it can be unit-tested without network:

- **CSV reader** (`parseStratagemCsv(text)`): a fixture with an embedded-newline
  description reassembles into the right record count and column split; the BOM is
  stripped; the trailing empty field is tolerated.
- **Record → `Stratagem` transform:** a Core record yields `detachment=""`,
  `detachmentId=""` with its parsed `category` (e.g. `"Battle Tactic"`); a detachment
  record yields non-empty `detachment`/`detachmentId` and the `category` parsed from
  `type`; `cpCost` coerces (`"1"`→1, `""`→0); `id` is `rec.id` verbatim.
- **Core detection / bucketing:** an empty-`faction_id` row with type-prefix `"Core"`
  lands in the Core bucket; empty-`faction_id` rows with any other prefix (Boarding
  Actions, Challenger, "Core Stratagem") are **dropped and counted**; a non-empty
  `faction_id` in the mapping goes to its per-faction bucket; an out-of-map
  `faction_id` (e.g. `TL`) is dropped. Result: Core bucket = 11.
- **Manifest expansion:** all 35 config slugs appear in `factions[]`; SM chapters
  all point at `space-marines.json`; `core.count == 11`.
- **Guard behaviour:** an empty / non-header / short body causes the fetch step to
  throw rather than write output (tested against the transform's validate helper, no
  real network).

A single end-to-end **local run** against live Wahapedia is the acceptance check
(not a CI test): produces `_core.json` (11), 23 faction files, and a 35-entry
manifest, with `space-marines.json` at 255 stratagems.

## Non-goals (S-A)

- No domain `Stratagem` Zod type, no loader, no selection logic (S-B).
- No UI, no HTML sanitisation/rendering, no attribution rendering (S-C).
- No CI workflow file (a later chore, patterned on `update-catalogues.yml`).
- No 11e-specific dataset — one shared edition-agnostic dataset until Wahapedia
  diverges 11e from 10e (see Edition note).
- No detachment-name reconciliation between Wahapedia and BSData — S-A carries
  `detachment` / `detachmentId` verbatim; matching a roster's chosen detachment to
  them is S-B's problem.
- No incremental/delta fetch — a full refresh each run (the dataset is ~1 MB).
```
