# Leader-attach (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Character (Leader) attach to an eligible Bodyguard unit, storing the link in the roster and showing the grouping in the builder.

**Architecture:** App-only. The "Leader" ability text is already inlined onto a unit's `profiles`, so no parser/engine change. Add an optional `attachedTo` field to `RosterSelection`; add a new `packages/roster/src/leader.ts` for eligibility parsing + attach/detach; render the relationship in `UnitDetail` and `RosterList`.

**Tech Stack:** TypeScript (strict), Zod (`@muster/domain`), Vitest, React + Vite (`apps/web`), `@testing-library/react`.

## Global Constraints

- Respond to the user in Russian (does not affect code/comments — English).
- `@muster/roster` is immutable and rules-free; it must keep **100% coverage** (package gate). Every new branch needs a test.
- Turbo runs only `typecheck` and `test`: `pnpm turbo run typecheck test`.
- `RosterSelection.attachedTo` is set only on a top-level Leader selection; both Leader and Bodyguard remain top-level units.
- Parse must handle four real markup styles (■ bullet incl. ALL-CAPS, `-` bold bullet, inline comma-separated, keyword+`(Excluding …)` → `[]`). ALL-CAPS names match units case-insensitively.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do NOT push; the user pushes.

## File Structure

- `packages/domain/src/roster.ts` — add optional `attachedTo` to `RosterSelection` (schema + interface).
- `packages/roster/src/leader.ts` — **new**: `leaderAbilityText`, `parseAttachTargets`, `isLeaderUnit`, `leaderTargets`, `attachLeader`, `detachLeader`, `attachedLeaders`.
- `packages/roster/src/leader.test.ts` — **new**: unit tests for the above.
- `packages/roster/src/index.ts` — re-export `./leader`.
- `packages/roster/src/builder.ts` — `remove()` clears dangling `attachedTo`.
- `packages/roster/src/builder.test.ts` — dangling-cleanup test.
- `apps/web/src/components/UnitDetail.tsx` — attach section (3 states).
- `apps/web/src/components/UnitDetail.attach.test.tsx` — **new**: attach-section tests.
- `apps/web/src/components/RosterList.tsx` — group attached Leader under Bodyguard.
- `apps/web/src/components/RosterList.test.tsx` — grouping test.
- `apps/web/src/App.tsx` — wire `attachLeader` / `detachLeader`.

---

### Task 1: Domain — `attachedTo` on `RosterSelection`

**Files:**
- Modify: `packages/domain/src/roster.ts:9-24`
- Test: `packages/domain/src/roster.test.ts` (create if absent)

**Interfaces:**
- Produces: `RosterSelection.attachedTo?: string` — a top-level Leader selection's Bodyguard selection id.

- [ ] **Step 1: Write the failing test**

Create/append `packages/domain/src/roster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RosterSelection } from "./roster";

describe("RosterSelection.attachedTo", () => {
  it("accepts an optional attachedTo", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1, attachedTo: "b" });
    expect(s.attachedTo).toBe("b");
  });
  it("stays optional (absent when not given)", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1 });
    expect(s.attachedTo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- roster`
Expected: FAIL — `attachedTo` stripped/undefined on the first case (field not in schema).

- [ ] **Step 3: Add the field**

In `packages/domain/src/roster.ts`, add `attachedTo` to both the interface and the schema:

```ts
export interface RosterSelection {
  id: string;
  entryId: string;
  count: number;
  selections: RosterSelection[];
  attachedTo?: string;
}
export const RosterSelection: z.ZodType<RosterSelection, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    entryId: z.string(),
    count: z.number().int().positive().max(MAX_SELECTION_COUNT),
    selections: z.array(RosterSelection).default([]),
    attachedTo: z.string().optional(),
  }),
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/domain test -- roster`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/roster.ts packages/domain/src/roster.test.ts
git commit -m "$(printf 'feat(domain): optional attachedTo on RosterSelection\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Roster — Leader detection & target parsing (`leader.ts`)

**Files:**
- Create: `packages/roster/src/leader.ts`
- Modify: `packages/roster/src/index.ts`
- Test: `packages/roster/src/leader.test.ts`

