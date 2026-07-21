# Stratagems S-B — Domain + Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validated domain types for the S-A stratagem data plus a pure two-tier selection (Core + per-selected-detachment) and the one roster query that feeds it.

**Architecture:** A new `packages/domain/src/stratagem.ts` holds Zod schemas (`Stratagem`, `StratagemFile`, `StratagemManifest`), parse-or-throw loaders, `stratagemFileForSlug`, and the pure `selectStratagems`. A new `selectedDetachmentNames` in `packages/roster/src/builder.ts` bridges roster state to `selectStratagems` by turning selected detachment entryIds into display names. No app change (S-C wires the UI).

**Tech Stack:** TypeScript (strict), Zod, Vitest. Both packages are under the shared 100%-branch-coverage gate.

## Global Constraints

- **100% branch coverage** in both `@muster/domain` and `@muster/roster` (shared Vitest config, `src/index.ts` excluded). Every branch must be tested or the package suite fails.
- **The S-A ↔ S-B data contract is fixed** — the schemas must match S-A's real output exactly: a `Stratagem` is `{id, name, category, cpCost:number, turn, phase, detachment, detachmentId, legend, description}` (all strings but `cpCost`); a file is `{source, kind:"core"|"faction", wahapediaFactionId?:string, stratagems:Stratagem[]}`; the manifest is `{version:number, source, attribution, core:{file,count}, factions:[{slug, wahapediaFactionId, file, count}]}`.
- **Join key is the detachment NAME**, matched via a normaliser: `s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()`. No id-based join.
- **Safe degrade:** an unmatched detachment name yields an empty group (never dropped, never an error); `faction === undefined` yields empty groups but always returns Core.
- **No new dependencies.** Zod is already a domain dependency. Roster already depends on domain.
- **Run the full package suites** (`pnpm --filter @muster/domain test` and `pnpm --filter @muster/roster test`) — a filtered file run can under-report the global coverage gate.
- **Commit messages** end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Do NOT push.

## File Structure

- Create `packages/domain/src/stratagem.ts` — schemas + loaders + `stratagemFileForSlug` + `selectStratagems` + private `normalizeDetachmentName`.
- Create `packages/domain/src/stratagem.test.ts` — full-coverage tests.
- Modify `packages/domain/src/index.ts` — `export * from "./stratagem";`.
- Modify `packages/roster/src/builder.ts` — add `selectedDetachmentNames`.
- Modify `packages/roster/src/builder.test.ts` — tests for `selectedDetachmentNames`.

---

### Task 1: Domain schemas + loaders

**Files:**
- Create: `packages/domain/src/stratagem.ts`
- Create: `packages/domain/src/stratagem.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `Stratagem` (Zod) + `type Stratagem`
  - `StratagemFile` (Zod) + `type StratagemFile`
  - `StratagemManifest` (Zod) + `type StratagemManifest`
  - `loadStratagemFile(raw: unknown): StratagemFile` — `StratagemFile.parse(raw)`
  - `loadStratagemManifest(raw: unknown): StratagemManifest` — `StratagemManifest.parse(raw)`

- [ ] **Step 1: Write the failing loader tests**

Create `packages/domain/src/stratagem.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadStratagemFile, loadStratagemManifest } from "./stratagem";

const CORE_FILE = {
  source: "Wahapedia",
  kind: "core",
  stratagems: [
    { id: "c1", name: "GRENADE", category: "Wargear", cpCost: 1, turn: "Your turn",
      phase: "Shooting phase", detachment: "", detachmentId: "", legend: "", description: "<b>WHEN:</b> …" },
  ],
};

const FACTION_FILE = {
  source: "Wahapedia",
  kind: "faction",
  wahapediaFactionId: "SM",
  stratagems: [
    { id: "s1", name: "ARMOUR OF CONTEMPT", category: "Battle Tactic", cpCost: 1, turn: "Either Player's turn",
      phase: "Shooting or Fight phase", detachment: "Gladius Task Force", detachmentId: "d1", legend: "", description: "<b>WHEN:</b> …" },
  ],
};

const MANIFEST = {
  version: 1, source: "Wahapedia", attribution: "Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop.",
  core: { file: "stratagems/_core.json", count: 11 },
  factions: [
    { slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 },
    { slug: "blood-angels", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 },
  ],
};

describe("loadStratagemFile", () => {
  it("parses a valid core file", () => {
    expect(loadStratagemFile(CORE_FILE).stratagems[0]?.name).toBe("GRENADE");
  });
  it("parses a valid faction file with wahapediaFactionId", () => {
    expect(loadStratagemFile(FACTION_FILE).wahapediaFactionId).toBe("SM");
  });
  it("throws on a malformed stratagem (cpCost not a number)", () => {
    const bad = { ...CORE_FILE, stratagems: [{ ...CORE_FILE.stratagems[0], cpCost: "free" }] };
    expect(() => loadStratagemFile(bad)).toThrow();
  });
  it("throws on an unknown kind", () => {
    expect(() => loadStratagemFile({ ...CORE_FILE, kind: "mystery" })).toThrow();
  });
});

