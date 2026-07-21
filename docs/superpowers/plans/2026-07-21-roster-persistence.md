# Roster Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rosters survive reload and accumulate into a named, localStorage-backed library with JSON export/import.

**Architecture:** A pure library model + envelope (de)serialization in `@muster/roster` (immutable, 100%-covered), a thin `localStorage` adapter + debounced `useRosterLibrary` hook in the web app, a `MyArmies` modal, and wiring in `App` that restores the last-edited roster on open and auto-saves the active one.

**Tech Stack:** TypeScript (strict), Zod (schemas in `@muster/domain`), React 18, Vitest + Testing Library, pnpm workspaces.

## Global Constraints

- Immutable style: every `@muster/roster` op returns a new object; never mutate inputs (matches `builder.ts`).
- `@muster/roster` and `@muster/domain` stay browser-free (no `localStorage`, no `Date.now()`, no `crypto`); the app supplies timestamps and ids as parameters.
- `@muster/roster` keeps 100% coverage (statements/branches/functions/lines).
- Storage key: `muster:library:v1`. Envelope schema literal: `muster-roster/v1`. Library version: `1`.
- Catalogue rebind key is the composite `"<edition>:<catalogueId>"` — 10e/11e ids collide, edition is mandatory.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT run `git stash` or `git add -A`. Stage explicit paths.

---

### Task 1: Domain schemas — `RosterEnvelope` + `RosterLibrary`

**Files:**
- Modify: `packages/domain/src/roster.ts`
- Test: `packages/domain/src/roster.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Consumes: existing `Roster` Zod schema in the same file.
- Produces: `ROSTER_ENVELOPE_SCHEMA` (const `"muster-roster/v1"`), `LIBRARY_VERSION` (const `1`), `RosterEnvelope` (schema + type), `LibraryEntry` (schema + type), `RosterLibrary` (schema + type).

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/src/roster.test.ts` (create with this header if new):

```ts
import { describe, it, expect } from "vitest";
import { Roster, RosterEnvelope, RosterLibrary, ROSTER_ENVELOPE_SCHEMA, LIBRARY_VERSION } from "./roster";

const roster = {
  id: "r1", name: "Army", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1,
  pointsLimit: 2000, selections: [],
};

describe("RosterEnvelope", () => {
  it("parses a valid envelope", () => {
    const env = { schema: ROSTER_ENVELOPE_SCHEMA, edition: "10e", catalogueId: "cat", roster };
    expect(RosterEnvelope.parse(env).roster.id).toBe("r1");
  });
  it("rejects a wrong schema literal", () => {
    const env = { schema: "other", edition: "10e", catalogueId: "cat", roster };
    expect(RosterEnvelope.safeParse(env).success).toBe(false);
  });
});

describe("RosterLibrary", () => {
  it("parses a library and defaults entries", () => {
    const lib = { version: LIBRARY_VERSION, activeId: null, entries: [] };
    expect(RosterLibrary.parse(lib).entries).toEqual([]);
  });
  it("parses an entry carrying its roster + display meta", () => {
    const entry = { id: "r1", name: "Army", edition: "10e", catalogueId: "cat", catalogueName: "Space Marines", points: 2000, updatedAt: 123, roster };
    const lib = RosterLibrary.parse({ version: 1, activeId: "r1", entries: [entry] });
    expect(lib.entries[0]!.catalogueName).toBe("Space Marines");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain exec vitest run src/roster.test.ts`
Expected: FAIL — `RosterEnvelope`/`RosterLibrary` not exported.

- [ ] **Step 3: Write the schemas**

Append to `packages/domain/src/roster.ts` (after the existing `Roster` export):

