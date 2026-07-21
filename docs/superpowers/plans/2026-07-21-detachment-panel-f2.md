# Detachment Panel F2 (interactive enhancement assignment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the detachment panel's enhancement rows interactive — assign an enhancement to a roster Character (via the existing `toggleGroupMember`), show `on <unit>`, remove it, and offer an inline menu when several Characters are eligible.

**Architecture:** A new rules-free `enhancementTargets` helper in `@muster/roster` locates, for an enhancement, the roster unit(s) whose subtree owns an `…Enhancements` group containing it. `DetachmentPanel` renders each enhancement row in one of three states using it, calling the same `toggleGroupMember`/`setSelectedUnitId` callbacks the unit config already uses.

**Tech Stack:** TypeScript, `@muster/roster` (Vitest, 100% coverage gate), `apps/web` React (Vitest + @testing-library/react).

## Global Constraints

- App-only. No parser, no IR schema change, no `@muster/engine-eval` change, no data republish.
- Assignment goes through the EXISTING `toggleGroupMember(roster, parentSelectionId, group, entryId, catalogue)` path — no new mutation code in the roster package beyond the read-only `enhancementTargets`.
- The army-wide Enhancements cap is NOT enforced in the panel — assign freely; legality reports overage ("show, never block", like the Detachment Points meter).
- Group name match: `group.name.endsWith("Enhancements")` (covers `"Enhancements"` and `"<Detachment> Enhancements"`).
- `enhancementTargets` skips the detachment-root subtree (via `detachmentSelectionIds`) and walks each other top-level unit's whole subtree, returning the OWNING node's selection id as `parentSelectionId`.
- Do NOT run `git stash` or `git add -A`; stage explicit paths. `.claude/` stays untracked. Do NOT run `scripts/update-catalogues.mjs`.
- Types: `RosterSelection { id, entryId, count, selections }`; `catalogueEntry(catalogue, entryId): IrEntry | undefined`; `detachmentSelectionIds(roster, catalogue): Set<string>`.

---

## File Structure

- `packages/roster/src/builder.ts` — add `enhancementTargets` (near `enhancementsForDetachment` / `catalogueEntry`).
- `packages/roster/src/builder.test.ts` — unit tests.
- `apps/web/src/components/DetachmentPanel.tsx` — add props + interactive `EnhancementRow`.
- `apps/web/src/components/DetachmentPanel.test.tsx` — interactive tests.
- `apps/web/src/index.css` — append interactive-row CSS.
- `apps/web/src/App.tsx` — pass `onSelectUnit` + `onToggleGroupMember` to `<DetachmentPanel>`.

---

## Task 1: `enhancementTargets` helper in `@muster/roster`

**Files:**
- Modify: `packages/roster/src/builder.ts`
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Produces: `export function enhancementTargets(roster: Roster, catalogue: IrCatalogue, enhancementEntryId: string): { unitSelectionId: string; unitName: string; parentSelectionId: string; group: IrGroup; taken: boolean }[]` — Task 2 consumes it.

- [ ] **Step 1: Write the failing unit tests**

In `packages/roster/src/builder.test.ts`, add:

