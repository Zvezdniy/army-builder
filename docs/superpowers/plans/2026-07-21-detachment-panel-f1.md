# Detachment Panel F1 (display) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collapsible detachment panel in the builder that shows each chosen detachment's rule(s) and enhancement list, read-only, reusing already-shipped helpers.

**Architecture:** One tiny rules-free helper `detachmentRuleTexts` in `@muster/roster`, a self-contained `DetachmentPanel` web component rendered between `<SetupBar>` and `<LegalityPanel>`, and a small CSS block. Rules come from `ruleNames`+`ruleTexts` (D); enhancements from the shipped `enhancementsForDetachment` (C); points from `pointsCost`.

**Tech Stack:** TypeScript, `@muster/roster` (Vitest, 100% coverage gate), `apps/web` React (Vitest + @testing-library/react).

## Global Constraints

- App-only. No parser, no IR schema change, no `@muster/engine-eval` change, no data republish.
- Read-only in F1 — no enhancement assignment (that is F2, out of scope).
- Reuse the wizard's existing CSS classes for content (`ds-section-head`, `preview-body`, `det-rules`, `det-rule`, `det-rule-name`, `det-rule-text`, `preview-subhead`, `preview-empty`, `enh-line`, `enh-name`, `enh-pts`) so the panel and wizard cannot drift visually. Only the collapsible shell gets new classes.
- Panel renders only when `availableDetachments(catalogue).length > 0 && selectedDetachments(roster, catalogue).length > 0`; otherwise returns `null`.
- Do NOT refactor `SetupWizard` in F1 (the optional drift-guard swap is deferred to F2 to avoid wizard test churn).
- Do NOT run `git stash` or `git add -A`; stage explicit paths. `.claude/` stays untracked. Do NOT run `scripts/update-catalogues.mjs`.
- Types: `IrCatalogue.ruleTexts?: Record<string,string>`, `IrEntry.ruleNames?: string[]`, `pointsCost(entry): IrCost | undefined`.

---

## File Structure

- `packages/roster/src/builder.ts` — add `detachmentRuleTexts` (near `enhancementsForDetachment`).
- `packages/roster/src/builder.test.ts` — unit tests.
- `apps/web/src/components/DetachmentPanel.tsx` — NEW component.
- `apps/web/src/components/DetachmentPanel.test.tsx` — NEW component tests.
- `apps/web/src/index.css` — append the collapsible-shell CSS block.
- `apps/web/src/App.tsx` — import + render `<DetachmentPanel>` between `<SetupBar>` and `<LegalityPanel>`.

---

## Task 1: `detachmentRuleTexts` helper in `@muster/roster`

**Files:**
- Modify: `packages/roster/src/builder.ts` (add near `enhancementsForDetachment`)
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Produces: `export function detachmentRuleTexts(catalogue: IrCatalogue, detachmentId: string): { name: string; text: string }[]` — Task 2 consumes it.

- [ ] **Step 1: Write the failing unit tests**

In `packages/roster/src/builder.test.ts`, add near the `enhancementsForDetachment` describe:

```ts
const ruleTextCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  ruleTexts: { "Loping Charge": "Advance and charge.", "Empty Rule": "" },
  entries: [{
    id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
    groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.saga", "e.plain"], constraints: [] }],
    children: [
      { id: "e.saga", name: "Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [], ruleNames: ["Loping Charge", "Missing Text", "Empty Rule"] },
      { id: "e.plain", name: "Plain", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
    ],
  }],
};

describe("detachmentRuleTexts", () => {
  it("resolves each ruleName to its text, dropping names with no/empty text", () => {
    expect(detachmentRuleTexts(ruleTextCat, "e.saga")).toEqual([
      { name: "Loping Charge", text: "Advance and charge." },
    ]);
  });
  it("returns [] for a detachment with no ruleNames and for an unknown id", () => {
    expect(detachmentRuleTexts(ruleTextCat, "e.plain")).toEqual([]);
    expect(detachmentRuleTexts(ruleTextCat, "e.nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `pnpm --filter @muster/roster test 2>&1 | tail -15`
Expected: FAIL — `detachmentRuleTexts is not a function`.

- [ ] **Step 3: Implement the helper**

In `packages/roster/src/builder.ts`, near `enhancementsForDetachment`, add:

```ts
/** The detachment's own rules resolved to displayable text, in declaration order,
 *  dropping any name whose text is absent or empty in `ruleTexts`. Shared by the
 *  wizard preview and the builder's detachment panel so they render identical rules. */
