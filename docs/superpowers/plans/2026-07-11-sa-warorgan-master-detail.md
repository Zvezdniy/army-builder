# S-A War Organ master-detail layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web builder as a War Organ–style master-detail view — left: roster grouped by role; right: the selected unit's full datasheet + config; mobile: drill-in.

**Architecture:** Add category id→name to the domain so roles/keywords read as names; add pure `unitsByRole`/`modelCount` helpers to `@muster/roster`; enrich the demo catalogue (category names, a unit statline on the squad node so it shows immediately, richer abilities/weapons); restructure the web app into RosterList (left) + UnitDetail (right) with a responsive drill-in.

**Tech Stack:** TypeScript (Zod) domain; `@muster/roster` pure TS; React 18 + Vite web (jsdom vitest).

## Global Constraints

- `@muster/roster` and `@muster/domain` enforce 100% coverage via shared `vitest.shared.ts` (EXCLUDES `src/index.ts`) — all logic lives in `builder.ts`/module files; `index.ts` is `export * from "./builder"` (new exports flow through automatically, no barrel edit).
- `apps/web` runs jsdom vitest WITHOUT coverage thresholds — just keep tests green.
- Existing web tests MUST keep passing: `apps/web/src/App.test.tsx` (asserts `getByTestId("points")` shows `0 / 2000` on fresh render) and `apps/web/src/builder.test.tsx` (adds Captain/Assault Squad via palette `add <Name>` buttons, then interacts with the selected unit's `select/deselect <weapon>` and `increase e.assault.marine` controls; asserts `getByTestId("roster-list")` contains "Captain"). This means: (a) keep `data-testid="points"` and `data-testid="roster-list"`; (b) a newly added unit must become the SELECTED unit so its config controls render immediately.
- Identifiers/code/comments/commit messages in English. UI copy may be Russian (matches existing app).
- Do NOT touch the Rust parser, golden fixture, or engine-eval. `categoryNames` is a domain+demo-data concern only this round.
- Immutable roster; theme-aware CSS (reuse existing `index.css` tokens like `--line`, `--accent`).

---

### Task 1: Domain — `IrCatalogue.categoryNames`

**Files:**
- Modify: `packages/domain/src/ir.ts`
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Produces: `IrCatalogue.categoryNames: Record<string,string>` (defaults `{}`).

- [ ] **Step 1: Write the failing test**

Add to `packages/domain/test/ir.test.ts`:
```ts
it("parses a catalogue with category names, defaulting to empty", () => {
  const withNames = IrCatalogue.parse({
    id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [],
    categoryNames: { "cat.hq": "HQ", "cat.troops": "Battleline" },
  });
  expect(withNames.categoryNames["cat.hq"]).toBe("HQ");
  const bare = IrCatalogue.parse({ id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [] });
  expect(bare.categoryNames).toEqual({});
});
```
(`IrCatalogue` is already imported in this test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- ir.test`
Expected: FAIL (`categoryNames` undefined → `.toEqual({})` fails).

- [ ] **Step 3: Add the field**

In `packages/domain/src/ir.ts`, add to the `IrCatalogue` object (after `forceConstraints`):
```ts
  forceConstraints: z.array(IrConstraint).default([]),
  categoryNames: z.record(z.string()).default({}),
});
```

- [ ] **Step 4: Run tests to verify pass + full domain suite (100%)**

Run: `pnpm --filter @muster/domain test`
Expected: all green at 100% coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): IrCatalogue.categoryNames (id->name) for role/keyword labels"
```

---

### Task 2: `@muster/roster` — `unitsByRole` + `modelCount`

**Files:**
- Modify: `packages/roster/src/builder.ts`
- Test: `packages/roster/test/roster-view.test.ts` (create)

