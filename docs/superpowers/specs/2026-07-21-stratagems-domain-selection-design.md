# Stratagems — S-B: Domain + Selection — Design

**Date:** 2026-07-21
**Status:** Design (sub-project S-B of the Stratagems project; S-A data pipeline SHIPPED)

## Where this sits

Sub-project 2 of 3. S-A (shipped) writes the Wahapedia stratagem data as per-faction
JSON + a manifest under `apps/web/public/stratagems/`. **S-B** adds the domain types
to read that data and the pure logic that picks the stratagems relevant to a roster:
**Core (always) + the stratagems of each selected detachment**. **S-C** (next) renders
them in a panel. This spec covers **S-B only** — types, loaders, and selection. No UI,
no fetching wiring, no HTML rendering.

## Problem

The app has a roster on a catalogue and (via S-A) a body of stratagem data on disk. To
show a player their usable stratagems it must answer: *given this roster, which
stratagems apply?* In matched play the answer is exactly two tiers:

1. **Core** — 11 universal stratagems, for every army.
2. **Detachment** — the stratagems of each detachment the roster has selected.

The data to answer this exists (S-A output). What is missing is (a) validated domain
types for that data, and (b) a pure function that produces the two tiers for a roster.

## The join key: detachment **name**

The roster's selected detachment is a BSData catalogue entry. S-A's stratagems carry a
Wahapedia `detachment` name and `detachmentId`. **BSData and Wahapedia use different id
systems — there is no shared id.** BSData detachment entries carry no Wahapedia id, and
Wahapedia's `detachmentId` (e.g. `000000798`) is meaningless to BSData. The only usable
join key is the **detachment display name** (`"Gladius Task Force"`, `"Anvil Siege
Force"`, …), which both sides express as the canonical GW name.

Names differ only in punctuation/whitespace/case across the two sources (curly vs
straight apostrophes, en-dash spacing, capitalisation). So S-B matches on a **normalised
name**: lowercase, every run of non-alphanumeric characters collapsed to a single space,
trimmed. `normalize("Emperor's Shield") === normalize("Emperor’s Shield")`. A name that
does not match any stratagem's detachment yields an **empty** detachment tier for that
detachment — safe, silent degrade (never a crash, never a wrong stratagem).

## Scope (S-B)

**In scope:**
- Zod schemas + inferred types for the S-A output: `Stratagem`, `StratagemFile`,
  `StratagemManifest`, with `load*` validators (parse-or-throw, mirroring `loadCatalogue`).
- `stratagemFileForSlug(manifest, slug)` — resolve a faction slug to its file path.
- `selectStratagems(core, faction, detachmentNames)` — the two-tier selection, pure.
- `selectedDetachmentNames(roster, catalogue)` — a small roster helper turning the
  selected detachment entryIds into their display names (the input to `selectStratagems`).

