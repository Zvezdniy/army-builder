# Roster Persistence — Design

**Date:** 2026-07-21
**Status:** Approved (design), ready for planning

## Goal

Rosters survive a page reload and accumulate into a named library the user
picks from, plus portable JSON export/import. Today the roster lives only in
`App`'s `useState` and is lost on refresh.

## Scope

**In:** a named roster library persisted in `localStorage`; auto-save of the
active roster; a "My armies" modal to open / rename / duplicate / delete /
export each roster and to create (existing wizard) / import; restore of the
last-edited roster on app open, rebinding its catalogue.

**Out (YAGNI):** cloud sync, share-by-URL (the web app is not publicly
deployed — prod root is 404, only DATA ships to Pages), version diff/merge,
conflict resolution across tabs.

## Context (current architecture)

- `Roster` (`packages/domain/src/roster.ts`) is a flat Zod object — already
  serializable: `{ id, name, gameSystemId, catalogueId, catalogueRevision,
  pointsLimit, selections[], overrides? }`. It does NOT carry the edition.
- `CatalogueDescriptor` (`apps/web/src/registry/catalogueRegistry.ts`):
  `id` is the composite `"<edition>:<catalogueId>"`; also holds `catalogueId`,
  `edition`, `name`. This composite is what a saved roster rebinds against
  (10e/11e catalogue ids collide, so edition is required).
- `App` swaps catalogues via `applyCatalogue(next, descriptorId)`, which today
  always installs a FRESH roster (`createRoster`). Restore needs a variant that
  installs a GIVEN roster.
- `loadCatalogueFor(desc, fetch, base)` resolves a descriptor to an
  `IrCatalogue`.

## Data model

### Export envelope (the .json file)
```
RosterEnvelope = {
  schema: "muster-roster/v1",   // literal; import rejects anything else
  edition: string,              // "10e" | "11e" — needed to rebind (ids collide)
  catalogueId: string,          // mirrors roster.catalogueId, for validation
  roster: Roster,               // the existing Zod Roster
}
```

### Library (the localStorage blob)
```
LibraryEntry = {
  id: string,                   // === roster.id (stable key)
  name: string,                 // mirrors roster.name (denormalized for the list)
  edition: string,
  catalogueId: string,
  catalogueName: string,        // for display without loading the catalogue
  points: number,               // roster.pointsLimit (display)
  updatedAt: number,            // epoch ms; drives sort + "last edited"
  roster: Roster,
}
RosterLibrary = {
  version: 1,
  activeId: string | null,      // last-edited entry to restore on open
  entries: LibraryEntry[],
}
```
Stored under a single key `muster:library:v1`. localStorage (~5 MB) dwarfs
real roster sizes.

**Timestamps.** `updatedAt` is supplied by the caller (the app passes
`Date.now()`); the pure model never reads the clock, keeping it deterministic
and testable.

## Components (decomposition)

### 1. Domain — schemas (`packages/domain/src/roster.ts`, extend)
`RosterEnvelope` and `RosterLibrary` Zod schemas + the `ROSTER_SCHEMA =
"muster-roster/v1"` and `LIBRARY_VERSION = 1` constants. Pure schema, no logic.