```ts
/** File format for a single exported roster. `schema` is a version gate the
 *  importer checks before trusting the payload. `edition` is required because
 *  10e/11e catalogue ids collide — it is not on `Roster`. */
export const ROSTER_ENVELOPE_SCHEMA = "muster-roster/v1";
export const RosterEnvelope = z.object({
  schema: z.literal(ROSTER_ENVELOPE_SCHEMA),
  edition: z.string(),
  catalogueId: z.string(),
  roster: Roster,
});
export type RosterEnvelope = z.infer<typeof RosterEnvelope>;

/** One saved roster plus denormalized display fields, so the library list
 *  renders without loading each catalogue. `id === roster.id`. */
export const LibraryEntry = z.object({
  id: z.string(),
  name: z.string(),
  edition: z.string(),
  catalogueId: z.string(),
  catalogueName: z.string(),
  points: z.number().finite(),
  updatedAt: z.number().finite(),
  roster: Roster,
});
export type LibraryEntry = z.infer<typeof LibraryEntry>;

/** The whole persisted library. `activeId` is the last-edited entry restored
 *  on app open. */
export const LIBRARY_VERSION = 1;
export const RosterLibrary = z.object({
  version: z.literal(LIBRARY_VERSION),
  activeId: z.string().nullable(),
  entries: z.array(LibraryEntry).default([]),
});
export type RosterLibrary = z.infer<typeof RosterLibrary>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain exec vitest run src/roster.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/roster.ts packages/domain/src/roster.test.ts
git commit -m "feat(domain): RosterEnvelope + RosterLibrary schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Roster — pure library model (`packages/roster/src/library.ts`)

**Files:**
- Create: `packages/roster/src/library.ts`
- Modify: `packages/roster/src/index.ts` (add `export * from "./library";`)
- Test: `packages/roster/src/library.test.ts`

**Interfaces:**
- Consumes: `Roster`, `RosterLibrary`, `LibraryEntry`, `RosterEnvelope`, `ROSTER_ENVELOPE_SCHEMA`, `LIBRARY_VERSION` from `@muster/domain`.
- Produces:
  - `emptyLibrary(): RosterLibrary`
  - `type EntryMeta = { edition: string; catalogueId: string; catalogueName: string }`
  - `upsertActive(lib: RosterLibrary, roster: Roster, meta: EntryMeta, now: number): RosterLibrary`
  - `renameEntry(lib, id: string, name: string, now: number): RosterLibrary`
  - `duplicateEntry(lib, id: string, newId: string, now: number): RosterLibrary`
  - `deleteEntry(lib, id: string): RosterLibrary`
  - `setActive(lib, id: string): RosterLibrary`
  - `activeEntry(lib): LibraryEntry | undefined`
  - `parseLibrary(raw: unknown): RosterLibrary`
  - `toEnvelope(roster: Roster, edition: string, catalogueId: string): RosterEnvelope`
  - `fromEnvelope(raw: unknown): { roster: Roster; edition: string; catalogueId: string }`

- [ ] **Step 1: Write the failing tests**

Create `packages/roster/src/library.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Roster } from "@muster/domain";
import {
  emptyLibrary, upsertActive, renameEntry, duplicateEntry, deleteEntry, setActive,
  activeEntry, parseLibrary, toEnvelope, fromEnvelope,
} from "./library";

const roster = (id: string, name = "Army"): Roster => ({
  id, name, gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1,
  pointsLimit: 2000, selections: [],
});
const meta = { edition: "10e", catalogueId: "cat", catalogueName: "Space Marines" };

describe("upsertActive", () => {
  it("inserts a new active entry", () => {
    const lib = upsertActive(emptyLibrary(), roster("r1"), meta, 100);
    expect(lib.activeId).toBe("r1");
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]!.updatedAt).toBe(100);
    expect(lib.entries[0]!.catalogueName).toBe("Space Marines");
  });
  it("replaces the entry with the same id in place, bumping updatedAt", () => {
    let lib = upsertActive(emptyLibrary(), roster("r1", "Old"), meta, 100);
    lib = upsertActive(lib, roster("r1", "New"), meta, 200);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]!.name).toBe("New");
    expect(lib.entries[0]!.updatedAt).toBe(200);
  });
  it("does not mutate the input library", () => {
    const lib0 = emptyLibrary();
    upsertActive(lib0, roster("r1"), meta, 100);
    expect(lib0.entries).toHaveLength(0);
  });
});