**Interfaces:**
- Consumes: `IrCatalogue.categoryNames` (Task 1); existing `catalogueEntry`, `RosterSelection`.
- Produces: `interface RoleGroup { role: string; units: RosterSelection[] }`; `unitsByRole(roster, catalogue): RoleGroup[]`; `modelCount(catalogue, selection): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/roster/test/roster-view.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, RosterSelection, Roster } from "@muster/domain";
import { unitsByRole, modelCount } from "../src";

const entry = (over: Partial<IrCatalogue["entries"][number]>) => ({
  id: "x", name: "X", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [], ...over,
});
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  categoryNames: { "cat.hq": "HQ", "cat.troops": "Battleline" },
  entries: [
    entry({ id: "e.cap", name: "Captain", categories: ["cat.hq"],
      profiles: [{ name: "Captain", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] }] }),
    entry({ id: "e.sq", name: "Squad", categories: ["cat.troops"],
      children: [ entry({ id: "e.trooper", name: "Trooper",
        profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [{ name: "W", value: "2" }] }] }) ] }),
    entry({ id: "e.nocat", name: "Nomad" }),
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, count = 1, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count, selections: children,
});
const roster = (sels: RosterSelection[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000, selections: sels,
} as unknown as Roster);

describe("unitsByRole", () => {
  it("groups root units by first-category name in first-seen order", () => {
    const out = unitsByRole(roster([sel("e.cap"), sel("e.sq"), sel("e.cap")]), cat);
    expect(out.map((g) => g.role)).toEqual(["HQ", "Battleline"]);
    expect(out[0]?.units).toHaveLength(2);
  });
  it("falls back to the id when the name is unknown, and to 'Other' when there is no category", () => {
    const c2 = { ...cat, categoryNames: {} } as unknown as IrCatalogue;
    const out = unitsByRole(roster([sel("e.cap"), sel("e.nocat")]), c2);
    expect(out.map((g) => g.role)).toEqual(["cat.hq", "Other"]);
  });
});

describe("modelCount", () => {
  it("counts a single-model unit as 1", () => {
    expect(modelCount(cat, sel("e.cap"))).toBe(1);
  });
  it("sums counts of Unit-profile nodes across the subtree", () => {
    expect(modelCount(cat, sel("e.sq", 1, [sel("e.trooper", 5)]))).toBe(5);
  });
  it("is 0 for a node with no Unit profile and no model children", () => {
    expect(modelCount(cat, sel("e.nocat"))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/roster test -- roster-view`
Expected: FAIL (`unitsByRole`/`modelCount` not exported).

- [ ] **Step 3: Implement in `builder.ts`**

Add to `packages/roster/src/builder.ts`:
```ts
/** A battlefield-role bucket of root units, for the roster list. */
export interface RoleGroup {
  role: string;
  units: RosterSelection[];
}

/** Group the roster's root units by their entry's first category, resolved to a
 *  human name via `catalogue.categoryNames` (fallback: the id, then "Other"). */
export function unitsByRole(roster: Roster, catalogue: IrCatalogue): RoleGroup[] {
  const groups: RoleGroup[] = [];
  const byRole = new Map<string, RoleGroup>();
  for (const sel of roster.selections) {
    const entry = catalogueEntry(catalogue, sel.entryId);
    const catId = entry?.categories[0];
    const role = catId === undefined ? "Other" : (catalogue.categoryNames?.[catId] ?? catId);
    let group = byRole.get(role);
    if (!group) {
      group = { role, units: [] };
      byRole.set(role, group);
      groups.push(group);
    }
    group.units.push(sel);
  }
  return groups;
}

/** Number of models in a unit: sum of counts over selected nodes whose entry
 *  carries a Unit statline profile (IR has no explicit model type). */
export function modelCount(catalogue: IrCatalogue, selection: RosterSelection): number {
  let count = 0;
  const visit = (sel: RosterSelection): void => {
    const entry = catalogueEntry(catalogue, sel.entryId);
    if ((entry?.profiles ?? []).some((p) => p.typeName === "Unit")) count += sel.count;
    for (const child of sel.selections) visit(child);
  };
  visit(selection);
  return count;
}
```

- [ ] **Step 4: Run test + full suite (100% on builder.ts)**