**Explicitly deferred (out of S-B):**
- Fetching the manifest/files over the network, and knowing the active faction slug
  (S-C wires this, reusing the catalogue registry's base URL and file-path→slug convention).
- Rendering, HTML sanitisation, attribution display (S-C).
- Command-point affordability / legality of *using* a stratagem (a game-state concern,
  not selection — the panel lists what the army *has access to*, not what it can pay for).
- Reconciling detachment names that genuinely differ between BSData and Wahapedia beyond
  punctuation (an unmatched detachment simply shows core-only) — see Risks.

## Data grounding

Verified against real S-A output (`apps/web/public/stratagems/`):
- `_core.json`: `{source, kind:"core", stratagems:[…11…]}`.
- `<faction>.json`: `{source, kind:"faction", wahapediaFactionId, stratagems:[…]}`;
  e.g. `space-marines.json` has 255 stratagems across 44 distinct `detachment` values.
- `stratagems.json`: `{version:1, source, attribution, core:{file,count},
  factions:[{slug, wahapediaFactionId, file, count}]}` — 35 slug entries.
- A `Stratagem`: `{id, name, category, cpCost, turn, phase, detachment, detachmentId,
  legend, description}` — `cpCost` a number, the rest strings; `detachment`/`detachmentId`
  empty for Core.

The 11e catalogues currently share the 10e-derived Wahapedia data (S-A note); an 11e
roster's BSData detachment names may therefore not all match until Wahapedia ships 11e
data. The normalised-name match + safe degrade handles this without special-casing.

## Architecture

Two packages change; no app change (S-C wires the UI).

### 1. Domain — new file `packages/domain/src/stratagem.ts`

Home of the schemas and pure selection, beside `loadCatalogue`. Exported from the domain
`index.ts`. Domain is under the shared 100%-coverage gate, so every branch is tested.

```ts
// Schemas (Zod) — validate S-A output on load.
export const Stratagem = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  cpCost: z.number().finite(),
  turn: z.string(),
  phase: z.string(),
  detachment: z.string(),
  detachmentId: z.string(),
  legend: z.string(),
  description: z.string(),
});
export type Stratagem = z.infer<typeof Stratagem>;

export const StratagemFile = z.object({
  source: z.string(),
  kind: z.enum(["core", "faction"]),
  wahapediaFactionId: z.string().optional(),
  stratagems: z.array(Stratagem),
});
export type StratagemFile = z.infer<typeof StratagemFile>;

export const StratagemManifest = z.object({
  version: z.number(),
  source: z.string(),
  attribution: z.string(),
  core: z.object({ file: z.string(), count: z.number() }),
  factions: z.array(z.object({
    slug: z.string(),
    wahapediaFactionId: z.string(),
    file: z.string(),
    count: z.number(),
  })),
});
export type StratagemManifest = z.infer<typeof StratagemManifest>;

// Loaders — parse-or-throw, like loadCatalogue.
export function loadStratagemFile(raw: unknown): StratagemFile;
export function loadStratagemManifest(raw: unknown): StratagemManifest;

// The file path serving a faction slug's stratagems, or undefined if the slug is
// absent from the manifest (→ caller treats it as core-only).
export function stratagemFileForSlug(manifest: StratagemManifest, slug: string): string | undefined;

// The two-tier selection. `faction` is undefined when the roster's faction has no
// stratagem file (missing/edge). `detachmentNames` are the roster's selected
// detachment display names (0..n; 10e = 0 or 1, 11e = several). Core is always
// returned; each detachment name becomes one group of the faction stratagems whose
// `detachment` matches it (normalised). An unmatched name yields an empty group.
export function selectStratagems(
  core: StratagemFile,
  faction: StratagemFile | undefined,
  detachmentNames: string[],
): { core: Stratagem[]; byDetachment: { detachment: string; stratagems: Stratagem[] }[] };
```

`normalizeDetachmentName` is a private helper (`toLowerCase`, `replace(/[^a-z0-9]+/gi,
" ")`, `trim`). `selectStratagems` returns `core.stratagems` verbatim as `core`, and one
`byDetachment` entry per input name (preserving order and the original — un-normalised —
name for display), each with `stratagems` = the faction file's stratagems whose
normalised `detachment` equals the normalised input. `faction === undefined` →
`byDetachment` entries all have empty `stratagems`.

### 2. Roster — `selectedDetachmentNames` in `packages/roster/src/builder.ts`

A thin query beside the existing `selectedDetachments` (which returns entryIds):

```ts
/** The display names of the roster's selected detachments, in selection order.
 *  Maps each selected detachment entryId to its catalogue entry name; entries not
 *  found (shouldn't happen) are dropped. Empty if none selected. */
export function selectedDetachmentNames(roster: Roster, catalogue: IrCatalogue): string[];
```

Implemented over the existing `selectedDetachments` + `catalogueEntry`. This is the sole
bridge from roster state to `selectStratagems`, keeping the domain selection free of any
roster/catalogue dependency.

## Data flow

```
S-A manifest + files ──fetch (S-C)──▶ loadStratagemManifest / loadStratagemFile   (domain, validated)
                                             │
roster + catalogue ──selectedDetachmentNames (roster)──▶ ["Gladius Task Force", …]
                                             │
                                             ▼
                      selectStratagems(core, factionFile, names)
                                             │
                                             ▼
                    { core: Stratagem[], byDetachment: [{detachment, stratagems}] }  ──▶ S-C
```

S-C resolves the active faction slug (from the catalogue registry descriptor's file
path — `<slug>.ir.json`), calls `stratagemFileForSlug` for the faction file, fetches it
and the core file, derives names via `selectedDetachmentNames`, and calls
`selectStratagems`. None of that fetch/UI wiring is built in S-B.

## Testing

- **Domain `stratagem.ts` (100% branch coverage required):**
  - `loadStratagemFile` / `loadStratagemManifest`: a valid fixture parses; an invalid one
    (missing field / wrong type) throws.
  - `stratagemFileForSlug`: present slug → its file; absent slug → undefined.
  - `selectStratagems`:
    - core is always returned (even with no faction / no detachments).
    - a detachment name matches faction stratagems case/punctuation-insensitively
      (`"Emperor's Shield"` vs data `"Emperor’s Shield"`).
    - an unmatched name → an empty `stratagems` group (not dropped).
    - multiple names → multiple groups in input order, each with its own matches.
    - `faction === undefined` → every `byDetachment` group empty, core still returned.
    - the original (un-normalised) name is preserved in the output for display.
- **Roster `selectedDetachmentNames`:** 0 selected → `[]`; 1 → its name; several (11e) →
  all names in order; an entryId with no catalogue entry is dropped.

## Risks

- **Detachment-name match quality** depends on BSData and Wahapedia naming the same
  detachment identically modulo punctuation. This holds for the canonical GW names in the
  data, but is not guaranteed for every faction/edition. The design degrades safely
  (unmatched → core-only), and match quality must be **spot-checked against a freshly
  built catalogue** during implementation: the local `apps/web/public/catalogues/` copy
  can be a thin/stale parse without detachments (a data-refresh concern, `update-catalogues`,
  not an S-B defect). No S-B logic depends on that refresh; only the acceptance spot-check does.
- **11e edition mismatch:** until Wahapedia publishes distinct 11e data, an 11e roster
  matches against 10e-derived detachment names; some 11e-only detachments will show
  core-only. Acceptable and self-correcting when S-A's source diverges.

## Non-goals recap

No fetching, no UI, no HTML sanitisation, no CP/affordability logic, no id-based join
(names only). S-B is pure, validated domain data + one roster query — the smallest
surface that lets S-C render Core + per-detachment stratagems.