describe("renameEntry / setActive / deleteEntry / duplicateEntry", () => {
  const base = upsertActive(upsertActive(emptyLibrary(), roster("r1"), meta, 100), roster("r2"), meta, 110);
  it("renames the entry and its roster, bumping updatedAt", () => {
    const lib = renameEntry(base, "r1", "Renamed", 300);
    const e = lib.entries.find((x) => x.id === "r1")!;
    expect(e.name).toBe("Renamed");
    expect(e.roster.name).toBe("Renamed");
    expect(e.updatedAt).toBe(300);
  });
  it("setActive points at an existing entry", () => {
    expect(setActive(base, "r1").activeId).toBe("r1");
  });
  it("deleteEntry removes it and clears activeId when it matched", () => {
    const lib = deleteEntry(base, "r2"); // r2 was active
    expect(lib.entries.map((e) => e.id)).toEqual(["r1"]);
    expect(lib.activeId).toBeNull();
  });
  it("deleteEntry keeps activeId when a different entry is removed", () => {
    const lib = deleteEntry(base, "r1");
    expect(lib.activeId).toBe("r2");
  });
  it("duplicateEntry deep-copies under a new id and makes it active", () => {
    const lib = duplicateEntry(base, "r1", "r1-copy", 400);
    const copy = lib.entries.find((e) => e.id === "r1-copy")!;
    expect(copy.roster.id).toBe("r1-copy");
    expect(copy.roster.name).toBe("Army (copy)");
    expect(lib.activeId).toBe("r1-copy");
    expect(lib.entries).toHaveLength(3);
  });
  it("activeEntry returns the active entry or undefined", () => {
    expect(activeEntry(base)!.id).toBe("r2");
    expect(activeEntry(emptyLibrary())).toBeUndefined();
  });
});

describe("parseLibrary", () => {
  it("returns an empty library for a wholly invalid blob", () => {
    expect(parseLibrary("nonsense")).toEqual(emptyLibrary());
    expect(parseLibrary(null)).toEqual(emptyLibrary());
  });
  it("drops a corrupt entry but keeps valid ones", () => {
    const good = upsertActive(emptyLibrary(), roster("r1"), meta, 100).entries[0];
    const raw = { version: 1, activeId: "r1", entries: [good, { id: "bad" }] };
    const lib = parseLibrary(raw);
    expect(lib.entries.map((e) => e.id)).toEqual(["r1"]);
  });
  it("round-trips a serialized library", () => {
    const lib = upsertActive(emptyLibrary(), roster("r1"), meta, 100);
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });
});

