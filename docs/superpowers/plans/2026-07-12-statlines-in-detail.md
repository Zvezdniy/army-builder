# Statlines in Unit Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built, already-tested `UnitStatline` and `Datasheet` components into the unit detail view so the builder actually shows a unit's statline, weapons, abilities, and special rules.

**Architecture:** Web-only. The data layer (`@muster/roster` `datasheet()`/`unitLoadout()`) and the components (`apps/web/src/components/Datasheet.tsx`: `UnitStatline`, `Datasheet`) are complete and tested but never rendered. Render them inside `UnitDetail.tsx` around the existing `SelectionNode` editor. No data-layer or component changes.

**Tech Stack:** React 18 + Vite; Vitest + @testing-library/react (jsdom).

## Global Constraints

- Web-only: change ONLY `apps/web/src/components/UnitDetail.tsx` and add a test. Do NOT modify `Datasheet.tsx`, `UnitStatline`, `SelectionNode.tsx`, or `@muster/roster`.
- Composition only — the editing logic (`SelectionNode` and its callbacks) is untouched.
- Both components already null-guard (return `null` when the unit has no `Unit` profile / no weapons+right-column), so entries without statlines must not crash.
- Existing web tests stay green.
- Code/identifiers/commit messages in English. Repo stays local (do not push).

---

### Task 1: render UnitStatline + Datasheet in UnitDetail

**Files:**
- Modify: `apps/web/src/components/UnitDetail.tsx`
- Test: `apps/web/src/components/UnitDetail.test.tsx` (new)

**Interfaces:**
- Consumes: `UnitStatline`, `Datasheet` from `./Datasheet` — both take `{ catalogue: IrCatalogue; selection: RosterSelection }`. `UnitDetail` already has `sel` (the `RosterSelection`) and `catalogue` in scope.
- Produces: none (leaf UI wiring).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/UnitDetail.test.tsx`. It drives the real `App` (which loads the mini fixture) exactly like `builder.test.tsx`: add a Captain (which has a full Unit profile M/T/SV/W/LD/OC + Invulnerable Save in the mini fixture) and assert the statline is now shown; then add an Assault Squad (no profiles in the mini fixture) and assert no crash.

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

describe("UnitDetail statline wiring", () => {
  it("shows the selected unit's statline in the detail view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Captain/i }));
    // Captain's Unit statline (mini fixture: M=6", T=4, SV=3+, W=5, LD=6+, OC=1)
    // and its invulnerable save are now rendered in the detail view.
    expect(screen.getByText('6"')).toBeInTheDocument();
    expect(screen.getByText("Invulnerable Save")).toBeInTheDocument();
  });

  it("does not crash for a unit without any profiles", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Add unit/i }));
    await user.click(screen.getByRole("button", { name: /add Assault Squad/i }));
    // Assault Squad has no profiles in the mini fixture: statline/datasheet null-guard,
    // the detail view still renders its editing controls without throwing.
    expect(screen.getByRole("button", { name: /back to list/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @muster/web test -- UnitDetail.test.tsx`
Expected: the first test FAILS — `6"` / `Invulnerable Save` are not in the DOM because `UnitStatline`/`Datasheet` are not rendered yet. (The second test may already pass — that's fine; it guards the null path after the change.)

- [ ] **Step 3: Wire the components into UnitDetail**

In `apps/web/src/components/UnitDetail.tsx`:

Add the import (next to the existing component imports):

```tsx
import { Datasheet, UnitStatline } from "./Datasheet";
```

In the returned JSX, render `<UnitStatline>` after the keywords row and before the editing `<ul>`, and `<Datasheet>` after the `</ul>`. The relevant return becomes:

```tsx
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
      <UnitStatline catalogue={catalogue} selection={sel} />
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <SelectionNode roster={roster} selection={sel} catalogue={catalogue} depth={0}
          onAddOption={onAddOption} onToggleGroupMember={onToggleGroupMember}
          onRemove={onRemove} onSetCount={onSetCount} />
      </ul>
      <Datasheet catalogue={catalogue} selection={sel} />
    </section>
  );
```

(Leave everything above the `return` — `sel`, `entry`, `name`, `keywords`, the empty-selection guard — unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @muster/web test -- UnitDetail.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Run the full web suite + typecheck**

Run: `pnpm --filter @muster/web test && pnpm --filter @muster/web exec tsc --noEmit`
Expected: all green (typecheck was clean before; this adds only a render composition of already-typed components).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/UnitDetail.tsx apps/web/src/components/UnitDetail.test.tsx
git commit -m "feat(web): show unit statline and datasheet in the detail view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Wire `UnitStatline` + `Datasheet` into `UnitDetail` (statline above editor, datasheet below) → Task 1 Step 3. ✓
- Web-only, no data-layer/component changes → Task 1 touches only `UnitDetail.tsx` + its test. ✓
- Null-safety for profile-less units → Task 1 test 2 (Assault Squad). ✓
- Existing tests stay green → Task 1 Step 5. ✓

**Type consistency:** `UnitStatline`/`Datasheet` both take `{catalogue: IrCatalogue, selection: RosterSelection}`; `UnitDetail` passes `catalogue` (prop) and `sel` (the found `RosterSelection`) — matches. Import path `./Datasheet` is correct (same directory).

**Placeholder scan:** none — the full modified `return` block is shown.

## Post-merge verification (browser)

After Task 1, verify in the browser (not part of the SDD task loop):
1. Start the `web` dev server (launch config, port 5173) — it loads the mini fixture.
2. Add a Captain, confirm the statline bar (M/T/SV/W/LD/OC) + Invulnerable Save render above the wargear editor, and weapons/abilities render below.
3. Screenshot as proof.