Run: `pnpm --filter @muster/roster test`
Expected: all green; `builder.ts` 100% (branches: named/id/Other role fallback; Unit-profile/none in modelCount all exercised).

- [ ] **Step 5: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/test/roster-view.test.ts
git commit -m "feat(roster): unitsByRole + modelCount for the master-detail list"
```

---

### Task 3: Demo catalogue — category names, squad statline, richer abilities/weapons

**Files:**
- Modify: `apps/web/src/mini40k.ir.json`

**Interfaces:**
- Consumes: `categoryNames` schema (Task 1); the `profiles` shape from P1-b.

- [ ] **Step 1: Add `categoryNames` at the catalogue top level**

In `apps/web/src/mini40k.ir.json`, add a `"categoryNames"` key as a sibling of the top-level `"entries"` (keep JSON valid — mind commas):
```json
"categoryNames": { "cat.hq": "HQ", "cat.troops": "Battleline", "cat.model": "Model" }
```

- [ ] **Step 2: Give the seeded squad node its own Unit statline**

Find the `"squad-body"` entry (the unit that gets seeded when Battle Squad is added). Add a `"profiles"` array to `squad-body` itself (sibling of its `"name"`/`"costs"`), so the squad's datasheet shows a statline immediately without a separate Trooper selection:
```json
"profiles": [
  { "name": "Battle Squad", "typeName": "Unit", "characteristics": [
    { "name": "M", "value": "6\"" }, { "name": "T", "value": "4" }, { "name": "SV", "value": "3+" },
    { "name": "W", "value": "2" }, { "name": "LD", "value": "6+" }, { "name": "OC", "value": "2" } ] }
]
```
(If `squad-body` already has a `"profiles"` key, add this profile object into that array instead of a second key.)

- [ ] **Step 3: Enrich Battle Squad and Assault Squad with an ability + a weapon**

Add a weapon profile and an ability profile to the demo's squad/assault MODEL entries so their datasheets are non-empty. Add to `squad-body`'s `"profiles"` array (alongside the Unit profile from Step 2):
```json
,{ "name": "Bolt rifle", "typeName": "Ranged Weapons", "characteristics": [
  { "name": "Range", "value": "24\"" }, { "name": "A", "value": "2" }, { "name": "BS", "value": "3+" },
  { "name": "S", "value": "4" }, { "name": "AP", "value": "-1" }, { "name": "D", "value": "1" } ] },
{ "name": "Combat Squads", "typeName": "Abilities", "characteristics": [
  { "name": "Description", "value": "Before deployment you can split this unit into two." } ] }
```
Find the Assault Squad marine entry `"e.assault.marine"` and add a `"profiles"` array (sibling of its keys) with a jump-pack statline + ability:
```json
"profiles": [
  { "name": "Assault Marine", "typeName": "Unit", "characteristics": [
    { "name": "M", "value": "12\"" }, { "name": "T", "value": "4" }, { "name": "SV", "value": "3+" },
    { "name": "W", "value": "2" }, { "name": "LD", "value": "6+" }, { "name": "OC", "value": "2" } ] },
  { "name": "Jump Pack", "typeName": "Abilities", "characteristics": [
    { "name": "Description", "value": "This unit can FLY and gains Assault on its move." } ] }
]
```

- [ ] **Step 4: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/src/mini40k.ir.json','utf8')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mini40k.ir.json
git commit -m "feat(web): demo catalogue — category names, squad statline, richer abilities/weapons"
```

---

### Task 4: Web — master-detail layout (RosterList + UnitDetail)