```ts
// A catalogue where a Character hosts an "Enhancements" group containing e.enh, gated to
// detachment e.saga; enhancementTargets must find the Character and report taken/parent.
const enhHostCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.saga"], constraints: [] }],
      children: [{ id: "e.saga", name: "Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
    },
    {
      id: "e.canoness", name: "Canoness", type: "model", costs: [{ name: "pts", value: 50 }], categories: ["cat.char"], constraints: [],
      groups: [{ id: "g.enh", name: "Enhancements", memberEntryIds: ["e.enh"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
      children: [{ id: "e.enh", name: "Relic Blade", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [] }],
    },
  ],
};

describe("enhancementTargets", () => {
  it("finds a hosting Character, reports taken false→true and the owning parent id", () => {
    let r = addUnit(createRoster(enhHostCat, 2000), "e.canoness", enhHostCat);
    const unitSel = r.selections.find((s) => s.entryId === "e.canoness")!;
    const before = enhancementTargets(r, enhHostCat, "e.enh");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ unitSelectionId: unitSel.id, unitName: "Canoness", parentSelectionId: unitSel.id, taken: false });
    expect(before[0]!.group.id).toBe("g.enh");
    // Assign via the same path the panel uses, then it reports taken:true.
    r = toggleGroupMember(r, unitSel.id, before[0]!.group, "e.enh", enhHostCat);
    expect(enhancementTargets(r, enhHostCat, "e.enh")[0]!.taken).toBe(true);
  });
  it("returns [] when no roster unit hosts the group, and two targets for two Characters", () => {
    expect(enhancementTargets(createRoster(enhHostCat, 2000), enhHostCat, "e.enh")).toEqual([]);
    let r = addUnit(createRoster(enhHostCat, 2000), "e.canoness", enhHostCat);
    r = addUnit(r, "e.canoness", enhHostCat);
    expect(enhancementTargets(r, enhHostCat, "e.enh")).toHaveLength(2);
  });
  it("skips the detachment-root subtree", () => {
    const r = toggleDetachment(createRoster(enhHostCat, 2000), "e.saga", enhHostCat);
    // The detachment root has no Enhancements group anyway, but assert no target leaks from it.
    expect(enhancementTargets(r, enhHostCat, "e.enh")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `pnpm --filter @muster/roster test 2>&1 | tail -15`
Expected: FAIL — `enhancementTargets is not a function`.

- [ ] **Step 3: Implement the helper**

In `packages/roster/src/builder.ts`, near `enhancementsForDetachment`, add:

```ts
/** For one enhancement, every roster unit that can host it: where to toggle it and
 *  whether it is currently on. Walks each top-level unit's subtree (skipping the
 *  detachment-root subtree) for a node whose catalogue entry has an "…Enhancements"
 *  group containing `enhancementEntryId`; returns the OWNING node as the
 *  toggleGroupMember parent. */