export function detachmentRuleTexts(
  catalogue: IrCatalogue, detachmentId: string,
): { name: string; text: string }[] {
  const det = availableDetachments(catalogue).find((d) => d.id === detachmentId);
  if (det === undefined) return [];
  const out: { name: string; text: string }[] = [];
  for (const name of det.ruleNames ?? []) {
    const text = catalogue.ruleTexts?.[name];
    if (typeof text === "string" && text.length > 0) out.push({ name, text });
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
feat(roster): detachmentRuleTexts helper

Resolves a detachment's ruleNames to displayable {name,text}, dropping names
with no text in ruleTexts. Shared by the wizard and the upcoming builder
detachment panel so their rule blocks can't drift.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `DetachmentPanel` component + App wiring + CSS

**Files:**
- Create: `apps/web/src/components/DetachmentPanel.tsx`
- Create: `apps/web/src/components/DetachmentPanel.test.tsx`
- Modify: `apps/web/src/index.css` (append)
- Modify: `apps/web/src/App.tsx` (import + render between `<SetupBar>` and `<LegalityPanel>`)

**Interfaces:**
- Consumes: `detachmentRuleTexts` (Task 1), `enhancementsForDetachment`, `availableDetachments`, `selectedDetachments` (`@muster/roster`), `pointsCost` (`@muster/engine-eval`).

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/src/components/DetachmentPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
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
      children: [
        { id: "e.saga", name: "Legends of Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [], ruleNames: ["Loping Charge"] },
      ],
    },
    { id: "e.hero", name: "Hero", type: "model", costs: [], categories: [], constraints: [], children: [
      { id: "e.enh", name: "Thirst for Glory", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.saga")] },
    ] },
  ],
};

describe("DetachmentPanel", () => {
  it("renders nothing when no detachment is chosen", () => {
    const { container } = render(<DetachmentPanel catalogue={cat} roster={createRoster(cat, 2000)} />);
    expect(container.firstChild).toBeNull();
  });
  it("is collapsed by default and reveals rule + enhancement on expand", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.saga", cat);
    render(<DetachmentPanel catalogue={cat} roster={roster} />);
    // Collapsed: content hidden.
    expect(screen.queryByText("Advance and charge.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    // Expanded: rule text + enhancement name + points shown.
    expect(screen.getByText("Advance and charge.")).toBeTruthy();
    expect(screen.getByText("Thirst for Glory")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @muster/web test DetachmentPanel 2>&1 | tail -15`
Expected: FAIL — module `./DetachmentPanel` not found.

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/DetachmentPanel.tsx`:

```tsx
import { useState } from "react";
import type { IrCatalogue, IrEntry, Roster } from "@muster/domain";
import { availableDetachments, selectedDetachments, detachmentRuleTexts, enhancementsForDetachment } from "@muster/roster";
import { pointsCost } from "@muster/engine-eval";

/** A collapsible builder panel showing each chosen detachment's rule(s) and the
 *  enhancements it unlocks (read-only). Renders nothing unless the catalogue models
 *  detachments and at least one is chosen. Reuses the wizard's content CSS classes. */
export function DetachmentPanel({ catalogue, roster }: { catalogue: IrCatalogue; roster: Roster }) {
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
                    <div key={e.id} className="enh-line">
                      <span className="enh-name">{e.name}</span>
                      <span className="enh-pts">{pointsCost(e)?.value ?? 0}</span>
                    </div>
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

- [ ] **Step 4: Append the collapsible-shell CSS**

Append to `apps/web/src/index.css`:

```css
/* Detachment panel in the builder (collapsible shell; content reuses the wizard's
   .det-preview-section / .preview-body / .det-rules / .enh-line classes). */
.det-panel { border: 1px solid var(--line); border-radius: 10px; margin: 10px 0; overflow: hidden; }
.det-panel-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px;
  background: none; border: none; cursor: pointer; text-align: left; font: inherit; color: var(--ink); }
.det-panel-caret { color: var(--muted); width: 12px; }
.det-panel-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.det-panel-names { font-weight: 600; font-size: 13px; }
.det-panel-body { border-top: 1px solid var(--line); }
```

- [ ] **Step 5: Wire it into `App.tsx`**

In `apps/web/src/App.tsx`, add the import beside the other component imports (near `import { SetupBar } from "./components/SetupBar";`):

```ts
import { DetachmentPanel } from "./components/DetachmentPanel";
```

Then render it between `<SetupBar … />` and `<LegalityPanel …>`:

```tsx
      <SetupBar catalogue={catalogue} roster={roster} onEdit={openWizardAt}
        registry={registry} activeDescriptorId={activeDescriptorId} />
      <DetachmentPanel catalogue={catalogue} roster={roster} />
      <LegalityPanel
```

- [ ] **Step 6: Run the component test to verify it PASSES**

Run: `pnpm --filter @muster/web test DetachmentPanel 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 7: Full web typecheck + test + roster suite**

Run: `pnpm --filter @muster/web typecheck && pnpm --filter @muster/web test && pnpm --filter @muster/roster test 2>&1 | tail -8`
Expected: all green (no unused imports; existing App/SetupWizard tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/DetachmentPanel.tsx apps/web/src/components/DetachmentPanel.test.tsx \
        apps/web/src/index.css apps/web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(web): collapsible detachment panel in the builder

Shows each chosen detachment's rule(s) and unlocked enhancements (read-only)
directly on the builder screen, between the setup bar and the legality panel.
Collapsed by default. Reuses detachmentRuleTexts + enhancementsForDetachment
and the wizard's content CSS. Interactive assignment is F2.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Browser verification (controller-executed)

- [ ] With the web dev server on local repacked data (`VITE_CATALOGUES_BASE=/`, restore `.env.local` after), open the builder for 11th Edition Adepta Sororitas, choose **Army of Faith** in the wizard, press **Start building**, and confirm the collapsed **Detachment** panel appears under the setup bar. Expand it and confirm it shows *Sacred Rites* with its text and the four enhancements (Blade of Saint Ellynor, Divine Aspect, Litanies of Faith, Triptych of the Macharian Crusade). Screenshot as proof.

---

## Self-Review notes

- **Spec coverage:** helper `detachmentRuleTexts` (Task 1) → panel component reusing it + `enhancementsForDetachment` + `pointsCost`, wired in App, collapsed-by-default (Task 2) → browser proof (Task 3). Render-condition (`null` when no detachment) and two-detachment sub-sections covered by Task 2 tests.
- **Type consistency:** `detachmentRuleTexts(catalogue, detachmentId): {name,text}[]` defined Task 1, consumed Task 2. `IrEntry` type-guard import in the component. `pointsCost(e)?.value ?? 0` identical to the wizard.
- **No placeholders / no wizard churn:** the wizard is untouched in F1 (drift-guard deferred to F2). All code + fixtures are complete.