**Files:**
- Create: `apps/web/src/components/SelectionNode.tsx` (extracted from RosterPanel)
- Create: `apps/web/src/components/RosterList.tsx`
- Create: `apps/web/src/components/UnitDetail.tsx`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/components/RosterPanel.tsx`
- Modify: `apps/web/src/index.css`
- Test: `apps/web/src/components/RosterList.test.tsx` (create)

**Interfaces:**
- Consumes: `unitsByRole`, `modelCount` (Task 2); `categoryNames` demo data (Task 3); existing `catalogueEntry`, `availableUnits`, `addUnit`, `addOption`, `toggleGroupMember`, `setCount`, `remove`, `evaluate`, `UnitConfig`, `Datasheet`.

- [ ] **Step 1: Extract `SelectionNode` into its own file**

Create `apps/web/src/components/SelectionNode.tsx` with the exact `SelectionNode` currently in `RosterPanel.tsx` (unchanged logic — recursive node rendering `UnitConfig`, the depth-0 `Datasheet`, and nested free children):
```tsx
import type { IrCatalogue, IrGroup, Roster, RosterSelection } from "@muster/domain";
import { catalogueEntry } from "@muster/roster";
import { UnitConfig } from "./UnitConfig";
import { Datasheet } from "./Datasheet";