describe("loadStratagemManifest", () => {
  it("parses a valid manifest", () => {
    const m = loadStratagemManifest(MANIFEST);
    expect(m.core.count).toBe(11);
    expect(m.factions).toHaveLength(2);
  });
  it("throws on a manifest missing core", () => {
    const { core, ...noCore } = MANIFEST;
    expect(() => loadStratagemManifest(noCore)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/domain test -- stratagem`
Expected: FAIL — cannot import from `./stratagem` (module does not exist).

- [ ] **Step 3: Implement the schemas + loaders**

Create `packages/domain/src/stratagem.ts`:

```ts
import { z } from "zod";

// One stratagem, matching the S-A pipeline's output shape exactly.
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

// A per-faction or the core stratagem file.
export const StratagemFile = z.object({
  source: z.string(),
  kind: z.enum(["core", "faction"]),
  wahapediaFactionId: z.string().optional(),
  stratagems: z.array(Stratagem),
});
export type StratagemFile = z.infer<typeof StratagemFile>;

// The manifest listing the core file + one entry per catalogue slug.
export const StratagemManifest = z.object({
  version: z.number().finite(),
  source: z.string(),
  attribution: z.string(),
  core: z.object({ file: z.string(), count: z.number().finite() }),
  factions: z.array(z.object({
    slug: z.string(),
    wahapediaFactionId: z.string(),
    file: z.string(),
    count: z.number().finite(),
  })),
});
export type StratagemManifest = z.infer<typeof StratagemManifest>;

/** Parse-or-throw a stratagem file (core or faction), like `loadCatalogue`. */
export function loadStratagemFile(raw: unknown): StratagemFile {
  return StratagemFile.parse(raw);
}

/** Parse-or-throw the stratagem manifest. */
export function loadStratagemManifest(raw: unknown): StratagemManifest {
  return StratagemManifest.parse(raw);
}
```

- [ ] **Step 4: Wire the export**

In `packages/domain/src/index.ts`, add (keeping the list alphabetical among siblings — place after `./roster`):

```ts
export * from "./stratagem";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @muster/domain test -- stratagem`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/stratagem.ts packages/domain/src/stratagem.test.ts packages/domain/src/index.ts
git commit -m "$(printf 'feat(domain): S-B stratagem schemas + loaders\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: `stratagemFileForSlug` + `selectStratagems`

**Files:**
- Modify: `packages/domain/src/stratagem.ts`
- Modify: `packages/domain/src/stratagem.test.ts`

**Interfaces:**
- Consumes: `Stratagem`, `StratagemFile`, `StratagemManifest` (Task 1).
- Produces:
  - `stratagemFileForSlug(manifest: StratagemManifest, slug: string): string | undefined` — the `file` of the matching `factions[]` entry, or `undefined`.
  - `selectStratagems(core: StratagemFile, faction: StratagemFile | undefined, detachmentNames: string[]): { core: Stratagem[]; byDetachment: { detachment: string; stratagems: Stratagem[] }[] }` — Core always returned; one group per input name (original name preserved), each holding the faction stratagems whose `detachment` matches (normalised); empty group on no match or `faction === undefined`.

- [ ] **Step 1: Write the failing selection tests**

Append to `packages/domain/src/stratagem.test.ts`:

```ts
import { stratagemFileForSlug, selectStratagems } from "./stratagem";
import type { StratagemFile } from "./stratagem";

const core: StratagemFile = {
  source: "Wahapedia", kind: "core",
  stratagems: [
    { id: "c1", name: "GRENADE", category: "Wargear", cpCost: 1, turn: "Your turn", phase: "Shooting phase", detachment: "", detachmentId: "", legend: "", description: "d" },
  ],
};
const strat = (name: string, detachment: string): StratagemFile["stratagems"][number] =>
  ({ id: name, name, category: "Battle Tactic", cpCost: 1, turn: "t", phase: "p", detachment, detachmentId: "x", legend: "", description: "d" });
const faction: StratagemFile = {
  source: "Wahapedia", kind: "faction", wahapediaFactionId: "SM",
  stratagems: [
    strat("A", "Gladius Task Force"),
    strat("B", "Gladius Task Force"),
    strat("C", "Emperor’s Shield"), // curly apostrophe in data
    strat("D", "Anvil Siege Force"),
  ],
};

describe("stratagemFileForSlug", () => {
  const manifest = {
    version: 1, source: "Wahapedia", attribution: "a",
    core: { file: "stratagems/_core.json", count: 11 },
    factions: [{ slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 }],
  };
  it("returns the file for a present slug", () => {
    expect(stratagemFileForSlug(manifest, "space-marines")).toBe("stratagems/space-marines.json");
  });
  it("returns undefined for an absent slug", () => {
    expect(stratagemFileForSlug(manifest, "tyranids")).toBeUndefined();
  });
});

describe("selectStratagems", () => {
  it("always returns core, even with no faction and no detachments", () => {
    const r = selectStratagems(core, undefined, []);
    expect(r.core.map((s) => s.name)).toEqual(["GRENADE"]);
    expect(r.byDetachment).toEqual([]);
  });
  it("groups a detachment's stratagems, matching case/punctuation-insensitively", () => {
    const r = selectStratagems(core, faction, ["Gladius Task Force", "Emperor's Shield"]);
    expect(r.byDetachment).toHaveLength(2);
    expect(r.byDetachment[0]).toEqual({ detachment: "Gladius Task Force", stratagems: [faction.stratagems[0], faction.stratagems[1]] });
    // straight apostrophe input matches curly-apostrophe data:
    expect(r.byDetachment[1]?.detachment).toBe("Emperor's Shield");
    expect(r.byDetachment[1]?.stratagems.map((s) => s.name)).toEqual(["C"]);
  });
  it("yields an empty group for an unmatched name (not dropped)", () => {
    const r = selectStratagems(core, faction, ["No Such Detachment"]);
    expect(r.byDetachment).toEqual([{ detachment: "No Such Detachment", stratagems: [] }]);
  });
  it("yields empty groups when faction is undefined, still returns core", () => {
    const r = selectStratagems(core, undefined, ["Gladius Task Force"]);
    expect(r.core).toHaveLength(1);
    expect(r.byDetachment).toEqual([{ detachment: "Gladius Task Force", stratagems: [] }]);
  });
  it("preserves input order across multiple detachments", () => {
    const r = selectStratagems(core, faction, ["Anvil Siege Force", "Gladius Task Force"]);
    expect(r.byDetachment.map((g) => g.detachment)).toEqual(["Anvil Siege Force", "Gladius Task Force"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/domain test -- stratagem`
Expected: FAIL — `stratagemFileForSlug` / `selectStratagems` not exported.

- [ ] **Step 3: Implement selection**

Append to `packages/domain/src/stratagem.ts`:

```ts
/** The stratagem file serving a faction slug, or undefined if the slug is absent
 *  from the manifest (caller then treats the faction as core-only). */
export function stratagemFileForSlug(manifest: StratagemManifest, slug: string): string | undefined {
  return manifest.factions.find((f) => f.slug === slug)?.file;
}

// Detachment names differ only in case/punctuation across BSData and Wahapedia; match
// on a normalised form (lowercase, non-alphanumerics collapsed to single spaces).
function normalizeDetachmentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The stratagems relevant to a roster: Core (always) plus one group per selected
 * detachment. Each group holds the faction file's stratagems whose `detachment`
 * matches the (normalised) detachment name; an unmatched name — or an undefined
 * faction file — yields an empty group, never an error. The original detachment
 * name is preserved in the output for display, and input order is kept.
 */
export function selectStratagems(
  core: StratagemFile,
  faction: StratagemFile | undefined,
  detachmentNames: string[],
): { core: Stratagem[]; byDetachment: { detachment: string; stratagems: Stratagem[] }[] } {
  const byDetachment = detachmentNames.map((detachment) => {
    const key = normalizeDetachmentName(detachment);
    const stratagems = faction
      ? faction.stratagems.filter((s) => normalizeDetachmentName(s.detachment) === key)
      : [];
    return { detachment, stratagems };
  });
  return { core: core.stratagems, byDetachment };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @muster/domain test -- stratagem`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Run the FULL domain suite for the coverage gate**

Run: `pnpm --filter @muster/domain test`
Expected: PASS at 100% coverage (the new file fully covered).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/stratagem.ts packages/domain/src/stratagem.test.ts
git commit -m "$(printf 'feat(domain): S-B stratagemFileForSlug + selectStratagems\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: `selectedDetachmentNames` roster query

**Files:**
- Modify: `packages/roster/src/builder.ts`
- Modify: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Consumes: existing `selectedDetachments(roster, catalogue): string[]` and `catalogueEntry(catalogue, entryId): IrEntry | undefined` (both already in `builder.ts`).
- Produces: `selectedDetachmentNames(roster: Roster, catalogue: IrCatalogue): string[]` — the display names of the selected detachments, in selection order; an entryId with no catalogue entry is dropped.

- [ ] **Step 1: Write the failing test**

First inspect the existing `builder.test.ts` to reuse its catalogue fixture and detachment-selection setup (search for `toggleDetachment` and `selectedDetachments` usages — a fixture with a detachment root already exists there). Then append a test that selects a detachment and asserts its name is returned.

Append to `packages/roster/src/builder.test.ts` (adapt the fixture/import names to those already used in the file — the detachment-root fixture and `createRoster`/`toggleDetachment` helpers are already imported there):

```ts
describe("selectedDetachmentNames", () => {
  it("returns [] when no detachment is selected", () => {
    const roster = createRoster(detachmentCatalogue, 2000);
    expect(selectedDetachmentNames(roster, detachmentCatalogue)).toEqual([]);
  });
  it("returns the selected detachment's display name", () => {
    let roster = createRoster(detachmentCatalogue, 2000);
    roster = toggleDetachment(roster, FIRST_DETACHMENT_ID, detachmentCatalogue);
    expect(selectedDetachmentNames(roster, detachmentCatalogue)).toEqual([FIRST_DETACHMENT_NAME]);
  });
});
```

> Implementer note: `detachmentCatalogue`, `FIRST_DETACHMENT_ID`, and `FIRST_DETACHMENT_NAME` are placeholders for whatever the existing test file already defines for detachment tests — reuse the real fixture and its known detachment entry id/name. If the file has no detachment fixture, build a minimal catalogue with one top-level `type:"upgrade"` entry named `"Detachment"` whose children are two named detachment entries, mirroring `detachmentRoot`'s expectations. Import `selectedDetachmentNames` alongside the other builder imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @muster/roster test -- builder`
Expected: FAIL — `selectedDetachmentNames` not exported.

- [ ] **Step 3: Implement `selectedDetachmentNames`**

In `packages/roster/src/builder.ts`, add immediately after `selectedDetachment` (around line 128):

```ts
/** The display names of the roster's selected detachments, in selection order.
 *  Maps each selected detachment entryId to its catalogue entry name; an id with
 *  no catalogue entry is dropped. Empty if none selected. This is the bridge from
 *  roster state to the domain `selectStratagems` (which joins on detachment name). */
export function selectedDetachmentNames(roster: Roster, catalogue: IrCatalogue): string[] {
  return selectedDetachments(roster, catalogue)
    .map((id) => catalogueEntry(catalogue, id)?.name)
    .filter((name): name is string => name !== undefined);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @muster/roster test -- builder`
Expected: PASS.

- [ ] **Step 5: Run the FULL roster suite for the coverage gate**

Run: `pnpm --filter @muster/roster test`
Expected: PASS at 100% coverage.

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "$(printf 'feat(roster): S-B selectedDetachmentNames query\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- `Stratagem`/`StratagemFile`/`StratagemManifest` schemas + `load*` → Task 1. ✓
- `stratagemFileForSlug` → Task 2. ✓
- `selectStratagems` (Core always, per-detachment groups, normalised match, safe degrade, order preserved) → Task 2. ✓
- `selectedDetachmentNames` roster bridge → Task 3. ✓
- Non-goals (no fetch/UI/HTML/CP logic/id-join) → nothing in the plan builds them. ✓

**Placeholder scan:** the only intentional placeholders are the Task 3 fixture identifiers (`detachmentCatalogue`, `FIRST_DETACHMENT_ID`, `FIRST_DETACHMENT_NAME`), flagged explicitly with an implementer note to bind them to the real existing fixture — because the exact fixture names live in `builder.test.ts`, which the implementer reads. All production code steps show complete code.

**Type/name consistency:** `Stratagem` field names (`id, name, category, cpCost, turn, phase, detachment, detachmentId, legend, description`) are identical across the schema (Task 1) and the `selectStratagems` fixtures/return (Task 2). `StratagemFile` `kind` enum (`"core"|"faction"`) and optional `wahapediaFactionId` match between schema and loaders. `selectStratagems`' return shape `{core, byDetachment:[{detachment, stratagems}]}` is identical in the interface block, the code, and the tests. `selectedDetachmentNames` reuses the real exported `selectedDetachments`/`catalogueEntry` signatures.

## Post-implementation acceptance (controller-run, not a task)

After Task 3, with a freshly built catalogue available (a background `update-catalogues` refresh), the controller spot-checks real name matching: for Space Marines, load the real `space-marines.json`, take the roster's `selectedDetachmentNames` for a chosen detachment, and confirm `selectStratagems` returns a non-empty group (i.e. BSData ↔ Wahapedia names actually match on real data). This validates the join-key risk from the spec; it is a verification step, not part of the coverage-gated code.
