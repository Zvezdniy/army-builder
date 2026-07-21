# Stratagems — S-C: UI Panel — Design

**Date:** 2026-07-21
**Status:** Design (sub-project S-C of the Stratagems project; S-A pipeline + S-B domain/selection SHIPPED)

## Where this sits

The final sub-project. S-A writes the Wahapedia stratagem data (`stratagems.json`
manifest + `_core.json` + per-faction files under `apps/web/public/`). S-B added the
validated domain types, `selectStratagems` (Core + per-detachment), and the roster
query `selectedDetachmentNames`. **S-C** wires the app: fetch the data for the active
faction, run S-B's selection, and render a collapsible **Stratagem panel** in the
builder — grouped Core / per-detachment, with each stratagem's full effect text and a
"powered by Wahapedia" attribution. This is app-only: no domain/roster/parser change.

## Problem

Everything needed to answer "what stratagems does this army have?" now exists (S-A data
+ S-B selection), but nothing surfaces it. The builder shows units, detachment rules,
and legality, but not stratagems. S-C adds the read-only reference panel, mirroring the
existing `DetachmentPanel` in placement, collapsibility, and styling.

Two things are genuinely new to the app and drive the design:
1. **Fetching a second data library** (stratagems) alongside the catalogue library.
2. **Rendering third-party HTML** (Wahapedia effect text) — the app has never rendered
   HTML before; it must be done safely.

## Scope (S-C)

**In scope:**
- Fetch the stratagem manifest once, and the active faction's stratagem file + the core
  file when the faction changes — degrading to "no panel" on any failure (never throws),
  exactly like the catalogue registry.
- Resolve the active faction **slug** from the catalogue registry descriptor.
- A safe HTML renderer for the effect text (allowlist, no `dangerouslySetInnerHTML`).
- `StratagemPanel`: collapsible, Core section + one section per selected detachment, each
  stratagem showing name, CP cost, category, phase/turn, and rendered effect text;
  attribution line.
- Wire it into `App.tsx` beside `DetachmentPanel`.

**Explicitly deferred (out of S-C):**
- CP-affordability / "can I use this now" logic (a game-state concern; the panel lists
  what the army *has access to*).
- Search, filtering, favouriting, or per-stratagem interaction (read-only v1).
- Any domain/roster change (S-B already exposes everything needed).
- Styling `<span class="kwb">` keyword highlights specially — rendered as plain text in v1
  (see HTML rendering).

## Data grounding (real S-A output)

- Manifest at `apps/web/public/stratagems.json`: `{version, source, attribution,
  core:{file,count}, factions:[{slug, wahapediaFactionId, file, count}]}`.
- `_core.json`: 11 universal stratagems. `space-marines.json`: 255 across 44 detachments.
- Effect-text HTML tag census across all 24 files: `<br>` (6139), `<b>` (4511),
  `<span class="kwb">` (1682, keyword bold e.g. `ADEPTUS ASTARTES`), `<div>` (21),
  `<i>` (8), `<li>` (7), `<ul>` (3). A representative description:
  `<b>WHEN:</b> …<br><br><b>TARGET:</b> One <span class="kwb">ADEPTUS</span> … <br><br><b>EFFECT:</b> …`.
- `legend` (flavour) carries no HTML.

## Architecture

Three new app modules + one `App.tsx` wiring change.

### 1. Safe HTML renderer — `apps/web/src/components/stratagemHtml.tsx`

The app has no HTML-rendering precedent and adds **no** dependency. `renderStratagemHtml(html:
string): ReactNode` parses with the browser's own `DOMParser`
(`parseFromString(html, "text/html")`) and walks the resulting node tree, **emitting only
an allowlist** of React elements — never `dangerouslySetInnerHTML`, never any attribute,
so no script/handler/href can survive:

| Source node | Emitted |
|-------------|---------|
| text node | its string |
| `<b>` / `<strong>` | `<strong>{children}</strong>` |
| `<i>` / `<em>` | `<em>{children}</em>` |
| `<br>` | `<br/>` |
| `<ul>` / `<li>` | `<ul>` / `<li>` with children |
| `<span>` / `<div>` / any other allowed-through wrapper | children only (transparent) |
| `<script>` / `<style>` | dropped entirely (not recursed) |
| unknown element | children only (never the raw tag) |

Because it reads the parsed DOM and re-emits known React elements (attribute-free), the
output is safe by construction; `jsdom` provides `DOMParser`, so it is unit-testable.
`<span class="kwb">` renders as plain text in v1 (transparent) — a later polish could map
`.kwb` to a styled span, out of scope now.

### 2. Stratagem data loading — `apps/web/src/registry/stratagemRegistry.ts`

Mirrors `catalogueRegistry`'s **degrade-never-throw** contract. Uses the domain loaders
(`loadStratagemManifest`, `loadStratagemFile`, `stratagemFileForSlug`) and the same
`CATALOGUES_BASE` the catalogue library uses (stratagems are served from the same host).