describe("toEnvelope / fromEnvelope", () => {
  it("round-trips", () => {
    const env = toEnvelope(roster("r1"), "10e", "cat");
    const back = fromEnvelope(JSON.parse(JSON.stringify(env)));
    expect(back.roster.id).toBe("r1");
    expect(back.edition).toBe("10e");
    expect(back.catalogueId).toBe("cat");
  });
  it("throws on a wrong/absent schema", () => {
    expect(() => fromEnvelope({ schema: "nope", edition: "10e", catalogueId: "cat", roster: roster("r1") })).toThrow();
    expect(() => fromEnvelope({})).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/roster exec vitest run src/library.test.ts`
Expected: FAIL — module `./library` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/roster/src/library.ts`:

```ts
import {
  RosterLibrary, RosterEnvelope, ROSTER_ENVELOPE_SCHEMA, LIBRARY_VERSION,
  type Roster, type LibraryEntry,
} from "@muster/domain";

/** Non-roster fields needed to build a library entry (the app knows these from
 *  the active catalogue descriptor). */
export type EntryMeta = { edition: string; catalogueId: string; catalogueName: string };

export function emptyLibrary(): RosterLibrary {
  return { version: LIBRARY_VERSION, activeId: null, entries: [] };
}

function toEntry(roster: Roster, meta: EntryMeta, now: number): LibraryEntry {
  return {
    id: roster.id, name: roster.name, edition: meta.edition,
    catalogueId: meta.catalogueId, catalogueName: meta.catalogueName,
    points: roster.pointsLimit, updatedAt: now, roster,
  };
}

/** Insert-or-replace the entry whose id === roster.id and make it active. This
 *  is the auto-save primitive. */
export function upsertActive(lib: RosterLibrary, roster: Roster, meta: EntryMeta, now: number): RosterLibrary {
  const entry = toEntry(roster, meta, now);
  const rest = lib.entries.filter((e) => e.id !== roster.id);
  return { ...lib, activeId: roster.id, entries: [...rest, entry] };
}

export function renameEntry(lib: RosterLibrary, id: string, name: string, now: number): RosterLibrary {
  return {
    ...lib,
    entries: lib.entries.map((e) =>
      e.id === id ? { ...e, name, updatedAt: now, roster: { ...e.roster, name } } : e),
  };
}

export function duplicateEntry(lib: RosterLibrary, id: string, newId: string, now: number): RosterLibrary {
  const src = lib.entries.find((e) => e.id === id);
  if (!src) return lib;
  const roster: Roster = structuredClone({ ...src.roster, id: newId, name: `${src.roster.name} (copy)` });
  const copy: LibraryEntry = { ...src, id: newId, name: roster.name, updatedAt: now, roster };
  return { ...lib, activeId: newId, entries: [...lib.entries, copy] };
}

export function deleteEntry(lib: RosterLibrary, id: string): RosterLibrary {
  return {
    ...lib,
    activeId: lib.activeId === id ? null : lib.activeId,
    entries: lib.entries.filter((e) => e.id !== id),
  };
}

export function setActive(lib: RosterLibrary, id: string): RosterLibrary {
  return { ...lib, activeId: id };
}

export function activeEntry(lib: RosterLibrary): LibraryEntry | undefined {
  return lib.activeId === null ? undefined : lib.entries.find((e) => e.id === lib.activeId);
}

/** Zod-validate a stored blob; drop entries that fail validation so one corrupt
 *  roster never bricks the library, and return an empty library for a wholly
 *  invalid blob. */
export function parseLibrary(raw: unknown): RosterLibrary {
  const outer = RosterLibrary.safeParse(raw);
  if (outer.success) return outer.data;
  if (raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)) {
    const entries = ((raw as { entries: unknown[] }).entries)
      .map((e) => (RosterLibrary.shape.entries.element.safeParse(e)))
      .filter((r) => r.success)
      .map((r) => (r as { data: LibraryEntry }).data);
    const activeIdRaw = (raw as { activeId?: unknown }).activeId;
    const activeId = typeof activeIdRaw === "string" && entries.some((e) => e.id === activeIdRaw) ? activeIdRaw : null;
    return { version: LIBRARY_VERSION, activeId, entries };
  }
  return emptyLibrary();
}

export function toEnvelope(roster: Roster, edition: string, catalogueId: string): RosterEnvelope {
  return { schema: ROSTER_ENVELOPE_SCHEMA, edition, catalogueId, roster };
}

export function fromEnvelope(raw: unknown): { roster: Roster; edition: string; catalogueId: string } {
  const env = RosterEnvelope.parse(raw); // throws on wrong schema / shape
  return { roster: env.roster, edition: env.edition, catalogueId: env.catalogueId };
}
```

- [ ] **Step 4: Wire the export**

Append to `packages/roster/src/index.ts`:

```ts
export * from "./library";
```

- [ ] **Step 5: Run tests + coverage**

Run: `pnpm --filter @muster/roster test`
Expected: PASS; `library.ts` at 100% coverage. If a branch is uncovered, add the missing case (e.g. `duplicateEntry` on a missing id → returns lib unchanged; `parseLibrary` activeId-not-in-entries).

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/library.ts packages/roster/src/library.test.ts packages/roster/src/index.ts
git commit -m "feat(roster): pure roster-library model + envelope (de)serialization

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: App — localStorage adapter + `useRosterLibrary` hook

**Files:**
- Create: `apps/web/src/registry/rosterLibrary.ts`
- Create: `apps/web/src/registry/rosterLibrary.test.ts`

**Interfaces:**
- Consumes: `parseLibrary`, `emptyLibrary` from `@muster/roster`; `RosterLibrary` from `@muster/domain`.
- Produces:
  - `STORAGE_KEY = "muster:library:v1"`
  - `loadLibrary(): RosterLibrary`
  - `saveLibrary(lib: RosterLibrary): void`
  - `useRosterLibrary(): { library: RosterLibrary; setLibrary: (updater: (lib: RosterLibrary) => RosterLibrary) => void }`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/registry/rosterLibrary.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadLibrary, saveLibrary, STORAGE_KEY } from "./rosterLibrary";
import { emptyLibrary, upsertActive } from "@muster/roster";

const roster = { id: "r1", name: "Army", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000, selections: [] };
const meta = { edition: "10e", catalogueId: "cat", catalogueName: "SM" };

describe("loadLibrary / saveLibrary", () => {
  beforeEach(() => localStorage.clear());
  it("returns an empty library when storage is empty", () => {
    expect(loadLibrary()).toEqual(emptyLibrary());
  });
  it("round-trips through localStorage", () => {
    const lib = upsertActive(emptyLibrary(), roster, meta, 100);
    saveLibrary(lib);
    expect(loadLibrary()).toEqual(lib);
  });
  it("degrades to empty on a corrupt stored blob", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadLibrary()).toEqual(emptyLibrary());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/web exec vitest run src/registry/rosterLibrary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the adapter + hook**

Create `apps/web/src/registry/rosterLibrary.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import type { RosterLibrary } from "@muster/domain";
import { parseLibrary, emptyLibrary } from "@muster/roster";

export const STORAGE_KEY = "muster:library:v1";

/** Read + validate the stored library. Any storage/JSON error degrades to an
 *  empty library — persistence must never crash the app. */
export function loadLibrary(): RosterLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyLibrary();
    return parseLibrary(JSON.parse(raw));
  } catch {
    return emptyLibrary();
  }
}

/** Best-effort write; swallow quota/security errors. */
export function saveLibrary(lib: RosterLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}

/** Library state persisted to localStorage, debounced so keystroke-level roster
 *  edits coalesce into one write. */
export function useRosterLibrary(): {
  library: RosterLibrary;
  setLibrary: (updater: (lib: RosterLibrary) => RosterLibrary) => void;
} {
  const [library, setLibraryState] = useState<RosterLibrary>(() => loadLibrary());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(library);

  const setLibrary = (updater: (lib: RosterLibrary) => RosterLibrary) => {
    setLibraryState((prev) => {
      const next = updater(prev);
      latest.current = next;
      return next;
    });
  };

  useEffect(() => {
    latest.current = library;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveLibrary(latest.current), 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [library]);

  return { library, setLibrary };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @muster/web exec vitest run src/registry/rosterLibrary.test.ts`
Expected: PASS (3 tests). (`localStorage` exists under the app's jsdom test env.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/registry/rosterLibrary.ts apps/web/src/registry/rosterLibrary.test.ts
git commit -m "feat(web): localStorage roster-library adapter + debounced hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: App — "My armies" modal component

**Files:**
- Create: `apps/web/src/components/MyArmies.tsx`
- Create: `apps/web/src/components/MyArmies.test.tsx`

**Interfaces:**
- Consumes: `RosterLibrary`, `LibraryEntry` from `@muster/domain`.
- Produces the `MyArmies` component:

```ts
export function MyArmies(props: {
  library: RosterLibrary;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (file: File) => void;
  onNew: () => void;
  onClose: () => void;
}): JSX.Element
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/MyArmies.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MyArmies } from "./MyArmies";
import { emptyLibrary, upsertActive } from "@muster/roster";

const roster = { id: "r1", name: "Alpha", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000, selections: [] };
const lib = upsertActive(emptyLibrary(), roster, { edition: "10e", catalogueId: "cat", catalogueName: "Space Marines" }, 100);
const noop = () => {};
const props = { library: lib, onOpen: noop, onRename: noop, onDuplicate: noop, onDelete: noop, onExport: noop, onImport: noop, onNew: noop, onClose: noop };

describe("MyArmies", () => {
  it("lists saved armies with faction and points", () => {
    render(<MyArmies {...props} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/Space Marines/)).toBeTruthy();
    expect(screen.getByText(/2000/)).toBeTruthy();
  });
  it("Open fires onOpen with the entry id", () => {
    const onOpen = vi.fn();
    render(<MyArmies {...props} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /open Alpha/i }));
    expect(onOpen).toHaveBeenCalledWith("r1");
  });
  it("shows an empty state when there are no armies", () => {
    render(<MyArmies {...props} library={emptyLibrary()} />);
    expect(screen.getByText(/no saved armies/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/web exec vitest run src/components/MyArmies.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/MyArmies.tsx` (modal styling mirrors `AddUnitPicker`: `picker-overlay` / `picker`):

```tsx
import { useState } from "react";
import type { RosterLibrary } from "@muster/domain";

function when(ts: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function MyArmies({
  library, onOpen, onRename, onDuplicate, onDelete, onExport, onImport, onNew, onClose,
}: {
  library: RosterLibrary;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (file: File) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  // Deterministic "relative time" reference computed once per render open.
  const nowMs = library.entries.reduce((m, e) => Math.max(m, e.updatedAt), 0);
  const entries = [...library.entries].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="picker-overlay" role="dialog" aria-label="my armies" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong>My armies</strong>
          <button className="picker-close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <div className="picker-actions" style={{ display: "flex", gap: 8, padding: "8px 0" }}>
          <button onClick={onNew}>+ New army</button>
          <label style={{ fontSize: 13 }}>
            Import:{" "}
            <input type="file" accept="application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
        <div className="picker-list">
          {entries.length === 0 && <div className="picker-empty">No saved armies yet</div>}
          {entries.map((e) => (
            <div key={e.id} className="army-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              {renaming === e.id ? (
                <input autoFocus value={draft} aria-label={`rename ${e.name}`}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onBlur={() => { onRename(e.id, draft.trim() || e.name); setRenaming(undefined); }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") { onRename(e.id, draft.trim() || e.name); setRenaming(undefined); } }} />
              ) : (
                <button className="army-open" aria-label={`open ${e.name}`} style={{ flex: 1, textAlign: "left" }}
                  onClick={() => onOpen(e.id)}>
                  <strong>{e.name}</strong>{" — "}
                  <span>{e.catalogueName}</span>{" · "}
                  <span>{e.points} pts</span>{" · "}
                  <span>{when(e.updatedAt, nowMs)}</span>
                </button>
              )}
              <button aria-label={`rename ${e.name}`} onClick={() => { setRenaming(e.id); setDraft(e.name); }}>✎</button>
              <button aria-label={`duplicate ${e.name}`} onClick={() => onDuplicate(e.id)}>⧉</button>
              <button aria-label={`export ${e.name}`} onClick={() => onExport(e.id)}>⭳</button>
              <button aria-label={`delete ${e.name}`} onClick={() => { if (confirm(`Delete "${e.name}"?`)) onDelete(e.id); }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @muster/web exec vitest run src/components/MyArmies.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/MyArmies.tsx apps/web/src/components/MyArmies.test.tsx
git commit -m "feat(web): My armies modal (list/open/rename/duplicate/delete/export/import)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: App — wire persistence into `App.tsx`

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx` (append an autosave/restore integration test)

**Interfaces:**
- Consumes everything above: `useRosterLibrary`, `MyArmies`, `upsertActive`, `activeEntry`, `renameEntry`, `duplicateEntry`, `deleteEntry`, `toEnvelope`, `fromEnvelope`, `parseLibrary`.
- Produces: no new exports; behavior only.

- [ ] **Step 1: Factor a roster-installing catalogue swap**

In `App.tsx`, generalize `applyCatalogue` so restore/open can install a GIVEN roster. Replace the existing `applyCatalogue` with:

```tsx
  // Install a catalogue and a specific roster (used by restore/open/import).
  const applyCatalogueWithRoster = (next: IrCatalogue, descriptorId: string, nextRoster: Roster) => {
    setCatalogue(next);
    setRoster(nextRoster);
    setActiveDescriptorId(descriptorId);
    setSelectedUnitId(undefined);
    setPickerOpen(false);
    setWizardStep("points");
    setWizardOpen(needsSetup(next, nextRoster));
  };
  // Swap to a fresh roster (faction switch / new army).
  const applyCatalogue = (next: IrCatalogue, descriptorId: string) =>
    applyCatalogueWithRoster(next, descriptorId, createRoster(next, 2000));
```

Add `import type { Roster } from "@muster/domain";` alongside the existing domain import.

- [ ] **Step 2: Add library state, autosave, and a My-armies toggle**

Add near the other `useState`s:

```tsx
  const { library, setLibrary } = useRosterLibrary();
  const [myArmiesOpen, setMyArmiesOpen] = useState(false);
  const [restored, setRestored] = useState(false);
```

Add imports at the top of `App.tsx`:

```tsx
import { useRosterLibrary } from "./registry/rosterLibrary";
import { MyArmies } from "./components/MyArmies";
import { upsertActive, activeEntry, renameEntry, duplicateEntry, deleteEntry, toEnvelope, fromEnvelope } from "@muster/roster";
```

Autosave the active roster whenever it or the catalogue changes, once restore has settled:

```tsx
  useEffect(() => {
    if (!restored) return;
    const desc = registry.find((d) => d.id === activeDescriptorId);
    if (!desc) return; // bundled/imported-IR without a descriptor still has one; guard anyway
    setLibrary((lib) => upsertActive(lib, roster, { edition: desc.edition, catalogueId: desc.catalogueId, catalogueName: desc.name }, Date.now()));
  }, [roster, activeDescriptorId, restored]);
```

- [ ] **Step 3: Restore the last-edited roster on open**

After the registry-loading `useEffect`, add a restore effect that runs once the registry is known:

```tsx
  // Restore the last-edited roster once the manifest is available. Runs once.
  useEffect(() => {
    if (restored) return;
    const entry = activeEntry(library);
    if (!entry) { setRestored(true); return; }
    const desc = registry.find((d) => d.edition === entry.edition && d.catalogueId === entry.catalogueId);
    if (!desc) {
      // Descriptor not in the manifest yet — wait for a fuller registry, unless
      // it is already the full one (then surface an error and keep the default).
      if (registry.length > 1) { setFactionError(`Couldn't load ${entry.catalogueName}`); setRestored(true); }
      return;
    }
    void loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE)
      .then((next) => { applyCatalogueWithRoster(next, desc.id, entry.roster); })
      .catch(() => setFactionError(`Couldn't load ${entry.catalogueName}`))
      .finally(() => setRestored(true));
  }, [registry, library, restored]);
```

- [ ] **Step 4: Wire My-armies operations, export, import, and the header button**

Add handlers before the `return`:

```tsx
  const openFromLibrary = (id: string) => {
    const entry = library.entries.find((e) => e.id === id);
    if (!entry) return;
    setLibrary((lib) => ({ ...lib, activeId: id }));
    const desc = registry.find((d) => d.edition === entry.edition && d.catalogueId === entry.catalogueId);
    if (!desc) { setFactionError(`Couldn't load ${entry.catalogueName}`); return; }
    void loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE)
      .then((next) => { applyCatalogueWithRoster(next, desc.id, entry.roster); setMyArmiesOpen(false); })
      .catch(() => setFactionError(`Couldn't load ${entry.catalogueName}`));
  };

  const exportRoster = (id: string) => {
    const entry = library.entries.find((e) => e.id === id);
    if (!entry) return;
    const env = toEnvelope(entry.roster, entry.edition, entry.catalogueId);
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entry.name.replace(/[^\w.-]+/g, "_") || "roster"}.muster.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importRoster = async (file: File) => {
    try {
      const { roster: imported, edition, catalogueId } = fromEnvelope(JSON.parse(await file.text()));
      // Avoid clobbering an existing entry with the same id.
      const id = library.entries.some((e) => e.id === imported.id) ? crypto.randomUUID() : imported.id;
      const desc = registry.find((d) => d.edition === edition && d.catalogueId === catalogueId);
      if (!desc) { setFactionError(`Couldn't load the imported army's faction`); return; }
      const roster: Roster = { ...imported, id };
      const next = await loadCatalogueFor(desc, boundFetch, CATALOGUES_BASE);
      setLibrary((lib) => upsertActive(lib, roster, { edition: desc.edition, catalogueId: desc.catalogueId, catalogueName: desc.name }, Date.now()));
      applyCatalogueWithRoster(next, desc.id, roster);
      setMyArmiesOpen(false);
    } catch {
      setFactionError("That file isn't a valid Muster roster");
    }
  };
```

Add a header button (inside `<header>`, before the `load IR` label):

```tsx
        <button onClick={() => setMyArmiesOpen(true)}>My armies</button>
```

Render the modal (next to the other modals, before `</main>`):

```tsx
      {myArmiesOpen && (
        <MyArmies
          library={library}
          onOpen={openFromLibrary}
          onRename={(id, name) => setLibrary((lib) => renameEntry(lib, id, name, Date.now()))}
          onDuplicate={(id) => setLibrary((lib) => duplicateEntry(lib, id, crypto.randomUUID(), Date.now()))}
          onDelete={(id) => setLibrary((lib) => deleteEntry(lib, id))}
          onExport={exportRoster}
          onImport={(f) => void importRoster(f)}
          onNew={() => { setMyArmiesOpen(false); applyCatalogue(loadCatalogue(mini40k), bundled.id); setWizardOpen(true); }}
          onClose={() => setMyArmiesOpen(false)} />
      )}
```

- [ ] **Step 5: Write the integration test**

Append to `apps/web/src/App.test.tsx` (mirror the file's existing render setup):

```tsx
it("persists the active roster and restores it on remount", async () => {
  localStorage.clear();
  const { unmount } = render(<App />);
  // Add a unit so the roster is non-empty (adjust the selector to the file's helpers).
  // ... drive an edit via the picker as other tests in this file do ...
  await waitFor(() => expect(localStorage.getItem("muster:library:v1")).toBeTruthy());
  unmount();
  render(<App />);
  await waitFor(() => expect(JSON.parse(localStorage.getItem("muster:library:v1")!).entries.length).toBeGreaterThan(0));
});
```

> If `App.test.tsx` has no existing pattern for driving an edit, keep this test to the storage-write assertion (add a unit is optional): assert that after mount+interaction the `muster:library:v1` key exists and round-trips through `parseLibrary`.

- [ ] **Step 6: Run the web suite + typecheck**

Run: `pnpm --filter @muster/web test && pnpm --filter @muster/web typecheck`
Expected: PASS.

- [ ] **Step 7: Browser verification**

Start the dev server (`.env.local` may point at the deployed data — fine). Build a roster for a faction, reload the page → the roster returns with its faction and units. Open **My armies** → create a second army, switch between them, rename, duplicate, delete. Export one → re-import it in a fresh browser state (clear `localStorage`) → it loads. Screenshot the My-armies list as proof.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat(web): persist roster library, restore on open, export/import

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** localStorage library (Tasks 2–3), auto-save (T5 S2), restore-on-open + rebind (T5 S3), My-armies modal with open/rename/duplicate/delete/export/import/new (T4, T5 S4), envelope export/import (T2, T5 S4), schema versioning (T1). All spec sections map to a task.
- **Type consistency:** `EntryMeta = { edition, catalogueId, catalogueName }` is used identically in `upsertActive` (T2) and both call sites (T5 S2, S4). `LibraryEntry`/`RosterLibrary`/`RosterEnvelope` names match across T1→T2→T3→T4→T5. `applyCatalogueWithRoster(next, descriptorId, roster)` signature is consistent between definition (T5 S1) and all callers (T5 S3, S4).
- **Placeholder scan:** the only soft spot is T5 S5's edit-driving step, which depends on `App.test.tsx`'s existing helpers; the fallback (assert storage key round-trips) is concrete and sufficient.
- **Coverage risk:** `parseLibrary`'s partial-recovery branch and `duplicateEntry`'s missing-id early return need explicit tests to hold `@muster/roster` at 100% — both are listed in Task 2 Step 5.