**Interfaces:**
- Consumes: `catalogueEntry(catalogue, entryId)` from `./builder`.
- Produces:
  - `leaderAbilityText(catalogue: IrCatalogue, entryId: string): string | undefined`
  - `parseAttachTargets(description: string): string[]`
  - `isLeaderUnit(catalogue: IrCatalogue, entryId: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/roster/src/leader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { leaderAbilityText, parseAttachTargets, isLeaderUnit } from "./leader";

function cat(entries: unknown[]): IrCatalogue {
  return { id: "c", name: "C", gameSystemId: "gs", revision: 1, entries } as unknown as IrCatalogue;
}
function leaderEntry(id: string, name: string, desc: string) {
  return {
    id, name, costs: [], categories: [], constraints: [], children: [], groups: [],
    profiles: [{ name: "Leader", typeName: "Abilities", characteristics: [{ name: "Description", value: desc }] }],
  };
}

describe("parseAttachTargets", () => {
  it("parses ■ bullet lines", () => {
    expect(parseAttachTargets(
      "This unit can be attached to the following units:\n\n■ Assault Intercessor Squad\n■ Intercessor Squad",
    )).toEqual(["Assault Intercessor Squad", "Intercessor Squad"]);
  });
  it("parses ALL-CAPS ■ bullets verbatim (matched case-insensitively later)", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units:\n\n■ AGGRESSOR SQUAD\n■ ERADICATOR SQUAD",
    )).toEqual(["AGGRESSOR SQUAD", "ERADICATOR SQUAD"]);
  });
  it("parses dash + bold bullets and drops the (Excluding …) clause", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units:\n- **^^Tactical Squad^^**\n- **^^Tacticus^^** (Excluding ^^**Character^^** and **^^Fly**^^)",
    )).toEqual(["Tactical Squad", "Tacticus"]);
  });
  it("parses inline comma-separated names", () => {
    expect(parseAttachTargets(
      "This model can be attached to the following units: ^^**Seraphim Squad, Zephyrim Squad**^^",
    )).toEqual(["Seraphim Squad", "Zephyrim Squad"]);
  });
  it("returns [] when there is no attach list", () => {
    expect(parseAttachTargets("Some other ability text.")).toEqual([]);
  });
  it("deduplicates repeated names", () => {
    expect(parseAttachTargets(
      "attached to the following units:\n■ Battle Sisters Squad\n■ Battle Sisters Squad",
    )).toEqual(["Battle Sisters Squad"]);
  });
});

describe("leaderAbilityText / isLeaderUnit", () => {
  const c = cat([
    leaderEntry("e.lead", "Canoness", "attached to the following units:\n■ Battle Sisters Squad"),
    { id: "e.plain", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [],
      profiles: [{ name: "Battle Sisters Squad", typeName: "Unit", characteristics: [] }] },
  ]);
  it("returns the Leader ability Description for a leader", () => {
    expect(leaderAbilityText(c, "e.lead")).toContain("Battle Sisters Squad");
  });
  it("returns undefined for a non-leader", () => {
    expect(leaderAbilityText(c, "e.plain")).toBeUndefined();
  });
  it("isLeaderUnit is true only for a leader", () => {
    expect(isLeaderUnit(c, "e.lead")).toBe(true);
    expect(isLeaderUnit(c, "e.plain")).toBe(false);
    expect(isLeaderUnit(c, "e.missing")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @muster/roster test -- leader`
Expected: FAIL — `./leader` module not found.

- [ ] **Step 3: Implement `leader.ts` (detection + parsing part)**

Create `packages/roster/src/leader.ts`:

```ts
import type { IrCatalogue, IrProfile } from "@muster/domain";
import { catalogueEntry } from "./builder";

/** The "Leader" ability profile on this unit's entry (or any descendant entry),
 *  if present. It is an Abilities profile named "Leader" whose Description names the
 *  units the Leader may attach to. Searching the subtree tolerates a Leader ability
 *  that sits on a sub-model rather than the top-level entry. */
function leaderProfile(catalogue: IrCatalogue, entryId: string): IrProfile | undefined {
  const root = catalogueEntry(catalogue, entryId);
  if (root === undefined) return undefined;
  const stack = [root];
  while (stack.length > 0) {
    const e = stack.pop()!;
    for (const p of e.profiles ?? []) {
      if (p.name === "Leader") return p;
    }
    stack.push(...e.children);
  }
  return undefined;
}

/** The unit's "Leader" ability Description text, or undefined if it is not a Leader. */
export function leaderAbilityText(catalogue: IrCatalogue, entryId: string): string | undefined {
  const p = leaderProfile(catalogue, entryId);
  if (p === undefined) return undefined;
  return p.characteristics.find((c) => c.name === "Description")?.value;
}

/** True when this unit entry carries a "Leader" ability profile. */
export function isLeaderUnit(catalogue: IrCatalogue, entryId: string): boolean {
  return leaderProfile(catalogue, entryId) !== undefined;
}

/** Strip BattleScribe emphasis (`^^`, `**`), a leading bullet/dash, and surrounding
 *  whitespace from one candidate name; collapse inner whitespace. */
function cleanName(s: string): string {
  return s
    .replace(/\^\^/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[\s\-–—•·]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the eligible target unit names out of a "Leader" ability Description.
 *  Handles ■ bullets (incl. ALL-CAPS), `-` bold bullets, and inline comma-separated
 *  lists. `(Excluding …)` clauses are dropped before splitting. Returns [] when the
 *  description carries no attach list (e.g. keyword-only eligibility we don't model). */
export function parseAttachTargets(description: string): string[] {
  const marker = /attached to the following units?:/i.exec(description);
  if (marker === null) return [];
  const body = description
    .slice(marker.index + marker[0].length)
    .replace(/\([^)]*\)/g, " "); // drop parentheticals such as "(Excluding …)"
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of body.split(/[\n,]|■/)) {
    const name = cleanName(piece);
    if (name.length > 0 && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/roster/src/index.ts`, add:

```ts
export * from "./leader";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @muster/roster test -- leader`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/leader.ts packages/roster/src/leader.test.ts packages/roster/src/index.ts
git commit -m "$(printf 'feat(roster): leader detection and attach-target parsing\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Roster — attach / detach operations (`leader.ts`)

**Files:**
- Modify: `packages/roster/src/leader.ts`
- Test: `packages/roster/src/leader.test.ts`

**Interfaces:**
- Consumes: `catalogueEntry` from `./builder`; `leaderAbilityText`, `parseAttachTargets` from Task 2.
- Produces:
  - `leaderTargets(roster, catalogue, leaderSelectionId): { bodyguardSelectionId: string; bodyguardName: string }[]`
  - `attachLeader(roster, catalogue, leaderSelectionId, bodyguardSelectionId): Roster`
  - `detachLeader(roster, leaderSelectionId): Roster`
  - `attachedLeaders(roster, bodyguardSelectionId): RosterSelection[]`

- [ ] **Step 1: Write the failing tests**

Append to `packages/roster/src/leader.test.ts`:

```ts
import type { Roster } from "@muster/domain";
import { leaderTargets, attachLeader, detachLeader, attachedLeaders } from "./leader";

const scenario = () => {
  const catalogue = cat([
    leaderEntry("e.canoness", "Canoness", "attached to the following units:\n■ BATTLE SISTERS SQUAD"),
    { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
    { id: "e.other", name: "Repentia Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
  ]);
  const roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [
      { id: "L", entryId: "e.canoness", count: 1, selections: [] },
      { id: "B", entryId: "e.bss", count: 1, selections: [] },
      { id: "O", entryId: "e.other", count: 1, selections: [] },
    ],
  } as unknown as Roster;
  return { catalogue, roster };
};

describe("leaderTargets", () => {
  it("offers an eligible present unit (case-insensitive), not ineligible ones", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "L")).toEqual([{ bodyguardSelectionId: "B", bodyguardName: "Battle Sisters Squad" }]);
  });
  it("excludes a target already led by another leader", () => {
    const { catalogue, roster } = scenario();
    const led = attachLeader(roster, catalogue, "L", "B");
    // add a second canoness and confirm B is no longer offered to it
    const twoLeaders = { ...led, selections: [...led.selections, { id: "L2", entryId: "e.canoness", count: 1, selections: [] }] } as Roster;
    expect(leaderTargets(twoLeaders, catalogue, "L2")).toEqual([]);
  });
  it("returns [] for a non-leader selection", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "B")).toEqual([]);
  });
  it("returns [] for an unknown selection id", () => {
    const { catalogue, roster } = scenario();
    expect(leaderTargets(roster, catalogue, "zzz")).toEqual([]);
  });
});

describe("attachLeader / detachLeader", () => {
  it("attaches an eligible target and does not mutate the input", () => {
    const { catalogue, roster } = scenario();
    const next = attachLeader(roster, catalogue, "L", "B");
    expect(next.selections.find((s) => s.id === "L")?.attachedTo).toBe("B");
    expect(roster.selections.find((s) => s.id === "L")?.attachedTo).toBeUndefined();
  });
  it("is a no-op for an ineligible target", () => {
    const { catalogue, roster } = scenario();
    expect(attachLeader(roster, catalogue, "L", "O")).toBe(roster);
  });
  it("is a no-op when the target is already led", () => {
    const { catalogue, roster } = scenario();
    const once = attachLeader(roster, catalogue, "L", "B");
    const twoLeaders = { ...once, selections: [...once.selections, { id: "L2", entryId: "e.canoness", count: 1, selections: [] }] } as Roster;
    expect(attachLeader(twoLeaders, catalogue, "L2", "B")).toBe(twoLeaders);
  });
  it("detaches, clearing attachedTo", () => {
    const { catalogue, roster } = scenario();
    const attached = attachLeader(roster, catalogue, "L", "B");
    const detached = detachLeader(attached, "L");
    expect(detached.selections.find((s) => s.id === "L")?.attachedTo).toBeUndefined();
  });
  it("detach is a no-op for an unattached leader", () => {
    const { catalogue, roster } = scenario();
    expect(detachLeader(roster, "L")).toBe(roster);
  });
});

describe("attachedLeaders", () => {
  it("lists the leaders attached to a bodyguard", () => {
    const { catalogue, roster } = scenario();
    const attached = attachLeader(roster, catalogue, "L", "B");
    expect(attachedLeaders(attached, "B").map((s) => s.id)).toEqual(["L"]);
    expect(attachedLeaders(attached, "O")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @muster/roster test -- leader`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Implement the operations**

Append to `packages/roster/src/leader.ts`:

```ts
import type { Roster, RosterSelection } from "@muster/domain";

/** For a Leader selection, the roster units it may attach to right now: eligible by
 *  name (case-insensitive) AND not already led by another Leader. Empty when the
 *  selection is not a Leader, is unknown, or its list resolves to no present unit. */
export function leaderTargets(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string,
): { bodyguardSelectionId: string; bodyguardName: string }[] {
  const leader = roster.selections.find((s) => s.id === leaderSelectionId);
  if (leader === undefined) return [];
  const desc = leaderAbilityText(catalogue, leader.entryId);
  if (desc === undefined) return [];
  const wanted = new Set(parseAttachTargets(desc).map((n) => n.toLowerCase()));
  if (wanted.size === 0) return [];
  const led = new Set(
    roster.selections.map((s) => s.attachedTo).filter((x): x is string => x !== undefined),
  );
  const out: { bodyguardSelectionId: string; bodyguardName: string }[] = [];
  for (const u of roster.selections) {
    if (u.id === leaderSelectionId || led.has(u.id)) continue;
    const name = catalogueEntry(catalogue, u.entryId)?.name;
    if (name !== undefined && wanted.has(name.toLowerCase())) {
      out.push({ bodyguardSelectionId: u.id, bodyguardName: name });
    }
  }
  return out;
}

/** Attach a Leader to a Bodyguard. No-op (returns the same roster) when the target is
 *  not currently an eligible, un-led target for this Leader. */
export function attachLeader(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string, bodyguardSelectionId: string,
): Roster {
  const ok = leaderTargets(roster, catalogue, leaderSelectionId)
    .some((t) => t.bodyguardSelectionId === bodyguardSelectionId);
  if (!ok) return roster;
  return {
    ...roster,
    selections: roster.selections.map((s) =>
      s.id === leaderSelectionId ? { ...s, attachedTo: bodyguardSelectionId } : s),
  };
}

/** Clear a Leader's attachment. No-op when it is not attached. */
export function detachLeader(roster: Roster, leaderSelectionId: string): Roster {
  const leader = roster.selections.find((s) => s.id === leaderSelectionId);
  if (leader === undefined || leader.attachedTo === undefined) return roster;
  return {
    ...roster,
    selections: roster.selections.map((s) => {
      if (s.id !== leaderSelectionId) return s;
      const { attachedTo, ...rest } = s;
      return rest;
    }),
  };
}

/** The Leaders currently attached to a given Bodyguard (v1: 0 or 1). */
export function attachedLeaders(roster: Roster, bodyguardSelectionId: string): RosterSelection[] {
  return roster.selections.filter((s) => s.attachedTo === bodyguardSelectionId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/roster test -- leader`