### 2. Roster — pure library model (`packages/roster/src/library.ts`, new)
No browser APIs. Every op returns a new `RosterLibrary` (immutable, matching
the package's style). `updatedAt`/timestamps arrive as parameters.

- `emptyLibrary(): RosterLibrary`
- `parseLibrary(raw: unknown): RosterLibrary` — Zod-validate; drop entries that
  fail `Roster` validation (a corrupt entry never bricks the whole library);
  returns `emptyLibrary()` on a wholly invalid blob.
- `upsertActive(lib, roster, meta, now): RosterLibrary` — insert-or-replace the
  entry whose `id === roster.id`, set `activeId = roster.id`, `updatedAt = now`.
  This is the auto-save primitive.
- `renameEntry(lib, id, name, now)`, `duplicateEntry(lib, id, newId, now)`
  (deep-copies the roster under `newId`, becomes active), `deleteEntry(lib, id)`
  (clears `activeId` if it pointed there), `setActive(lib, id)`.
- `activeEntry(lib): LibraryEntry | undefined`.
- `toEnvelope(roster, edition, catalogueId): RosterEnvelope`.
- `fromEnvelope(raw: unknown): { roster; edition; catalogueId }` — Zod-validate
  the envelope, reject a wrong/absent `schema` with a thrown `Error` the app
  turns into a user message.
- `entryMeta(entry): LibraryEntry` shape helpers as needed.

Regenerated ids on duplicate/import use a supplied id (app passes
`crypto.randomUUID()`), so the model stays deterministic.

### 3. App — persistence adapter + hook (`apps/web/src/registry/rosterLibrary.ts` + hook)
- `loadLibrary(): RosterLibrary` — read `localStorage[muster:library:v1]`,
  `parseLibrary`; any storage error → `emptyLibrary()`.
- `saveLibrary(lib)` — write JSON; swallow quota/security errors (best-effort).
- `useRosterLibrary()` hook — holds the library in state, persists on change
  (debounced ~400 ms so keystroke-level roster edits don't thrash storage),
  exposes the library + bound operations.

### 4. App — "My armies" modal (`apps/web/src/components/MyArmies.tsx`, new)
Header button opens it. Lists entries sorted by `updatedAt` desc: name ·
faction (`catalogueName`) · `points` pts · relative "updated". Per row: Open,
Rename (inline), Duplicate, Delete (confirm), Export (download
`<name>.muster.json`). Header actions: **+ New army** (opens the existing
setup wizard for a fresh roster) and **Import** (file input). Follows the
existing modal styling (`AddUnitPicker` / `SetupWizard`).

### 5. App — wiring (`apps/web/src/App.tsx`)
- On mount: `loadLibrary()`; if it has an `activeEntry`, rebind — find the
  descriptor by `edition`+`catalogueId`, `loadCatalogueFor`, then install the
  SAVED roster (new `applyCatalogueWithRoster(next, descriptorId, roster)`
  factored out of `applyCatalogue`). If the descriptor is missing from the
  manifest → leave the entry in the library, surface a load error, fall back to
  the bundled default. Empty library → today's behavior (bundled + wizard).
  Catalogue `revision` mismatch → load anyway (data may have been republished);
  no hard failure.
- After any roster/setup change: `upsertActive(lib, roster, meta, Date.now())`
  through the hook (debounced), so the active roster is always current.
- Export: serialize via `toEnvelope`, trigger a download of
  `<sanitized name>.muster.json`.
- Import: read file → `fromEnvelope` → add to library (new id if it collides)
  → rebind + open. Invalid file → user-facing error, library untouched.
- New army from the modal: create a fresh roster for the chosen faction (reuse
  the wizard), which auto-saves as a new entry on first edit.

## Testing

- **Domain:** `RosterEnvelope`/`RosterLibrary` round-trip; reject wrong
  `schema`; reject malformed library.
- **Roster (`library.ts`), 100% cov:** each op — upsert replaces vs inserts,
  rename, duplicate (new id, active moves), delete (clears active when
  matching), setActive, `parseLibrary` drops one corrupt entry while keeping
  the rest, `fromEnvelope` rejects bad schema, `toEnvelope`↔`fromEnvelope`
  round-trip.
- **App adapter/hook:** persist→reload restores the library (jsdom
  localStorage); a corrupt stored blob degrades to empty; debounce coalesces
  rapid edits into one write.
- **App component:** `MyArmies` renders entries, Open/Delete/Export fire the
  right callbacks; import of a valid/invalid envelope.
- **Browser verify:** build a roster, reload → it returns; create a second
  army, switch between them; export → re-import in a fresh state.

## Edge cases / decisions

- **Cross-tab writes:** last-writer-wins; no `storage`-event sync in v1
  (single-tab is the norm; listed as out-of-scope).
- **Schema evolution:** `RosterLibrary.version` + `RosterEnvelope.schema` are
  present so a future migration has a hook; v1 only knows version 1 and rejects
  unknown envelope schemas.
- **Bundled/imported-IR factions:** a roster built on the bundled "Mini 40k" or
  an ad-hoc imported IR has a descriptor id but no manifest entry; it still
  saves, and restores only while that descriptor is present (bundled always is;
  imported IR is not — such an entry surfaces the missing-catalogue error, as
  designed).
- **`overrides`:** already part of `Roster`, so it serializes for free.