```ts
// The active faction slug for a descriptor, from its manifest file path
// ("catalogues/10e/space-marines.ir.json" → "space-marines"); undefined for the
// bundled fixture or an imported IR (no slug → no stratagems).
export function slugForDescriptor(descriptor: CatalogueDescriptor): string | undefined;

// Fetch + validate the manifest; undefined on any failure (missing/bad/unreachable).
export async function loadStratagemLibrary(
  fetchFn: typeof fetch | undefined, base: string,
): Promise<StratagemManifest | undefined>;

// Fetch the core file + the faction's file (if the slug resolves), validated.
// Returns { core, faction? }; undefined if the core file can't load; faction omitted
// (core-only) if the slug is absent or its file fails. Never throws.
export async function loadStratagemsFor(
  fetchFn: typeof fetch | undefined, base: string,
  manifest: StratagemManifest, slug: string | undefined,
): Promise<{ core: StratagemFile; faction?: StratagemFile } | undefined>;
```

`slugForDescriptor` reads `descriptor.source.file` (basename minus `.ir.json`) for a
`manifest` source; a `bundled` source → undefined. This is the whole slug-resolution
mechanism S-B deferred to S-C.

### 3. `StratagemPanel` — `apps/web/src/components/StratagemPanel.tsx`

Collapsible, styled and placed like `DetachmentPanel`. Props:

```ts
{ data: { core: StratagemFile; faction?: StratagemFile } | undefined,
  roster: Roster, catalogue: IrCatalogue, attribution: string | undefined }
```

- Renders **nothing** when `data` is undefined (bundled/imported faction, or the library
  failed to load).
- Head: a caret + `Stratagems` title + a summary (e.g. `Core + <n> detachment`).
- Body, built with S-B:
  ```ts
  const names = selectedDetachmentNames(roster, catalogue);
  const { core, byDetachment } = selectStratagems(data.core, data.faction, names);
  ```
  - **Core** section (always): the 11 core stratagems.
  - One section **per selected detachment** (`byDetachment`, in order): its heading is the
    detachment name; its stratagems below; an empty group shows a muted
    "No detachment-specific stratagems found" hint (the safe-degrade case — e.g. an 11e or
    cross-faction detachment not in the 10e-derived data).
  - Each stratagem renders via a `StratagemCard` sub-component: name, a `NCP` cost chip,
    a meta line (category · phase · turn), and the effect text via `renderStratagemHtml`.
  - A footer attribution line: the manifest `attribution` string (falls back to a constant
    "Data from Wahapedia (wahapedia.ru)." if `attribution` is undefined).

### 4. `App.tsx` wiring

Mirrors the catalogue-registry load pattern already in `App.tsx`:

- State: `stratagemManifest: StratagemManifest | undefined` and
  `stratagemData: { core, faction? } | undefined`.
- On mount (one effect, like the registry effect): `loadStratagemLibrary(boundFetch,
  CATALOGUES_BASE)` → `setStratagemManifest`.
- When the active faction changes: derive `slugForDescriptor(activeDescriptor)`, call
  `loadStratagemsFor(boundFetch, CATALOGUES_BASE, manifest, slug)` → `setStratagemData`.
  (Runs in `applyCatalogue` / an effect keyed on `activeDescriptorId` + manifest presence;
  a bundled/imported descriptor yields slug undefined → core-only or a hidden panel.)
- Render `<StratagemPanel data={stratagemData} roster={roster} catalogue={catalogue}
  attribution={stratagemManifest?.attribution} />` immediately after `<DetachmentPanel>`.

## Data flow

```
mount ─▶ loadStratagemLibrary(CATALOGUES_BASE) ─▶ stratagemManifest
faction change ─▶ slugForDescriptor(descriptor) ─▶ loadStratagemsFor(manifest, slug) ─▶ stratagemData {core, faction?}
                                                                                            │
roster + catalogue ─▶ selectedDetachmentNames ─▶ names ────────────────────────────────────┤
                                                                                            ▼
                                              selectStratagems(core, faction, names) ─▶ {core, byDetachment}
                                                                                            │
                                                                                            ▼
                          StratagemPanel: Core section + per-detachment sections, each StratagemCard
                                          (name · CP · meta · renderStratagemHtml(description)) + attribution
```

## Testing

Web tests run under `jsdom` (no coverage gate — component tests, not 100%):

- **`renderStratagemHtml`:** `<b>` → bold text present; `<br>` → a line break; a
  `<span class="kwb">KW</span>` → the text `KW` with no attributes; `<ul><li>` → a list;
  a `<script>alert(1)</script>` → dropped (no script text, no execution); attributes
  (`onclick`, `style`, `class`) never appear in the output; plain text passes through.
- **`stratagemRegistry`:** `slugForDescriptor` — manifest descriptor → its slug; bundled →
  undefined. `loadStratagemLibrary` — ok manifest parses; non-ok / bad-JSON / no-fetch →
  undefined. `loadStratagemsFor` — faction slug present → `{core, faction}`; slug absent →
  `{core}` (core-only); core file non-ok → undefined. (Fetch is stubbed.)
- **`StratagemPanel`:** undefined data → renders nothing; with core data → Core section and
  its stratagem names; with a selected detachment whose name matches → that detachment's
  section with its stratagems; with a selected detachment that doesn't match → the muted
  empty hint; the head toggles the body open/closed; the attribution line shows; a
  stratagem's bold `WHEN:` label renders (renderer integrated).

## Non-goals recap

Read-only reference panel. No CP/affordability, no search/filter, no per-stratagem
interaction, no new dependency, no domain/roster change, no special keyword styling. The
smallest UI that shows a player their Core + per-detachment stratagems with full text.