Expected: PASS.

- [ ] **Step 5: Verify package coverage still 100%**

Run: `pnpm --filter @muster/roster test`
Expected: PASS with coverage gate satisfied (no uncovered lines in `leader.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/leader.ts packages/roster/src/leader.test.ts
git commit -m "$(printf 'feat(roster): guarded attachLeader/detachLeader + leaderTargets\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Roster — `remove()` clears dangling `attachedTo`

**Files:**
- Modify: `packages/roster/src/builder.ts:67-69`
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Consumes: existing `removeTree` (unchanged).
- Produces: `remove()` now also drops any top-level selection's `attachedTo` that points at a removed selection.

- [ ] **Step 1: Write the failing test**

Append to `packages/roster/src/builder.test.ts`. `remove` is already imported; the file's type import is `import type { IrCatalogue, IrGroup } from "@muster/domain";` — add `Roster` to it so the test below type-checks:

```ts
describe("remove() clears dangling attachedTo", () => {
  it("detaches a leader when its bodyguard is removed", () => {
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "L", entryId: "e.lead", count: 1, selections: [], attachedTo: "B" },
        { id: "B", entryId: "e.bss", count: 1, selections: [] },
      ],
    } as unknown as Roster;
    const next = remove(roster, "B");
    expect(next.selections.map((s) => s.id)).toEqual(["L"]);
    expect(next.selections[0].attachedTo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @muster/roster test -- builder`
Expected: FAIL — leader keeps `attachedTo: "B"` after the bodyguard is removed.

- [ ] **Step 3: Update `remove()`**

Replace the body of `remove` in `packages/roster/src/builder.ts`:

```ts
/** Remove a selection and its subtree. Also clears any Leader attachment that now
 *  dangles because its Bodyguard was the removed selection. */
export function remove(roster: Roster, selectionId: string): Roster {
  const pruned = removeTree(roster.selections, selectionId);
  const present = new Set<string>();
  const collect = (s: RosterSelection): void => { present.add(s.id); s.selections.forEach(collect); };
  pruned.forEach(collect);
  const cleaned = pruned.map((s) => {
    if (s.attachedTo === undefined || present.has(s.attachedTo)) return s;
    const { attachedTo, ...rest } = s;
    return rest;
  });
  return { ...roster, selections: cleaned };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/roster test`
Expected: PASS (coverage gate satisfied).

- [ ] **Step 5: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "$(printf 'feat(roster): remove() clears dangling leader attachment\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Web — `UnitDetail` attach section

**Files:**
- Modify: `apps/web/src/components/UnitDetail.tsx`
- Test: `apps/web/src/components/UnitDetail.attach.test.tsx`

**Interfaces:**
- Consumes: `isLeaderUnit`, `leaderTargets`, `catalogueEntry` from `@muster/roster`.
- Produces: `UnitDetail` gains props `onAttachLeader: (leaderId: string, bodyguardId: string) => void` and `onDetachLeader: (leaderId: string) => void`, and renders an attach section when the selected unit is a Leader.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/UnitDetail.attach.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster } from "@muster/domain";
import { UnitDetail } from "./UnitDetail";

const catalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, categoryNames: {},
  entries: [
    { id: "e.lead", name: "Canoness", costs: [], categories: [], constraints: [], children: [], groups: [],
      profiles: [{ name: "Leader", typeName: "Abilities", characteristics: [{ name: "Description", value: "attached to the following units:\n■ Battle Sisters Squad" }] }] },
    { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
  ],
} as unknown as IrCatalogue;

const base = (attachedTo?: string): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "L", entryId: "e.lead", count: 1, selections: [], ...(attachedTo ? { attachedTo } : {}) },
    { id: "B", entryId: "e.bss", count: 1, selections: [] },
  ],
} as unknown as Roster);

const noop = () => {};
function renderDetail(roster: Roster, over: Partial<Record<string, unknown>> = {}) {
  return render(
    <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId="L"
      onBack={noop} onAddOption={noop} onToggleGroupMember={noop}
      onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop}
      onAttachLeader={noop} onDetachLeader={noop} {...over} />,
  );
}

describe("UnitDetail attach section", () => {
  it("offers an eligible target and fires onAttachLeader", async () => {
    const onAttachLeader = vi.fn();
    renderDetail(base(), { onAttachLeader });
    await userEvent.click(screen.getByRole("button", { name: /attach to Battle Sisters Squad/i }));
    expect(onAttachLeader).toHaveBeenCalledWith("L", "B");
  });
  it("shows the current bodyguard and fires onDetachLeader when attached", async () => {
    const onDetachLeader = vi.fn();
    renderDetail(base("B"), { onDetachLeader });
    expect(screen.getByText(/Leading Battle Sisters Squad/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /detach/i }));
    expect(onDetachLeader).toHaveBeenCalledWith("L");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @muster/web test -- UnitDetail.attach`
Expected: FAIL — `UnitDetail` has no attach section / props.

- [ ] **Step 3: Add the attach section**

In `apps/web/src/components/UnitDetail.tsx`, update the import and props, and render the section after `<UnitStatline …/>`:

```tsx
import type { IrCatalogue, IrGroup, Roster } from "@muster/domain";
import { catalogueEntry, isLeaderUnit, leaderTargets } from "@muster/roster";
import { SelectionNode } from "./SelectionNode";
import { Datasheet, UnitStatline } from "./Datasheet";

export function UnitDetail({
  roster, catalogue, selectedUnitId, onBack, onAddOption, onToggleGroupMember,
  onSetGroupMemberCount, onRemove, onSetCount, onAttachLeader, onDetachLeader,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onBack: () => void;
  onAddOption: (parentId: string, entryId: string) => void;
  onToggleGroupMember: (parentId: string, group: IrGroup, entryId: string) => void;
  onSetGroupMemberCount: (parentId: string, group: IrGroup, entryId: string, count: number) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
  onAttachLeader: (leaderId: string, bodyguardId: string) => void;
  onDetachLeader: (leaderId: string) => void;
}) {
  const sel = selectedUnitId ? roster.selections.find((s) => s.id === selectedUnitId) : undefined;
  if (!sel) {
    return <section className="ud ud-empty">Select a unit on the left</section>;
  }
  const entry = catalogueEntry(catalogue, sel.entryId);
  const name = entry?.name ?? sel.entryId;
  const keywords = (entry?.categories ?? []).map((id) => catalogue.categoryNames?.[id] ?? id);
  return (
    <section className="ud">
      <button className="ud-remove" title="Remove unit" aria-label={`remove ${name}`}
        onClick={() => onRemove(sel.id)}>🗑</button>
      <button className="ud-back" aria-label="back to list" onClick={onBack}>‹ Back</button>
      {keywords.length > 0 && (
        <div className="ud-kw">
          {keywords.map((k) => <span key={k} className="kw">{k}</span>)}
        </div>
      )}
      <UnitStatline catalogue={catalogue} roster={roster} selection={sel} />
      {isLeaderUnit(catalogue, sel.entryId) && (
        <AttachSection roster={roster} catalogue={catalogue} leader={sel}
          onAttachLeader={onAttachLeader} onDetachLeader={onDetachLeader} />
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <SelectionNode roster={roster} selection={sel} catalogue={catalogue} depth={0}
          onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
          onSetGroupMemberCount={onSetGroupMemberCount}
          onRemove={onRemove} onSetCount={onSetCount} />
      </ul>
      <Datasheet catalogue={catalogue} roster={roster} selection={sel} />
    </section>
  );
}

function AttachSection({
  roster, catalogue, leader, onAttachLeader, onDetachLeader,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  leader: Roster["selections"][number];
  onAttachLeader: (leaderId: string, bodyguardId: string) => void;
  onDetachLeader: (leaderId: string) => void;
}) {
  if (leader.attachedTo !== undefined) {
    const host = roster.selections.find((s) => s.id === leader.attachedTo);
    const hostName = host ? catalogueEntry(catalogue, host.entryId)?.name ?? host.entryId : "unit";
    return (
      <div className="ud-attach">
        <span className="ud-attach-on">Leading {hostName}</span>
        <button className="ud-attach-detach" onClick={() => onDetachLeader(leader.id)}>Detach</button>
      </div>
    );
  }
  const targets = leaderTargets(roster, catalogue, leader.id);
  if (targets.length === 0) {
    return <div className="ud-attach ud-attach-empty">Add an eligible unit to this roster to attach this Leader.</div>;
  }
  return (
    <div className="ud-attach">
      <span className="ud-attach-label">Attach to unit:</span>
      {targets.map((t) => (
        <button key={t.bodyguardSelectionId} className="ud-attach-target"
          onClick={() => onAttachLeader(leader.id, t.bodyguardSelectionId)}>
          Attach to {t.bodyguardName}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/web test -- UnitDetail.attach`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/UnitDetail.tsx apps/web/src/components/UnitDetail.attach.test.tsx
git commit -m "$(printf 'feat(web): leader attach section in UnitDetail\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Web — `RosterList` grouping + App wiring

**Files:**
- Modify: `apps/web/src/components/RosterList.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/RosterList.test.tsx`

**Interfaces:**
- Consumes: `attachLeader`, `detachLeader` from `@muster/roster` (App); an attached Leader is any top-level `selection.attachedTo !== undefined`.
- Produces: `App` passes `onAttachLeader` / `onDetachLeader` to `UnitDetail`; `RosterList` renders attached Leaders under their Bodyguard and omits them from their own role bucket.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/RosterList.test.tsx`:

```tsx
it("renders an attached leader under its bodyguard, not in its own bucket", () => {
  const cat2 = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    categoryNames: { "cat.hq": "HQ", "cat.tr": "Battleline" },
    entries: [
      { id: "e.lead", name: "Canoness", costs: [], categories: ["cat.hq"], constraints: [], children: [], groups: [],
        profiles: [{ name: "Canoness", typeName: "Unit", characteristics: [] }] },
      { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: ["cat.tr"], constraints: [], children: [], groups: [],
        profiles: [{ name: "Battle Sisters Squad", typeName: "Unit", characteristics: [] }] },
    ],
  } as unknown as IrCatalogue;
  const r2 = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [
      { id: "L", entryId: "e.lead", count: 1, selections: [], attachedTo: "B" },
      { id: "B", entryId: "e.bss", count: 1, selections: [] },
    ],
  } as unknown as Roster;
  render(<RosterList roster={r2} catalogue={cat2} selectedUnitId={undefined}
    onSelect={() => {}} onOpenPicker={() => {}} />);
  // The leader is not listed under its own "HQ" role bucket…
  expect(screen.queryByRole("heading", { name: "HQ" })).toBeNull();
  // …but appears as a "leading" child of the bodyguard.
  expect(screen.getByRole("button", { name: /open Canoness/i })).toHaveTextContent(/leading/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @muster/web test -- RosterList`
Expected: FAIL — the leader still renders in its own "HQ" bucket, no "leading" child.

- [ ] **Step 3: Update `RosterList`**

Rewrite `apps/web/src/components/RosterList.tsx`:

```tsx
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";
import { unitsByRole, modelCount, catalogueEntry } from "@muster/roster";

function unitHasHiddenSelection(
  sel: { id: string; selections: { id: string; selections: unknown[] }[] },
  hidden: Set<string>,
): boolean {
  if (hidden.has(sel.id)) return true;
  return sel.selections.some((c) => unitHasHiddenSelection(c as typeof sel, hidden));
}

/** The roster window: added units grouped by role, plus the add-unit trigger.
 *  An attached Leader is drawn under its Bodyguard (and omitted from its own bucket). */
export function RosterList({
  roster, catalogue, selectedUnitId, onSelect, onOpenPicker, hiddenIds,
}: {
  roster: Roster;
  catalogue: IrCatalogue;
  selectedUnitId: string | undefined;
  onSelect: (id: string) => void;
  onOpenPicker: () => void;
  hiddenIds?: Set<string>;
}) {
  const hidden = hiddenIds ?? new Set<string>();
  const groups = unitsByRole(roster, catalogue);
  const attachedByHost = new Map<string, RosterSelection[]>();
  for (const s of roster.selections) {
    if (s.attachedTo !== undefined) {
      const list = attachedByHost.get(s.attachedTo) ?? [];
      list.push(s);
      attachedByHost.set(s.attachedTo, list);
    }
  }
  const renderUnitButton = (u: RosterSelection, extraClass = "", leading = false) => {
    const name = catalogueEntry(catalogue, u.entryId)?.name ?? u.entryId;
    const models = modelCount(catalogue, u);
    const flagged = unitHasHiddenSelection(u, hidden);
    return (
      <button
        className={`${u.id === selectedUnitId ? "rl-unit selected" : "rl-unit"}${extraClass ? " " + extraClass : ""}`}
        aria-label={`open ${name}`} onClick={() => onSelect(u.id)}>
        <span>{leading ? `↳ ${name} (leading)` : name}</span>
        {flagged && (
          <span className="rl-warn" title="Contains a selection not available in the current army configuration">⚠</span>
        )}
        <span className="rl-models">{models} model{models === 1 ? "" : "s"}</span>
      </button>
    );
  };
  return (
    <section data-testid="roster-list" className="rl">
      <div className="rl-head">
        <h2 className="rl-title">Roster</h2>
        <button className="rl-add-open" onClick={onOpenPicker}>+ Add unit</button>
      </div>
      {groups.length === 0 && <div className="rl-empty">Roster is empty — add a unit</div>}
      {groups.map((g) => {
        const units = g.units.filter((u) => u.attachedTo === undefined);
        if (units.length === 0) return null;
        return (
          <div key={g.role} className="rl-group">
            <h3 className="rl-role">{g.role}</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {units.map((u) => (
                <li key={u.id}>
                  {renderUnitButton(u)}
                  {(attachedByHost.get(u.id) ?? []).map((leader) => (
                    <div key={leader.id} className="rl-leader">
                      {renderUnitButton(leader, "rl-leading", true)}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Run the RosterList test to verify it passes**

Run: `pnpm --filter @muster/web test -- RosterList`
Expected: PASS.

- [ ] **Step 5: Wire App handlers**

In `apps/web/src/App.tsx`, add `attachLeader, detachLeader` to the `@muster/roster` import, and pass two new props to `<UnitDetail …>`:

```tsx
// import line — add attachLeader, detachLeader
import { createRoster, addUnit, addOption, toggleGroupMember, setGroupMemberCount, setCount, remove,
  toggleDetachment, setPointsLimit, availableDetachments, selectedDetachment,
  detachmentSelectionIds, attachLeader, detachLeader } from "@muster/roster";
```

```tsx
        <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId={selectedUnitId}
          onBack={() => setSelectedUnitId(undefined)}
          onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid, catalogue))}
          onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))}
          onSetGroupMemberCount={(pid, group, eid, count) => setRoster((r) => setGroupMemberCount(r, pid, group, eid, count, catalogue))}
          onRemove={handleRemove}
          onSetCount={(id, c) => setRoster((r) => setCount(r, id, c))}
          onAttachLeader={(lid, bid) => setRoster((r) => attachLeader(r, catalogue, lid, bid))}
          onDetachLeader={(lid) => setRoster((r) => detachLeader(r, lid))} />
```

- [ ] **Step 6: Run the whole web + roster suites and typecheck**

Run: `pnpm turbo run typecheck test`
Expected: PASS across all packages.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/RosterList.tsx apps/web/src/components/RosterList.test.tsx apps/web/src/App.tsx
git commit -m "$(printf 'feat(web): group attached leader under its bodyguard + wire attach/detach\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- Domain `attachedTo` → Task 1. ✅
- Parse (4 markup styles + keyword→[]) → Task 2 (`parseAttachTargets`). ✅
- `isLeaderUnit` / `leaderAbilityText` → Task 2. ✅
- `leaderTargets` / `attachLeader` / `detachLeader` / `attachedLeaders` → Task 3. ✅
- Dangling cleanup in `remove()` → Task 4. ✅
- UnitDetail attach section (3 states) → Task 5. ✅
- RosterList grouping (no points) + App wiring → Task 6. ✅
- Legality at the operation (guard in `attachLeader`) → Task 3. ✅

**Placeholder scan:** none.

**Type consistency:** `attachLeader(roster, catalogue, leaderId, bodyguardId)` signature is identical in Task 3 (definition), Task 5 (App handler shape `onAttachLeader(leaderId, bodyguardId)`), and Task 6 (App wiring). `leaderTargets` return shape `{ bodyguardSelectionId, bodyguardName }` is consumed unchanged in Task 5. `RosterSelection.attachedTo?: string` from Task 1 is read in Tasks 3–6.