export function enhancementTargets(
  roster: Roster, catalogue: IrCatalogue, enhancementEntryId: string,
): { unitSelectionId: string; unitName: string; parentSelectionId: string; group: IrGroup; taken: boolean }[] {
  const detIds = detachmentSelectionIds(roster, catalogue);
  const out: { unitSelectionId: string; unitName: string; parentSelectionId: string; group: IrGroup; taken: boolean }[] = [];
  for (const unit of roster.selections) {
    if (detIds.has(unit.id)) continue;
    const unitName = catalogueEntry(catalogue, unit.entryId)?.name ?? unit.entryId;
    const stack: RosterSelection[] = [unit];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const entry = catalogueEntry(catalogue, node.entryId);
      for (const group of entry?.groups ?? []) {
        if (group.name.endsWith("Enhancements") && group.memberEntryIds.includes(enhancementEntryId)) {
          out.push({
            unitSelectionId: unit.id, unitName,
            parentSelectionId: node.id, group,
            taken: node.selections.some((s) => s.entryId === enhancementEntryId),
          });
        }
      }
      stack.push(...node.selections);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they PASS**

Run: `pnpm --filter @muster/roster test 2>&1 | tail -15`
Expected: PASS, 100% coverage maintained.

- [ ] **Step 5: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): enhancementTargets — roster units that can host an enhancement

Walks each top-level unit's subtree (skipping the detachment root) for a node
whose entry has an "…Enhancements" group containing the enhancement, returning
the owning node as the toggleGroupMember parent plus a taken flag. Read-only;
assignment stays on the existing toggleGroupMember path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Interactive `DetachmentPanel` rows + App wiring + CSS

**Files:**
- Modify: `apps/web/src/components/DetachmentPanel.tsx`
- Modify: `apps/web/src/components/DetachmentPanel.test.tsx`
- Modify: `apps/web/src/index.css` (append)
- Modify: `apps/web/src/App.tsx` (pass two callbacks)

**Interfaces:**
- Consumes: `enhancementTargets` (Task 1), `toggleGroupMember` path via App callbacks.

- [ ] **Step 1: Write the failing interactive component tests**

Replace the body of `apps/web/src/components/DetachmentPanel.test.tsx` with (keeps F1's null + collapsed checks, adds interactivity). Reuse `selGate` from F1's test; extend the fixture with a Character hosting the enhancement group, and pass the two new props:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment, addUnit } from "@muster/roster";
import { DetachmentPanel } from "./DetachmentPanel";

function selGate(detId: string) {
  return { set: true, conditionGroups: [{ type: "and" as const, conditions: [{
    id: `c.${detId}`, comparator: "lessThan" as const, value: 1, field: "selections" as const,
    scope: "roster", targetType: "entry" as const, targetId: detId, includeChildSelections: true,
  }] }] };
}
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  ruleTexts: { "Loping Charge": "Advance and charge." },
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.saga"], constraints: [] }],
      children: [{ id: "e.saga", name: "Legends of Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [], ruleNames: ["Loping Charge"] }],
    },
    {
      id: "e.canoness", name: "Canoness", type: "model", costs: [{ name: "pts", value: 50 }], categories: [], constraints: [],
      groups: [{ id: "g.enh", name: "Enhancements", memberEntryIds: ["e.enh"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
      children: [{ id: "e.enh", name: "Thirst for Glory", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.saga")] }],
    },
  ],
};
const noop = () => {};
function withDet() { return toggleDetachment(createRoster(cat, 2000), "e.saga", cat); }

describe("DetachmentPanel", () => {
  it("renders nothing when no detachment is chosen", () => {
    const { container } = render(<DetachmentPanel catalogue={cat} roster={createRoster(cat, 2000)} onSelectUnit={noop} onToggleGroupMember={noop} />);
    expect(container.firstChild).toBeNull();
  });
  it("collapsed by default; expands to rule + enhancement", () => {
    render(<DetachmentPanel catalogue={cat} roster={withDet()} onSelectUnit={noop} onToggleGroupMember={noop} />);
    expect(screen.queryByText("Advance and charge.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText("Advance and charge.")).toBeTruthy();
    expect(screen.getByText("Thirst for Glory")).toBeTruthy();
  });
  it("shows a hint when no Character is in the roster", () => {
    render(<DetachmentPanel catalogue={cat} roster={withDet()} onSelectUnit={noop} onToggleGroupMember={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText(/add a character/i)).toBeTruthy();
  });
  it("assigns to the single eligible Character on click", () => {
    const onToggle = vi.fn(); const onSelect = vi.fn();
    const roster = addUnit(withDet(), "e.canoness", cat);
    const unitSel = roster.selections.find((s) => s.entryId === "e.canoness")!;
    render(<DetachmentPanel catalogue={cat} roster={roster} onSelectUnit={onSelect} onToggleGroupMember={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    fireEvent.click(screen.getByRole("button", { name: "Thirst for Glory" }));
    expect(onToggle).toHaveBeenCalledWith(unitSel.id, expect.objectContaining({ id: "g.enh" }), "e.enh");
    expect(onSelect).toHaveBeenCalledWith(unitSel.id);
  });
  it("shows `on <unit>` and removes when already assigned", () => {
    const onToggle = vi.fn();
    let roster = addUnit(withDet(), "e.canoness", cat);
    const unitSel = roster.selections.find((s) => s.entryId === "e.canoness")!;
    // Pre-assign the enhancement by nesting it under the Canoness.
    roster = { ...roster, selections: roster.selections.map((s) => s.id !== unitSel.id ? s
      : { ...s, selections: [...s.selections, { id: "sel.enh", entryId: "e.enh", count: 1, selections: [] }] }) };
    render(<DetachmentPanel catalogue={cat} roster={roster} onSelectUnit={noop} onToggleGroupMember={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText(/on Canoness/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /on Canoness/i }));
    expect(onToggle).toHaveBeenCalledWith(unitSel.id, expect.objectContaining({ id: "g.enh" }), "e.enh");
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @muster/web test DetachmentPanel 2>&1 | tail -20`
Expected: FAIL — the panel does not yet accept `onSelectUnit`/`onToggleGroupMember` and renders no interactive rows.

- [ ] **Step 3: Rewrite `DetachmentPanel.tsx` with the interactive row**

Replace `apps/web/src/components/DetachmentPanel.tsx` with:

```tsx
import { useState } from "react";
import type { IrCatalogue, IrEntry, IrGroup, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments, detachmentRuleTexts, enhancementsForDetachment, enhancementTargets } from "@muster/roster";
import { pointsCost } from "@muster/engine-eval";

type Target = ReturnType<typeof enhancementTargets>[number];

/** One enhancement row: assigned (`on <unit>`, click to select / remove), assignable
 *  (click to assign; inline menu if several eligible units), or a muted hint. */
function EnhancementRow({ enhancement, catalogue, roster, onSelectUnit, onToggleGroupMember }: {
  enhancement: IrEntry; catalogue: IrCatalogue; roster: Roster;
  onSelectUnit: (selectionId: string) => void;
  onToggleGroupMember: (parentSelectionId: string, group: IrGroup, entryId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const targets = enhancementTargets(roster, catalogue, enhancement.id);
  const taken = targets.find((t) => t.taken);
  const pts = pointsCost(enhancement)?.value ?? 0;
  const assign = (t: Target) => { onToggleGroupMember(t.parentSelectionId, t.group, enhancement.id); onSelectUnit(t.unitSelectionId); };

  return (
    <div className="enh-line">
      {taken ? (
        <>
          <button className="enh-name enh-link" onClick={() => onSelectUnit(taken.unitSelectionId)}>{enhancement.name}</button>
          <button className="enh-on" onClick={() => onToggleGroupMember(taken.parentSelectionId, taken.group, enhancement.id)}>on {taken.unitName} ✕</button>
        </>
      ) : targets.length === 0 ? (
        <>
          <span className="enh-name">{enhancement.name}</span>
          <span className="enh-hint">Add a Character to take this</span>
        </>
      ) : targets.length === 1 ? (
        <button className="enh-name enh-link" onClick={() => assign(targets[0]!)}>{enhancement.name}</button>
      ) : (
        <span className="enh-assignable">
          <button className="enh-name enh-link" onClick={() => setMenuOpen((o) => !o)}>{enhancement.name}</button>
          {menuOpen && (
            <span className="enh-menu">
              {targets.map((t) => (
                <button key={t.parentSelectionId} onClick={() => { assign(t); setMenuOpen(false); }}>{t.unitName}</button>
              ))}
            </span>
          )}
        </span>
      )}
      <span className="enh-pts">{pts}</span>
    </div>
  );
}

/** A collapsible builder panel showing each chosen detachment's rule(s) and the
 *  enhancements it unlocks, with interactive assignment to roster Characters.
 *  Renders nothing unless the catalogue models detachments and at least one is chosen. */
export function DetachmentPanel({ catalogue, roster, onSelectUnit, onToggleGroupMember }: {
  catalogue: IrCatalogue; roster: Roster;
  onSelectUnit: (selectionId: string) => void;
  onToggleGroupMember: (parentSelectionId: string, group: IrGroup, entryId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const detachments = availableDetachments(catalogue);
  const chosenIds = selectedDetachments(roster, catalogue);
  if (detachments.length === 0 || chosenIds.length === 0) return null;

  const chosen = chosenIds
    .map((id) => detachments.find((d) => d.id === id))
    .filter((d): d is IrEntry => d !== undefined);

  return (
    <div className="det-panel" data-testid="detachment-panel">
      <button className="det-panel-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="det-panel-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="det-panel-title">Detachment</span>
        <span className="det-panel-names">{chosen.map((d) => d.name).join(", ")}</span>
      </button>
      {open && (
        <div className="det-panel-body">
          {chosen.map((det) => {
            const rules = detachmentRuleTexts(catalogue, det.id);
            const enhancements = enhancementsForDetachment(catalogue, det.id);
            return (
              <div key={det.id} className="det-preview-section">
                <div className="ds-section-head">{det.name}</div>
                <div className="preview-body">
                  {rules.length > 0 && (
                    <div className="det-rules">
                      {rules.map((r) => (
                        <div key={r.name} className="det-rule">
                          <div className="det-rule-name">{r.name}</div>
                          <p className="det-rule-text">{r.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="preview-subhead">Enhancements</div>
                  {enhancements.length === 0 && <div className="preview-empty">No enhancements.</div>}
                  {enhancements.map((e) => (
                    <EnhancementRow key={e.id} enhancement={e} catalogue={catalogue} roster={roster}
                      onSelectUnit={onSelectUnit} onToggleGroupMember={onToggleGroupMember} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append interactive-row CSS**

Append to `apps/web/src/index.css`:

```css
/* Interactive enhancement rows in the detachment panel (F2). */
.enh-link { background: none; border: none; padding: 0; font: inherit; color: var(--accent, #6ea8fe); cursor: pointer; text-align: left; }
.enh-link:hover { text-decoration: underline; }
.enh-on { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; font: inherit; font-size: 11.5px; color: var(--ink); cursor: pointer; }
.enh-on:hover { border-color: var(--accent, #6ea8fe); }
.enh-hint { color: var(--muted); font-size: 11.5px; font-style: italic; }
.enh-assignable { position: relative; display: inline-flex; }
.enh-menu { position: absolute; top: 100%; left: 0; z-index: 5; display: flex; flex-direction: column;
  max-height: 160px; overflow-y: auto; background: var(--head-bg); border: 1px solid var(--line); border-radius: 8px; }
.enh-menu button { background: none; border: none; padding: 6px 10px; font: inherit; color: var(--ink); cursor: pointer; text-align: left; white-space: nowrap; }
.enh-menu button:hover { background: var(--line); }
```

- [ ] **Step 5: Wire the two callbacks in `App.tsx`**

In `apps/web/src/App.tsx`, update the `<DetachmentPanel>` render to pass the callbacks (the `onToggleGroupMember` is the identical one already given to `<UnitDetail>`):

```tsx
      <DetachmentPanel catalogue={catalogue} roster={roster}
        onSelectUnit={setSelectedUnitId}
        onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))} />
```

- [ ] **Step 6: Run the component tests to verify they PASS**

Run: `pnpm --filter @muster/web test DetachmentPanel 2>&1 | tail -20`
Expected: PASS (all five cases: null, collapsed, hint, assign-single, on-unit + remove).

- [ ] **Step 7: Full web typecheck + test + roster suite**

Run: `pnpm --filter @muster/web typecheck && pnpm --filter @muster/web test && pnpm --filter @muster/roster test 2>&1 | tail -8`
Expected: all green. (App.test.tsx may need no change; if it renders `<DetachmentPanel>` indirectly it already gets the new props via App — verify App passes them.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/DetachmentPanel.tsx apps/web/src/components/DetachmentPanel.test.tsx \
        apps/web/src/index.css apps/web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(web): interactive enhancement assignment in the detachment panel

Enhancement rows now assign to a roster Character (via the existing
toggleGroupMember path), show `on <unit>` with click-to-select and
click-to-remove, and offer an inline menu when several Characters are
eligible; a muted hint when none are. The army Enhancements cap stays the
legality panel's job.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Browser verification (controller-executed)

- [ ] With the web dev server on local repacked data (`VITE_CATALOGUES_BASE=/`, restore `.env.local` after): 11e Adepta Sororitas, choose **Army of Faith**, Start building, **+ Add unit → Canoness**. Open the detachment panel: `Blade of Saint Ellynor` is assignable — click it, confirm the row becomes `on Canoness` and the Canoness's unit config shows the same enhancement selected. Click the `on Canoness` marker to remove it. Screenshot as proof.

---

## Self-Review notes

- **Spec coverage:** `enhancementTargets` (Task 1) → three interactive row states + inline menu + App wiring (Task 2) → browser proof (Task 3). Skip-detachment-root, two-targets, taken-toggle covered by Task 1; assign-single, on-unit+remove, hint covered by Task 2.
- **Type consistency:** `enhancementTargets(roster, catalogue, enhancementEntryId)` shape defined Task 1, consumed Task 2 (`Target = ReturnType<...>[number]`). `onToggleGroupMember(parentSelectionId, group, entryId)` matches App's existing `toggleGroupMember` call.
- **One mutation path:** the panel calls the same `toggleGroupMember` App gives `<UnitDetail>` — no second assignment code path.
