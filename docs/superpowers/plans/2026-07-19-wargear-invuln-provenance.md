# Wargear/Enhancement Invuln via Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface invulnerable saves granted by equipped wargear/enhancements without the faction-rule false positives, by resolving the invuln in `@muster/roster` where selection provenance still exists.

**Architecture:** New provenance-aware `invulnSave(catalogue, selection)` in `@muster/roster/builder.ts` walks the selection subtree, tags each profile as `unit`- or `wargear`-sourced (same `isBody`/`depth` test as `unitLoadout`), and text-scans for an invuln ONLY on wargear-sourced abilities. The web layer drops its own `findInvuln` and calls `invulnSave`.

**Tech Stack:** TypeScript (strict), Vitest, React (Vite). Pure functions; `@muster/roster` has 100%-ish coverage discipline.

## Global Constraints

- `@muster/roster` is pure and immutable — no mutation of inputs; `invulnSave` returns a fresh value or `undefined`.
- Return shape MUST stay `{ value: string; sourceName: string; bare: boolean }` — the web chip and the "drop redundant Abilities line" logic consume exactly these fields.
- Provenance test is IDENTICAL to `unitLoadout`'s: wargear = a selection at `depth > 0` whose entry carries no `typeName === "Unit"` profile.
- Class 3 (text-scan) applies ONLY to `typeName === "Abilities"` profiles from wargear sources. Classes 1 & 2 are trusted from any source.
- Best (lowest numeric `N+`) wins; invuln saves do not stack.
- No push to origin. Merge to LOCAL main only.

---

### Task 1: `invulnSave` in `@muster/roster`

**Files:**
- Modify: `packages/roster/src/builder.ts` (add `extractSavePlus`, `InvulnSave`, `invulnSave`)
- Test: `packages/roster/src/builder.test.ts` (add invuln describe block)

