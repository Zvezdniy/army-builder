# Seed an Option's Required Children on Pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a user picks a wargear/loadout option in the builder, seed its mandatory sub-parts (required children) so the datasheet and points are correct — fixing a general builder-seeding bug across all factions.

**Architecture:** Give `addOption` and `toggleGroupMember` an optional `catalogue` (mirroring `addUnit`); when present, seed the added option's `initialChildren(entry)`. The web passes the catalogue it already has. Optional param keeps existing catalogue-less tests unchanged.

**Tech Stack:** TypeScript (strict), Vitest, React (Vite). Pure, immutable `@muster/roster`.

## Global Constraints

- `@muster/roster` is pure/immutable — no input mutation.
- `catalogue` is OPTIONAL on both functions; without it, behavior is the pre-fix bare add (backward-compat for existing tests).
- Reuse `initialChildren(entry)` verbatim — do NOT reimplement seeding. It already handles group defaults, `min>=1` options, and counted-group model instances recursively.
- Preserve the counted-group one-model-per-node invariant (a counted member = N one-each selections, never a count-N node).
- Unresolvable option entryId → bare add (no crash), same guard `addUnit` uses (`catalogueEntry` returns undefined → no `initialChildren`).
- No push to origin. Merge to LOCAL main only.

---

### Task 1: Seed required children in `addOption` / `toggleGroupMember`

**Files:**
- Modify: `packages/roster/src/builder.ts` (`addOption` ~line 34; `toggleGroupMember` ~line 432)
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Consumes: `initialChildren(entry)`, `catalogueEntry(catalogue, id)`, `freshSelection`, `mapTree` (all already in builder.ts); `IrCatalogue` (already imported).
- Produces: `addOption(roster, parentSelectionId, entryId, catalogue?: IrCatalogue)` and `toggleGroupMember(roster, parentSelectionId, group, entryId, catalogue?: IrCatalogue)` — both gain a trailing optional `catalogue`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/roster/src/builder.test.ts` (the file already imports `addOption`, `toggleGroupMember`, `addUnit`, `createRoster`, `catalogueEntry`, `IrCatalogue`, `IrGroup`). Add a describe block. Build a local catalogue with a `min:1` required child and a required choose-1 group.

```ts
describe("addOption/toggleGroupMember seed required children", () => {
  // Option "mount" has a mandatory child "shield" (min:1). "shield" itself has a
  // mandatory grandchild "gem" (min:1). Option "plain" has an optional child only.
  // A choose-1 required group under "banner" seeds its default member.
  const req = (id: string, extra: any = {}) => ({
    id, name: id, costs: [], categories: [],
    constraints: [{ id: `${id}.min`, type: "min", value: 1, field: "selections", scope: "parent" },
                  { id: `${id}.max`, type: "max", value: 1, field: "selections", scope: "parent" }],
    children: [], ...extra,
  });
  const opt = (id: string, extra: any = {}) => ({
    id, name: id, costs: [], categories: [], constraints: [], children: [], ...extra,
  });

  const cat: IrCatalogue = {
    id: "cat", name: "Cat", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      {
        id: "hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [
          // pickable option carrying a required child, which carries a required grandchild
          opt("mount", { children: [ req("shield", { children: [ req("gem") ] }) ] }),
          // pickable option with only an OPTIONAL child (no min) → seeds nothing
          opt("plain", { children: [ opt("trinket") ] }),
          // pickable option with a required choose-1 group (default member seeded)
          opt("banner", {
            children: [ opt("gold"), opt("silver") ],
            groups: [{ id: "g.col", name: "Colour", memberEntryIds: ["gold", "silver"],
                       defaultMemberEntryId: "gold",
                       constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" },
                                     { id: "gc.max", type: "max", value: 1, scope: "self" }] }],
          }),
        ],
        groups: [{ id: "g.mount", name: "Mount", memberEntryIds: ["mount"],
                   constraints: [{ id: "gm.max", type: "max", value: 1, scope: "self" }] }],
      },
    ],
  };
  const mountGroup = cat.entries[0]!.groups![0]!;

  const withHero = () => {
    const r = addUnit(createRoster(cat, 2000), "hero", cat);
    return { r, heroId: r.selections[r.selections.length - 1]!.id };
  };
  const childrenOf = (sel: any, entryId: string) =>
    sel.selections.find((c: any) => c.entryId === entryId)?.selections ?? [];

  it("addOption seeds a picked option's required child (and recurses to the grandchild)", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "mount", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    const shield = childrenOf(hero, "mount");
    expect(shield.map((c: any) => c.entryId)).toEqual(["shield"]);
    expect(shield[0].selections.map((c: any) => c.entryId)).toEqual(["gem"]); // grandchild seeded
  });

  it("addOption seeds a required choose-1 group's default member", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "banner", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "banner").map((c: any) => c.entryId)).toEqual(["gold"]);
  });

  it("addOption seeds nothing for an option with only optional children", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "plain", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "plain")).toEqual([]);
  });

  it("toggleGroupMember seeds the added member's required children", () => {
    const { r, heroId } = withHero();
    const r2 = toggleGroupMember(r, heroId, mountGroup, "mount", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount").map((c: any) => c.entryId)).toEqual(["shield"]);
  });

  it("backward-compat: addOption WITHOUT a catalogue seeds nothing", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "mount"); // no catalogue arg
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount")).toEqual([]);
  });

  it("backward-compat: toggleGroupMember WITHOUT a catalogue seeds nothing", () => {
    const { r, heroId } = withHero();
    const r2 = toggleGroupMember(r, heroId, mountGroup, "mount"); // no catalogue arg
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/roster test -- builder.test`
Expected: the four "seeds …" tests FAIL (children empty); the two backward-compat tests PASS.

- [ ] **Step 3: Implement — `addOption`**

Replace the current `addOption` (the bare 4-line body) with the seeding version, mirroring `addUnit`:

```ts
/** Nest an option (child selection) under `parentSelectionId`. With a `catalogue`, the
 *  option is prepopulated with its default/required loadout (`initialChildren`), the way
 *  `addUnit` seeds a root unit — so a picked option arrives with its mandatory sub-parts
 *  (weapons, shields, abilities). Without a catalogue it is added bare (legacy callers). */
export function addOption(
  roster: Roster,
  parentSelectionId: string,
  entryId: string,
  catalogue?: IrCatalogue,
): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, selection],
    })),
  };
}
```

- [ ] **Step 4: Implement — `toggleGroupMember`**

Add the trailing `catalogue?: IrCatalogue` param to the signature and forward it in the two add-path calls:

```ts
export function toggleGroupMember(
  roster: Roster,
  parentSelectionId: string,
  group: IrGroup,
  entryId: string,
  catalogue?: IrCatalogue,
): Roster {
```
…and at the bottom:
```ts
  if (members.length < max) return addOption(roster, parentSelectionId, entryId, catalogue);
  if (max === 1) return addOption(remove(roster, members[0]!.id), parentSelectionId, entryId, catalogue);
  return roster;
```
Leave the `already`/deselect/no-op branches untouched. Update the function's doc comment to note that a picked member is seeded with its required loadout when a catalogue is supplied.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @muster/roster test` (full package — coverage gate must stay green)
Expected: all tests PASS incl. the new ones; 100% coverage; typecheck via `pnpm --filter @muster/roster typecheck` clean. If coverage dips on a new branch, add a focused test (no implementation change).

- [ ] **Step 6: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "fix(roster): seed a picked option's required children (addOption/toggleGroupMember)"
```

---

### Task 2: Web wiring + real-data verification

**Files:**
- Modify: `apps/web/src/App.tsx` (the two handler lines ~146-147)
- Verification: throwaway scratchpad script (NOT committed).

**Interfaces:**
- Consumes: Task 1's `addOption(..., catalogue)` / `toggleGroupMember(..., catalogue)`.

- [ ] **Step 1: Pass the catalogue from the web handlers**

In `apps/web/src/App.tsx`, `catalogue` is already in scope (and already passed to `setGroupMemberCount` on the next line). Change:
```ts
onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid))}
onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid))}
```
to:
```ts
onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid, catalogue))}
onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))}
```

- [ ] **Step 2: Typecheck, build, test the web**

Run: `pnpm --filter web typecheck && pnpm --filter web test` (and `pnpm --filter web build`).
Expected: green. If a web test simulated a pick and asserted a bare tree, update it to expect the newly-seeded required children (this is the intended fix, not a regression) — but only if such a test exists; do not invent changes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "fix(web): pass catalogue so picked options seed their required loadout"
```