/** One selection in the roster tree: its controls, its datasheet (top level), and its nested options. */
export function SelectionNode({
  roster, selection, catalogue, depth, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  selection: RosterSelection;
  catalogue: IrCatalogue;
  depth: number;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const entry = catalogueEntry(catalogue, selection.entryId);
  const name = entry?.name ?? selection.entryId;
  const groupMemberIds = new Set((entry?.groups ?? []).flatMap((g) => g.memberEntryIds));
  const freeChildren = selection.selections.filter((c) => !groupMemberIds.has(c.entryId));
  return (
    <li style={{
      borderTop: depth === 0 ? "1px solid var(--line)" : "none",
      paddingTop: 6, marginTop: 6, marginLeft: depth * 16,
    }}>
      <strong>{name}</strong>
      <UnitConfig roster={roster} selection={selection} catalogue={catalogue}
        onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
        onRemove={onRemove} onSetCount={onSetCount} />
      {depth === 0 && <Datasheet catalogue={catalogue} selection={selection} />}
      {freeChildren.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {freeChildren.map((child) => (
            <SelectionNode key={child.id} roster={roster} selection={child} catalogue={catalogue}
              depth={depth + 1} onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
              onRemove={onRemove} onSetCount={onSetCount} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Create `RosterList` (left column)**

Create `apps/web/src/components/RosterList.tsx`:
```tsx
import type { IrCatalogue, Roster } from "@muster/domain";
import { unitsByRole, modelCount, availableUnits, catalogueEntry } from "@muster/roster";

export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onAddUnit,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onAddUnit: (entryId: string) => void;
}) {
  const groups = unitsByRole(roster, catalogue);
  return (
    <section data-testid="roster-list" className="rl">
      {groups.map((g) => (
        <div key={g.role} className="rl-group">
          <h3 className="rl-role">{g.role}</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {g.units.map((u) => {
              const name = catalogueEntry(catalogue, u.entryId)?.name ?? u.entryId;
              const models = modelCount(catalogue, u);
              return (
                <li key={u.id}>
                  <button
                    className={u.id === selectedUnitId ? "rl-unit chosen" : "rl-unit"}
                    aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
                    <span>{name}</span>
                    <span className="rl-models">{models} models</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="rl-add">
        <div className="rl-add-label">+ добавить юнит</div>
        {availableUnits(catalogue).map((u) => (
          <button key={u.id} className="rl-add-btn" aria-label={`add ${u.name}`}
            onClick={() => onAddUnit(u.id)}>
            {u.name}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `UnitDetail` (right column)**

Create `apps/web/src/components/UnitDetail.tsx`:
```tsx
import type { IrCatalogue, IrGroup, Roster } from "@muster/domain";
import { catalogueEntry } from "@muster/roster";
import { SelectionNode } from "./SelectionNode";

export function UnitDetail({
  roster, catalogue, selectedUnitId, onBack, onAddOption, onToggleGroupMember, onRemove, onSetCount,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onBack: () => void;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
}) {
  const sel = selectedUnitId ? roster.selections.find((s) => s.id === selectedUnitId) : undefined;
  if (!sel) {
    return <section className="ud ud-empty">Выберите юнит слева</section>;
  }
  const entry = catalogueEntry(catalogue, sel.entryId);
  const keywords = (entry?.categories ?? []).map((id) => catalogue.categoryNames?.[id] ?? id);
  return (
    <section className="ud">
      <button className="ud-back" aria-label="back to list" onClick={onBack}>‹ назад</button>
      {keywords.length > 0 && (
        <div className="ud-kw">
          {keywords.map((k) => <span key={k} className="kw">{k}</span>)}
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <SelectionNode roster={roster} selection={sel} catalogue={catalogue} depth={0}
          onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
          onRemove={onRemove} onSetCount={onSetCount} />
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Rewrite `App.tsx` as master-detail**

Replace `apps/web/src/App.tsx` with:
```tsx
import { useMemo, useState } from "react";
import type { IrCatalogue } from "@muster/domain";
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import { createRoster, addUnit, addOption, toggleGroupMember, setCount, remove } from "@muster/roster";
import { evaluate } from "@muster/engine-eval";
import { RosterList } from "./components/RosterList";
import { UnitDetail } from "./components/UnitDetail";
import mini40k from "./mini40k.ir.json";

export function App() {
  const [catalogue, setCatalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
  const [roster, setRoster] = useState(() => createRoster(catalogue, 2000));
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(undefined);
  const result = useMemo(() => evaluate(roster, catalogue), [roster, catalogue]);

  const loadIr = async (file: File) => {
    const parsed = IrCatalogueSchema.parse(JSON.parse(await file.text()));
    setCatalogue(parsed);
    setRoster(createRoster(parsed, 2000));
    setSelectedUnitId(undefined);
  };

  // Add a unit and focus it, so its config/datasheet render immediately.
  // addUnit is called once (not in an updater) so its fresh id is knowable and
  // stable under StrictMode's double-invocation.
  const addAndSelect = (entryId: string) => {
    const next = addUnit(roster, entryId, catalogue);
    setRoster(next);
    setSelectedUnitId(next.selections[next.selections.length - 1]?.id);
  };

  const handleRemove = (id: string) => {
    const next = remove(roster, id);
    setRoster(next);
    if (!next.selections.some((s) => s.id === selectedUnitId)) setSelectedUnitId(undefined);
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0 }}>Muster — {catalogue.name}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span data-testid="points" style={{ fontWeight: 700, fontSize: 20 }}>
            {result.totalPoints} / {result.pointsLimit} pts
          </span>
          <label style={{ fontSize: 13 }}>
            load IR:{" "}
            <input type="file" accept="application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadIr(f); }} />
          </label>
        </div>
      </header>
      {result.issues.length > 0 && (
        <ul style={{ margin: "4px 0" }}>
          {result.issues.map((i, idx) => (
            <li key={idx} style={{ color: i.severity === "error" ? "var(--error)" : "var(--warn)" }}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="builder" data-view={selectedUnitId ? "detail" : "list"}>
        <RosterList roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onSelect={setSelectedUnitId} onAddUnit={addAndSelect} />
        <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onBack={() => setSelectedUnitId(undefined)}
          onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
          onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid))}
          onRemove={handleRemove}
          onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Delete the old `RosterPanel.tsx`**

```bash
git rm apps/web/src/components/RosterPanel.tsx
```
(Its `SelectionNode` moved to `SelectionNode.tsx`; points/validation moved to the App header; the roster list is now `RosterList`.)

- [ ] **Step 6: Add layout + list/detail styles**

Append to `apps/web/src/index.css`:
```css
.builder { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 16px; margin-top: 8px; }
.rl-group { margin-bottom: 10px; }
.rl-role { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #888); margin: 8px 0 4px; }
.rl-unit { width: 100%; display: flex; justify-content: space-between; gap: 8px; text-align: left;
  padding: 8px 10px; margin-bottom: 4px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; background: transparent; }
.rl-unit.chosen { border-color: var(--accent); }
.rl-models { color: var(--muted, #888); font-variant-numeric: tabular-nums; }
.rl-add { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.rl-add-label { font-size: 12px; color: var(--muted, #888); }
.rl-add-btn { text-align: left; padding: 6px 10px; border: 1px dashed var(--line); border-radius: 8px; cursor: pointer; background: transparent; }
.ud { min-width: 0; }
.ud-empty { color: var(--muted, #888); padding: 16px; }
.ud-kw { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.ud-kw .kw { font-size: 11px; padding: 2px 8px; border-radius: 20px; border: 1px solid var(--line); color: var(--muted, #888); }
.ud-back { display: none; margin-bottom: 8px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; background: transparent; cursor: pointer; }
@media (max-width: 640px) {
  .builder { grid-template-columns: 1fr; }
  .builder[data-view="detail"] .rl { display: none; }
  .builder[data-view="list"] .ud { display: none; }
  .ud-back { display: inline-block; }
}
```
(If `--muted`, `--accent`, `--line`, `--error`, `--warn` are not all defined in `index.css`, use the nearest existing token; the `var(--muted, #888)` fallbacks already cover a missing `--muted`.)

- [ ] **Step 7: Write the RosterList test**

Create `apps/web/src/components/RosterList.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster } from "@muster/domain";
import { RosterList } from "./RosterList";

const cat = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  categoryNames: { "cat.hq": "HQ" },
  entries: [{ id: "e.cap", name: "Captain", costs: [], categories: ["cat.hq"], constraints: [], children: [], groups: [],
    profiles: [{ name: "Captain", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] }] }],
} as unknown as IrCatalogue;
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.cap", count: 1, selections: [] }],
} as unknown as Roster;

describe("RosterList", () => {
  it("shows units under their role heading and reports model count", () => {
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onAddUnit={() => {}} />);
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open Captain/i })).toHaveTextContent("1 models");
  });
  it("selects a unit on click", async () => {
    const onSelect = vi.fn();
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={onSelect} onAddUnit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /open Captain/i }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });
});
```

- [ ] **Step 8: Run web tests + full monorepo + typecheck**

Run: `pnpm --filter @muster/web test`
Expected: green — new RosterList test, plus the pre-existing `App.test.tsx` (`0 / 2000`) and `builder.test.tsx` (add Captain → selected → `select Power Sword` present; `roster-list` contains "Captain"; Assault Squad stepper) all pass.

Run: `pnpm -w test` and `npx turbo typecheck`
Expected: turbo all-successful; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/SelectionNode.tsx apps/web/src/components/RosterList.tsx \
        apps/web/src/components/UnitDetail.tsx apps/web/src/components/RosterList.test.tsx apps/web/src/index.css
git rm apps/web/src/components/RosterPanel.tsx
git commit -m "feat(web): War Organ-style master-detail layout (roster by role + unit detail)"
```

---

## Self-Review notes

- **Spec coverage:** categoryNames (T1), unitsByRole/modelCount (T2), demo data incl. squad statline (T3), master-detail web + responsive drill-in (T4). All spec layers covered.
- **Existing-test safety:** T4 keeps `data-testid="points"` (App header) and `data-testid="roster-list"` (RosterList); a newly added unit is auto-selected (`addAndSelect`) so `builder.test.tsx`'s `select Power Sword` / `increase e.assault.marine` controls render. `roster-list` contains the unit name ("Captain").
- **Type consistency:** `categoryNames: Record<string,string>` (T1) consumed by `unitsByRole`/`UnitDetail` keyword resolution; `RoleGroup`/`modelCount` signatures identical between T2 producer and T4 (RosterList) consumer; `SelectionNode` prop shape unchanged from the original RosterPanel.
- **StrictMode hazard:** `addAndSelect` calls `addUnit` once outside the state updater, so the fresh random id it selects matches the committed roster (no double-invoke divergence).
- **Scope:** no parser/golden/engine-eval changes; auto-model-as-separate-selection deliberately deferred (squad statline delivered via demo data instead).