**Interfaces:**
- Consumes: `catalogueEntry(catalogue, entryId)`, `IrCatalogue`, `RosterSelection`, `IrProfile` (already imported/defined in builder.ts).
- Produces: `export interface InvulnSave { value: string; sourceName: string; bare: boolean }` and `export function invulnSave(catalogue: IrCatalogue, selection: RosterSelection): InvulnSave | undefined`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/roster/src/builder.test.ts`. Use the existing test helpers/imports in that file for building catalogues and selections; if none fit, build minimal `IrCatalogue`/`RosterSelection` literals inline as the other tests do. Add `invulnSave` to the `@muster/roster` (or `./builder`) import.

```ts
describe("invulnSave", () => {
  // Minimal catalogue builders local to this block.
  const prof = (typeName: string, name: string, chars: Record<string, string> = {}) => ({
    name, typeName,
    characteristics: Object.entries(chars).map(([n, value]) => ({ name: n, value })),
  });
  const unitProf = prof("Unit", "Body", { M: "6\"", T: "4", Sv: "3+" });

  // Build a one-catalogue world with a root unit entry + optional wargear children.
  function world(rootProfiles: any[], children: { profiles: any[] }[] = []) {
    const kidEntries = children.map((c, i) => ({
      id: `w${i}`, name: `w${i}`, costs: [], categories: [], constraints: [], children: [],
      profiles: c.profiles,
    }));
    const root = {
      id: "root", name: "Unit", costs: [], categories: [], constraints: [],
      children: kidEntries, profiles: rootProfiles,
    };
    const catalogue: any = {
      id: "c", name: "c", gameSystemId: "g", revision: 1, entries: [root],
    };
    const selection: any = {
      id: "s", entryId: "root", count: 1,
      selections: kidEntries.map((k) => ({ id: `sel-${k.id}`, entryId: k.id, count: 1, selections: [] })),
    };
    return { catalogue, selection };
  }

  it("class 1: dedicated Invulnerable Save section resolves, bare", () => {
    const { catalogue, selection } = world([unitProf, prof("Invulnerable Save", "Invulnerable Save", { "": "4+" })]);
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Invulnerable Save", bare: true });
  });

  it("class 2: ability named Invulnerable Save on the root is trusted (Logan shape)", () => {
    const { catalogue, selection } = world([
      unitProf,
      prof("Abilities", "Invulnerable Save", { Description: "4+" }),
    ]);
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Invulnerable Save", bare: true });
  });

  it("class 3: storm-shield wargear grants an invuln, not bare", () => {
    const { catalogue, selection } = world(
      [unitProf],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Storm Shield", bare: false });
  });

  it("false positive: invuln-phrased faction rule on the ROOT (Veil-of-Ancients shape) is NOT surfaced", () => {
    const { catalogue, selection } = world([
      unitProf,
      prof("Abilities", "Veil of Ancients", { Description: "The bearer has a 4+ invulnerable save." }),
    ]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  it("best-of: a 4+ storm shield beats a 5+ named ability", () => {
    const { catalogue, selection } = world(
      [unitProf, prof("Abilities", "Invulnerable Save", { Description: "5+" })],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)?.value).toBe("4+");
  });

  it("no invuln → undefined", () => {
    const { catalogue, selection } = world([unitProf, prof("Abilities", "Oath of Moment", { Description: "Re-roll hits." })]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/roster test -- builder.test`
Expected: FAIL — `invulnSave is not a function` (or import error).

- [ ] **Step 3: Implement**

In `packages/roster/src/builder.ts`, add near the other datasheet helpers (after `profileKey`). `catalogueEntry`, `IrCatalogue`, `RosterSelection` are already in scope.

```ts
/** First "N+" save token in a string, or undefined. Handles a bare "4+", a sentence
 *  ("The bearer has a 5+ invulnerable save"), and a footnoted "4+\n* …". */
function extractSavePlus(text: string): string | undefined {
  const m = text.match(/(\d+)\+/);
  return m ? `${m[1]}+` : undefined;
}

/** A resolved invulnerable save for the statline chip: its value ("4+"), the granting
 *  profile's name, and whether the source text is a BARE save (just the value) — a bare
 *  one is redundant with the chip and dropped from the Abilities list by the web. */
export interface InvulnSave {
  value: string;
  sourceName: string;
  bare: boolean;
}

interface InvulnCandidate extends InvulnSave {
  rank: number;  // numeric save (4 for "4+"); lower is better (invulns don't stack)
  named: boolean; // class 1/2 (trusted by name) beats class 3 (text-scanned) on a tie
}

/**
 * Resolve a unit's invulnerable save from its selected subtree, PROVENANCE-AWARE.
 * Three candidate classes, best (lowest) wins:
 *  1. any source — a `typeName === "Invulnerable Save"` profile (legacy/synthetic);
 *  2. any source — an `Abilities` profile named /^invulnerable save/i (the infoLink/native
 *     form, e.g. Logan Grimnar — trusted by NAME regardless of provenance);
 *  3. WARGEAR source ONLY (a selection at depth>0 whose entry is not a model body — an
 *     equipped item or enhancement) — an `Abilities` profile whose Description mentions an
 *     invulnerable save with an `N+`.
 * Class 3 is provenance-gated so faction/army rules collated onto the unit's OWN entry
 * (e.g. "Veil of Ancients"), which share the phrasing, never leak in. `undefined` when no
 * candidate parses to a save value (a broken chip never shows).
 */
export function invulnSave(
  catalogue: IrCatalogue,
  selection: RosterSelection,
): InvulnSave | undefined {
  const candidates: InvulnCandidate[] = [];
  const consider = (value: string | undefined, sourceName: string, bare: boolean, named: boolean): void => {
    if (!value) return;
    const rank = parseInt(value, 10);
    if (Number.isNaN(rank)) return;
    candidates.push({ value, sourceName, bare, rank, named });
  };

  const visit = (sel: RosterSelection, depth: number): void => {
    const entry = catalogueEntry(catalogue, sel.entryId)!;
    const profiles = entry.profiles ?? [];
    const isBody = profiles.some((p) => p.typeName === "Unit");
    const isWargear = depth > 0 && !isBody;
    for (const p of profiles) {
      // Class 1: dedicated section — value is its single characteristic.
      if (p.typeName === "Invulnerable Save") {
        const raw = p.characteristics[0]?.value ?? "";
        consider(extractSavePlus(raw) ?? (raw.trim() || undefined), p.name, true, true);
        continue;
      }
      if (p.typeName !== "Abilities") continue;
      const desc = p.characteristics.find((c) => c.name === "Description")?.value ?? "";
      // Class 2: ability literally named "Invulnerable Save" — trusted by name.
      if (/^invulnerable save/i.test(p.name)) {
        const v = extractSavePlus(desc);
        consider(v, p.name, desc.trim() === v, true);
        continue;
      }
      // Class 3: wargear-sourced ability whose text grants an invuln (provenance-gated).
      if (isWargear && /invulnerable save/i.test(desc)) {
        consider(extractSavePlus(desc), p.name, false, false);
      }
    }
    for (const child of sel.selections) visit(child, depth + 1);
  };

  visit(selection, 0);
  if (candidates.length === 0) return undefined;
  // Best save first; tie-break prefers a bare (unconditional) then a named candidate.
  candidates.sort(
    (a, b) => a.rank - b.rank || Number(b.bare) - Number(a.bare) || Number(b.named) - Number(a.named),
  );
  const best = candidates[0]!;
  return { value: best.value, sourceName: best.sourceName, bare: best.bare };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/roster test -- builder.test`
Expected: PASS (all 6 new + existing suite green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @muster/roster typecheck` (or the repo's typecheck script for the package)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "feat(roster): provenance-aware invulnSave (wargear/enhancement invuls)"
```

---

### Task 2: Web swaps `findInvuln` → `invulnSave`

**Files:**
- Modify: `apps/web/src/components/Datasheet.tsx`

**Interfaces:**
- Consumes: `invulnSave(catalogue, selection)` from Task 1 (returns `{ value, sourceName, bare } | undefined`).
- Produces: nothing new; behavior-preserving swap.

- [ ] **Step 1: Update the import**

Change line 3 from:
```ts
import { datasheet, unitLoadout, type DatasheetSection } from "@muster/roster";
```
to:
```ts
import { datasheet, unitLoadout, invulnSave, type DatasheetSection } from "@muster/roster";
```

- [ ] **Step 2: Delete the web's own resolution**

Remove the `InvulnInfo` interface, the `extractSavePlus` function, and the `findInvuln` function (the block spanning the current lines ~11–56, i.e. from the `/** The invulnerable save resolved …` comment through the end of `findInvuln`). Keep everything else (the `WEAPON_TYPES` const, `canHover`, etc.).

- [ ] **Step 3: Point both call sites at `invulnSave`**

In `UnitStatline` (the `const invuln = findInvuln(sections);` line): replace with
```ts
  const invuln = invulnSave(catalogue, selection);
```
(`catalogue` and `selection` are already this component's props; `sections` is still used for the `unit` lookup, keep it.)

In `Datasheet` (the `const invuln = findInvuln(all);` line): replace with
```ts
  const invuln = invulnSave(catalogue, selection);
```
(`catalogue` and `selection` are already this component's props; `all` is still used elsewhere, keep it.)

- [ ] **Step 4: Typecheck + build the web package**

Run: `pnpm --filter web typecheck` (and `pnpm --filter web build` if typecheck alone doesn't cover TSX)
Expected: no errors, no unused-symbol warnings (the removed helpers leave no dangling references).

- [ ] **Step 5: Run the web test suite**

Run: `pnpm --filter web test`
Expected: PASS (no regressions; existing Datasheet-related tests still green).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Datasheet.tsx
git commit -m "feat(web): resolve invuln via provenance-aware roster invulnSave"
```

---

### Task 3: Real-data verification (Space Wolves)

**Files:**
- No source changes. A throwaway Node script under the scratchpad; NOT committed (real data is gitignored/large).

**Interfaces:**
- Consumes: the built `@muster/roster` `invulnSave`, `addUnit`/`availableUnits`/`createRoster` (or direct default-loadout seeding), the real packed Space Wolves IR.

- [ ] **Step 1: Locate the real packed catalogue**

Find the local packed Space Wolves IR the earlier infoLink verification used (the parser output over `Space Wolves.cat` + `Imperium - Space Marines.cat` library + the gst). Re-pack via `cargo run --bin muster-parse` with the same inputs from `catalogues.config.json` if no packed artifact is lying around. Note the path.

- [ ] **Step 2: Write a verification script**

In the scratchpad, write a Node/tsx script that: loads the packed SW IR; for every root unit, seeds its default loadout (`addUnit(createRoster(cat, 2000), root.id, cat)` then read the just-added selection) and calls `invulnSave(cat, selection)`; tallies how many roots return a save and prints, per hit, `root.name → value (sourceName)`.

- [ ] **Step 3: Run and assert the three checks**

Run the script. Assert and report:
- (a) **storm-shield / Terminator-Armour units now surface an invuln** — e.g. Wolf Guard Terminators, Wulfen with Storm Shields, Thunderwolf Cavalry with a storm shield appear with a 4+ (spot-check a few names in the printed list).
- (b) **Logan Grimnar still shows 4+** (class 2 unbroken by the refactor).
- (c) **the total hit count is SANE — low dozens, NOT ~160** — confirming "Veil of Ancients" no longer leaks. If the count is ~160, STOP: the provenance assumption is wrong (Veil is not depth-0), and the design needs a name/category exclusion — escalate rather than paper over.

- [ ] **Step 4: Record the numbers**

Write the observed hit count and the spot-checked names into the SDD progress ledger line for Task 3 (and they feed the final report). No commit.

---

## Self-Review notes

- Spec coverage: Task 1 = classes 1–3 + best-of + provenance gate (spec §Design, all 6 unit tests map to spec §Testing 1–6); Task 2 = web swap (spec §Web change); Task 3 = real-data checks (spec §Testing 7 + §Risks provenance measurement).
- Type consistency: `invulnSave` returns `{ value, sourceName, bare }` in Task 1 and is consumed with those exact fields in Task 2; matches the web's existing chip/drop-line usage.
- No placeholders: all code is complete; test helpers are inline literals.