- [ ] **Step 4: Real-data verification (Space Wolves)**

Reuse the packed SW IR at the scratchpad path from the invuln work (`space-wolves.ir.json`; re-pack via `cargo run --release --bin muster-parse "<SW.cat>" "<Space Marines.cat>" "<gst>"` if absent — inputs under the scratchpad `bsdata-full/`). Write a tsx script that, via the REAL builder WITH the catalogue:
- For the earlier-measured set of 114 options with a required child: pick each (add its parent unit, then `addOption(r, parentSel, optId, cat)` under a selection that offers it) and count how many STILL end up with the required child missing. Assert this is ~0 (down from 114).
- Spot-check: Thunderwolf Cavalry, add the `Thunderwolf w/ storm shield` mount via the builder → assert the `Storm shield` ability is now in the tree and `invulnSave(cat, unitSel)` → `4+`. Also `Grey Hunter` option → `Bolt Carbine` seeded.
- Counted invariant: seed a Terminator-type squad and confirm each model is a distinct one-each node (no count-N inflation) and points are sane.

- [ ] **Step 5: Record the numbers**

Write the before/after dropped-child count and the spot-checks into the SDD ledger Task 2 line (feeds the final report). No commit.

---

## Self-Review notes

- Spec coverage: Task 1 = seeding + backward-compat + recursion + group-default (spec §Testing 1-7); Task 2 = web wiring + real-data (spec §Testing 8).
- Type consistency: both functions gain the same trailing `catalogue?: IrCatalogue`; web passes the in-scope `catalogue`.
- No placeholders: all code complete; test fixtures inline.
