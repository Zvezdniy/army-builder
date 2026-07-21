# Stratagems S-C — UI Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collapsible read-only Stratagem panel in the builder — Core + per-selected-detachment stratagems with full effect text — fed by fetched Wahapedia data through S-B's selection.

**Architecture:** A safe HTML renderer (`renderStratagemHtml`, allowlist via `DOMParser`, no dependency), a degrade-never-throw data loader (`stratagemRegistry.ts`, mirroring `catalogueRegistry`), a `StratagemPanel` component (styled like `DetachmentPanel`, driven by S-B's `selectStratagems` + `selectedDetachmentNames`), and `App.tsx` wiring (load on mount + faction change, render beside `DetachmentPanel`). App-only; no domain/roster/parser change.

**Tech Stack:** React + TypeScript (strict), Vitest + @testing-library/react (jsdom). No new dependencies.

## Global Constraints

- **App-only.** No change to `packages/*` — S-B already exposes `selectStratagems`, `stratagemFileForSlug`, `loadStratagemFile`, `loadStratagemManifest` (domain) and `selectedDetachmentNames` (roster). Import them.
- **No new dependency.** HTML is rendered via the browser's `DOMParser` + an allowlist walk — never `dangerouslySetInnerHTML`, never any attribute copied, `<script>`/`<style>` dropped.
- **Degrade, never throw.** Every fetch/parse path returns `undefined`/core-only on failure (missing manifest, 404, bad JSON, no `fetch`), exactly like `loadRegistry`/`loadCatalogueFor`. The panel renders nothing when data is undefined.
- **Data served from `CATALOGUES_BASE`** (the same base the catalogue library uses): manifest at `${base}stratagems.json`, files at `${base}${file}`.
- **Web tests run under jsdom, no coverage gate** — write meaningful component/loader tests, not to a threshold. Reuse the `fakeFetch(routes)` helper pattern from `catalogueRegistry.test.ts` and the `render/screen/fireEvent` pattern from `DetachmentPanel.test.tsx`.
- **Reuse existing CSS classes** where they fit (`det-panel`, `det-panel-head/caret/title/names/body`, `ds-section-head`, `preview-body`, `preview-empty`) from `apps/web/src/index.css`; add only the few `strat-*` classes the cards need, using the existing CSS variables (`--line`, `--muted`, `--ink`, `--accent`, `--head-bg`, `--head-ink`).
- **Commit messages** end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Do NOT push.

## File Structure

- Create `apps/web/src/components/stratagemHtml.tsx` — `renderStratagemHtml(html): ReactNode`.
- Create `apps/web/src/components/stratagemHtml.test.tsx`.
- Create `apps/web/src/registry/stratagemRegistry.ts` — `slugForDescriptor`, `loadStratagemLibrary`, `loadStratagemsFor`.
- Create `apps/web/src/registry/stratagemRegistry.test.ts`.
- Create `apps/web/src/components/StratagemPanel.tsx` — the panel.
- Create `apps/web/src/components/StratagemPanel.test.tsx`.
- Modify `apps/web/src/index.css` — add `strat-*` card styles.
- Modify `apps/web/src/App.tsx` — state, load effects, render the panel.

---

### Task 1: Safe HTML renderer

**Files:**
- Create: `apps/web/src/components/stratagemHtml.tsx`
- Create: `apps/web/src/components/stratagemHtml.test.tsx`

**Interfaces:**
- Produces: `renderStratagemHtml(html: string): ReactNode` — parses with `DOMParser` and emits an allowlist of attribute-free React elements (`strong` for b/strong, `em` for i/em, `br`, `ul`, `li`; span/div/unknown transparent via `Fragment`; script/style dropped).

- [ ] **Step 1: Write the failing renderer tests**

Create `apps/web/src/components/stratagemHtml.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderStratagemHtml } from "./stratagemHtml";

function view(html: string) {
  return render(<div data-testid="out">{renderStratagemHtml(html)}</div>);
}

describe("renderStratagemHtml", () => {
  it("renders <b> as bold text", () => {
    view("<b>WHEN:</b> your turn");
    expect(screen.getByText("WHEN:").tagName).toBe("STRONG");
    expect(screen.getByTestId("out").textContent).toBe("WHEN: your turn");
  });

  it("renders <br> as a line break element", () => {
    const { container } = view("a<br>b");
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders a keyword span transparently (text kept, no attributes)", () => {
    const { container } = view('one <span class="kwb">ADEPTUS</span> two');
    expect(screen.getByTestId("out").textContent).toBe("one ADEPTUS two");
    expect(container.querySelector("[class='kwb']")).toBeNull();
    expect(container.querySelector("span")).toBeNull(); // transparent → no span element
  });

  it("renders <ul>/<li> as a list", () => {
    const { container } = view("<ul><li>x</li><li>y</li></ul>");
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("drops <script> entirely (no text, no element)", () => {
    const { container } = view("safe<script>alert(1)</script>text");
    expect(screen.getByTestId("out").textContent).toBe("safetext");
    expect(container.querySelector("script")).toBeNull();
  });

  it("never emits event-handler or style attributes", () => {
    const { container } = view('<b onclick="evil()" style="color:red">x</b>');
    const strong = container.querySelector("strong")!;
    expect(strong.getAttribute("onclick")).toBeNull();
    expect(strong.getAttribute("style")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/web test -- stratagemHtml`
Expected: FAIL — cannot import `renderStratagemHtml`.

- [ ] **Step 3: Implement the renderer**

Create `apps/web/src/components/stratagemHtml.tsx`:

```tsx
import { Fragment } from "react";
import type { ReactNode } from "react";

const BOLD = new Set(["B", "STRONG"]);
const ITALIC = new Set(["I", "EM"]);
const DROP = new Set(["SCRIPT", "STYLE"]);

function childrenOf(node: Node, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  node.childNodes.forEach((child, i) => out.push(nodeToReact(child, `${keyBase}.${i}`)));
  return out;
}

function nodeToReact(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName;
  if (DROP.has(tag)) return null;
  if (tag === "BR") return <br key={key} />;
  const kids = childrenOf(el, key);
  if (BOLD.has(tag)) return <strong key={key}>{kids}</strong>;
  if (ITALIC.has(tag)) return <em key={key}>{kids}</em>;
  if (tag === "UL") return <ul key={key}>{kids}</ul>;
  if (tag === "LI") return <li key={key}>{kids}</li>;
  // span, div, and any other element: transparent — render children only, no attributes.
  return <Fragment key={key}>{kids}</Fragment>;
}

/** Render a constrained subset of Wahapedia effect-text HTML as safe React nodes.
 *  Parses with the browser's DOMParser and re-emits an allowlist of attribute-free
 *  elements (bold, italic, line break, list); span/div/unknown are transparent;
 *  script/style are dropped. Never uses dangerouslySetInnerHTML. */
export function renderStratagemHtml(html: string): ReactNode {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return childrenOf(doc.body, "n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @muster/web test -- stratagemHtml`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/stratagemHtml.tsx apps/web/src/components/stratagemHtml.test.tsx
git commit -m "$(printf 'feat(web): S-C safe stratagem HTML renderer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Stratagem data loader

**Files:**
- Create: `apps/web/src/registry/stratagemRegistry.ts`
- Create: `apps/web/src/registry/stratagemRegistry.test.ts`

**Interfaces:**
- Consumes: `loadStratagemManifest`, `loadStratagemFile`, `stratagemFileForSlug`, `StratagemManifest`, `StratagemFile` (from `@muster/domain`); `CatalogueDescriptor` (from `./catalogueRegistry`).
- Produces:
  - `slugForDescriptor(descriptor: CatalogueDescriptor): string | undefined`
  - `loadStratagemLibrary(fetchFn: typeof fetch | undefined, base: string): Promise<StratagemManifest | undefined>`
  - `loadStratagemsFor(fetchFn: typeof fetch | undefined, base: string, manifest: StratagemManifest, slug: string | undefined): Promise<{ core: StratagemFile; faction?: StratagemFile } | undefined>`

- [ ] **Step 1: Write the failing loader tests**

Create `apps/web/src/registry/stratagemRegistry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugForDescriptor, loadStratagemLibrary, loadStratagemsFor } from "./stratagemRegistry";
import type { CatalogueDescriptor } from "./catalogueRegistry";
import type { StratagemManifest } from "@muster/domain";

function fakeFetch(routes: Record<string, { ok: boolean; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: hit.ok, status: hit.ok ? 200 : 500, json: async () => hit.body } as Response;
  }) as typeof fetch;
}

const manifest: StratagemManifest = {
  version: 1, source: "Wahapedia", attribution: "a",
  core: { file: "stratagems/_core.json", count: 1 },
  factions: [{ slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 2 }],
};
const coreFile = { source: "Wahapedia", kind: "core", stratagems: [
  { id: "c1", name: "GRENADE", category: "Wargear", cpCost: 1, turn: "t", phase: "p", detachment: "", detachmentId: "", legend: "", description: "d" }] };
const smFile = { source: "Wahapedia", kind: "faction", wahapediaFactionId: "SM", stratagems: [
  { id: "s1", name: "A", category: "Battle Tactic", cpCost: 1, turn: "t", phase: "p", detachment: "Gladius Task Force", detachmentId: "d1", legend: "", description: "d" }] };

const manifestDesc: CatalogueDescriptor = {
  id: "10e:sm", catalogueId: "sm", name: "Space Marines", edition: "10e", editionName: "10th Edition",
  source: { kind: "manifest", file: "catalogues/10e/space-marines.ir.json" },
};
const bundledDesc: CatalogueDescriptor = {
  id: "10e:mini", catalogueId: "mini", name: "Mini 40k", edition: "10e", editionName: "10th Edition",
  source: { kind: "bundled", data: {} },
};

describe("slugForDescriptor", () => {
  it("derives the slug from a manifest descriptor's file path", () => {
    expect(slugForDescriptor(manifestDesc)).toBe("space-marines");
  });
  it("returns undefined for a bundled descriptor", () => {
    expect(slugForDescriptor(bundledDesc)).toBeUndefined();
  });
});

describe("loadStratagemLibrary", () => {
  it("fetches and validates the manifest", async () => {
    const f = fakeFetch({ "/stratagems.json": { ok: true, body: manifest } });
    expect((await loadStratagemLibrary(f, "/"))?.core.count).toBe(1);
  });
  it("returns undefined on 404", async () => {
    expect(await loadStratagemLibrary(fakeFetch({}), "/")).toBeUndefined();
  });
  it("returns undefined with no fetch", async () => {
    expect(await loadStratagemLibrary(undefined, "/")).toBeUndefined();
  });
  it("returns undefined on malformed manifest JSON", async () => {
    const f = fakeFetch({ "/stratagems.json": { ok: true, body: { nope: true } } });
    expect(await loadStratagemLibrary(f, "/")).toBeUndefined();
  });
});

describe("loadStratagemsFor", () => {
  it("loads core + faction when the slug resolves", async () => {
    const f = fakeFetch({
      "/stratagems/_core.json": { ok: true, body: coreFile },
      "/stratagems/space-marines.json": { ok: true, body: smFile },
    });
    const r = await loadStratagemsFor(f, "/", manifest, "space-marines");
    expect(r?.core.stratagems[0]?.name).toBe("GRENADE");
    expect(r?.faction?.stratagems[0]?.name).toBe("A");
  });
  it("returns core-only when the slug is absent", async () => {
    const f = fakeFetch({ "/stratagems/_core.json": { ok: true, body: coreFile } });
    const r = await loadStratagemsFor(f, "/", manifest, "tyranids");
    expect(r?.core).toBeDefined();
    expect(r?.faction).toBeUndefined();
  });
  it("returns undefined when the core file fails", async () => {
    expect(await loadStratagemsFor(fakeFetch({}), "/", manifest, "space-marines")).toBeUndefined();
  });
  it("returns undefined with no fetch", async () => {
    expect(await loadStratagemsFor(undefined, "/", manifest, "space-marines")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/web test -- stratagemRegistry`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the loader**

Create `apps/web/src/registry/stratagemRegistry.ts`:

```ts
import { loadStratagemManifest, loadStratagemFile, stratagemFileForSlug } from "@muster/domain";
import type { StratagemManifest, StratagemFile } from "@muster/domain";
import type { CatalogueDescriptor } from "./catalogueRegistry";

/** The active faction slug for a descriptor, from its manifest file path
 *  ("catalogues/10e/space-marines.ir.json" → "space-marines"); undefined for a
 *  bundled fixture or imported IR (no slug → no faction stratagems). */
export function slugForDescriptor(descriptor: CatalogueDescriptor): string | undefined {
  if (descriptor.source.kind !== "manifest") return undefined;
  const base = descriptor.source.file.split("/").pop();
  return base ? base.replace(/\.ir\.json$/, "") : undefined;
}

/** Fetch + validate the stratagem manifest; undefined on any failure (no fetch,
 *  missing, non-OK, bad JSON). */
export async function loadStratagemLibrary(
  fetchFn: typeof fetch | undefined, base: string,
): Promise<StratagemManifest | undefined> {
  if (!fetchFn) return undefined;
  try {
    const res = await fetchFn(`${base}stratagems.json`);
    if (!res.ok) return undefined;
    return loadStratagemManifest(await res.json());
  } catch {
    return undefined;
  }
}

async function fetchFile(fetchFn: typeof fetch, base: string, file: string): Promise<StratagemFile | undefined> {
  try {
    const res = await fetchFn(`${base}${file}`);
    if (!res.ok) return undefined;
    return loadStratagemFile(await res.json());
  } catch {
    return undefined;
  }
}

/** Fetch the core file + the faction's file (if the slug resolves), validated.
 *  { core, faction? }; undefined if the core file can't load; faction omitted
 *  (core-only) if the slug is absent or its file fails. Never throws. */
export async function loadStratagemsFor(
  fetchFn: typeof fetch | undefined, base: string,
  manifest: StratagemManifest, slug: string | undefined,
): Promise<{ core: StratagemFile; faction?: StratagemFile } | undefined> {
  if (!fetchFn) return undefined;
  const core = await fetchFile(fetchFn, base, manifest.core.file);
  if (!core) return undefined;
  const factionFile = slug ? stratagemFileForSlug(manifest, slug) : undefined;
  const faction = factionFile ? await fetchFile(fetchFn, base, factionFile) : undefined;
  return faction ? { core, faction } : { core };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @muster/web test -- stratagemRegistry`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/registry/stratagemRegistry.ts apps/web/src/registry/stratagemRegistry.test.ts
git commit -m "$(printf 'feat(web): S-C stratagem data loader (degrade-never-throw)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: StratagemPanel component

**Files:**
- Create: `apps/web/src/components/StratagemPanel.tsx`
- Create: `apps/web/src/components/StratagemPanel.test.tsx`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Consumes: `selectStratagems` (domain), `selectedDetachmentNames` (roster), `renderStratagemHtml` (Task 1); types `IrCatalogue`, `Roster`, `StratagemFile`, `Stratagem` from `@muster/domain`.
- Produces: `StratagemPanel({ data, roster, catalogue, attribution })` — collapsible; Core section + one section per selected detachment; renders nothing when `data` is undefined.

- [ ] **Step 1: Write the failing panel tests**

Create `apps/web/src/components/StratagemPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue, StratagemFile } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
import { StratagemPanel } from "./StratagemPanel";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
    groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"], constraints: [] }],
    children: [{ id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
  }],
};
const strat = (id: string, name: string, detachment: string) =>
  ({ id, name, category: "Battle Tactic", cpCost: 1, turn: "Your turn", phase: "Shooting phase", detachment, detachmentId: "x", legend: "", description: `<b>WHEN:</b> ${name} fires.` });
const data: { core: StratagemFile; faction?: StratagemFile } = {
  core: { source: "Wahapedia", kind: "core", stratagems: [strat("c1", "GRENADE", "")] },
  faction: { source: "Wahapedia", kind: "faction", wahapediaFactionId: "SM", stratagems: [strat("s1", "ARMOUR OF CONTEMPT", "Gladius Task Force")] },
};

describe("StratagemPanel", () => {
  it("renders nothing when data is undefined", () => {
    const { container } = render(<StratagemPanel data={undefined} roster={createRoster(cat, 2000)} catalogue={cat} attribution="a" />);
    expect(container.querySelector("[data-testid='stratagem-panel']")).toBeNull();
  });

  it("shows Core stratagems when opened", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} attribution="Data from Wahapedia." />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("GRENADE")).toBeInTheDocument();
    expect(screen.getByText("Data from Wahapedia.")).toBeInTheDocument();
  });

  it("shows a selected detachment's section and stratagems", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={data} roster={roster} catalogue={cat} attribution="a" />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("Gladius Task Force")).toBeInTheDocument();
    expect(screen.getByText("ARMOUR OF CONTEMPT")).toBeInTheDocument();
    // effect text rendered via the safe renderer (bold label present):
    expect(screen.getByText("WHEN:").tagName).toBe("STRONG");
  });

  it("shows the empty hint for a detachment with no matching stratagems", () => {
    const bareData = { core: data.core, faction: { source: "Wahapedia", kind: "faction" as const, stratagems: [] } };
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={bareData} roster={roster} catalogue={cat} attribution="a" />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("No detachment-specific stratagems found.")).toBeInTheDocument();
  });

  it("is collapsed by default (body hidden until toggled)", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} attribution="a" />);
    expect(screen.queryByText("GRENADE")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/web test -- StratagemPanel`
Expected: FAIL — cannot import `StratagemPanel`.

- [ ] **Step 3: Implement the panel**

Create `apps/web/src/components/StratagemPanel.tsx`:

```tsx
import { useState } from "react";
import type { IrCatalogue, Roster, StratagemFile, Stratagem } from "@muster/domain";
import { selectStratagems } from "@muster/domain";
import { selectedDetachmentNames } from "@muster/roster";
import { renderStratagemHtml } from "./stratagemHtml";

const FALLBACK_ATTRIBUTION = "Data from Wahapedia (wahapedia.ru).";

function StratagemCard({ s }: { s: Stratagem }) {
  const meta = [s.category, s.phase, s.turn].filter(Boolean).join(" · ");
  return (
    <div className="strat-card">
      <div className="strat-head">
        <span className="strat-name">{s.name}</span>
        <span className="strat-cp">{s.cpCost}CP</span>
      </div>
      {meta && <div className="strat-meta">{meta}</div>}
      <div className="strat-text">{renderStratagemHtml(s.description)}</div>
    </div>
  );
}

function StratagemSection({ title, stratagems, emptyHint }: { title: string; stratagems: Stratagem[]; emptyHint?: string }) {
  return (
    <div className="strat-section">
      <div className="ds-section-head">{title}</div>
      <div className="preview-body">
        {stratagems.length === 0
          ? <div className="preview-empty">{emptyHint ?? "No stratagems."}</div>
          : stratagems.map((s) => <StratagemCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}

/** A collapsible reference panel of the roster's stratagems: Core (always) plus one
 *  section per selected detachment. Renders nothing until stratagem data is loaded. */
export function StratagemPanel({ data, roster, catalogue, attribution }: {
  data: { core: StratagemFile; faction?: StratagemFile } | undefined;
  roster: Roster; catalogue: IrCatalogue; attribution: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const names = selectedDetachmentNames(roster, catalogue);
  const { core, byDetachment } = selectStratagems(data.core, data.faction, names);
  const summary = `Core + ${byDetachment.length} detachment${byDetachment.length === 1 ? "" : "s"}`;

  return (
    <div className="det-panel" data-testid="stratagem-panel">
      <button className="det-panel-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="det-panel-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="det-panel-title">Stratagems</span>
        <span className="det-panel-names">{summary}</span>
      </button>
      {open && (
        <div className="det-panel-body">
          <StratagemSection title="Core" stratagems={core} />
          {byDetachment.map((g) => (
            <StratagemSection key={g.detachment} title={g.detachment} stratagems={g.stratagems}
              emptyHint="No detachment-specific stratagems found." />
          ))}
          <div className="strat-attribution">{attribution ?? FALLBACK_ATTRIBUTION}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the card styles**

Append to `apps/web/src/index.css`:

```css
/* Stratagem panel cards (reuses .det-panel*, .ds-section-head, .preview-body/empty). */
.strat-card { padding: 6px 0; border-bottom: 1px dashed var(--line); }
.strat-card:last-child { border-bottom: none; }
.strat-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.strat-name { font-weight: 700; font-size: 12.5px; }
.strat-cp { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11.5px; white-space: nowrap; }
.strat-meta { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 1px; }
.strat-text { font-size: 12.5px; line-height: 1.45; color: var(--ink); margin-top: 3px; }
.strat-attribution { color: var(--muted); font-size: 11px; font-style: italic; padding: 8px 12px; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @muster/web test -- StratagemPanel`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/StratagemPanel.tsx apps/web/src/components/StratagemPanel.test.tsx apps/web/src/index.css
git commit -m "$(printf 'feat(web): S-C StratagemPanel component\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Wire into App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `StratagemPanel` (Task 3); `loadStratagemLibrary`, `loadStratagemsFor`, `slugForDescriptor` (Task 2); the existing `boundFetch`, `CATALOGUES_BASE`, `registry`, `activeDescriptorId`, `roster`, `catalogue`.
- Produces: the panel rendered in the builder, its data loaded on mount + faction change.

- [ ] **Step 1: Add imports**

In `apps/web/src/App.tsx`, add after the `DetachmentPanel` import (line ~13):

```tsx
import { StratagemPanel } from "./components/StratagemPanel";
```

and after the `catalogueRegistry` import block, add:

```tsx
import { loadStratagemLibrary, loadStratagemsFor, slugForDescriptor } from "./registry/stratagemRegistry";
import type { StratagemManifest, StratagemFile } from "@muster/domain";
```

- [ ] **Step 2: Add state**

Alongside the other `useState` declarations in `App()` (near `registry`/`activeDescriptorId`), add:

```tsx
const [stratagemManifest, setStratagemManifest] = useState<StratagemManifest | undefined>(undefined);
const [stratagemData, setStratagemData] = useState<{ core: StratagemFile; faction?: StratagemFile } | undefined>(undefined);
```

- [ ] **Step 3: Load the manifest on mount**

Add an effect next to the existing registry-loading effect:

```tsx
// Discover the stratagem library from the same base as the catalogue library.
// Any failure leaves the manifest undefined → the panel simply never appears.
useEffect(() => {
  void loadStratagemLibrary(boundFetch, CATALOGUES_BASE).then(setStratagemManifest);
}, []);
```

- [ ] **Step 4: Load the active faction's stratagems when it (or the manifest) changes**

Add another effect:

```tsx
// Load Core + the active faction's stratagems whenever the faction or the manifest
// changes. A bundled/imported descriptor has no slug → core-only; any failure → undefined.
useEffect(() => {
  if (!stratagemManifest) { setStratagemData(undefined); return; }
  const desc = registry.find((d) => d.id === activeDescriptorId);
  const slug = desc ? slugForDescriptor(desc) : undefined;
  void loadStratagemsFor(boundFetch, CATALOGUES_BASE, stratagemManifest, slug).then(setStratagemData);
}, [activeDescriptorId, stratagemManifest, registry]);
```

- [ ] **Step 5: Render the panel after DetachmentPanel**

Immediately after the `<DetachmentPanel … />` element (around line 131-133), add:

```tsx
<StratagemPanel data={stratagemData} roster={roster} catalogue={catalogue}
  attribution={stratagemManifest?.attribution} />
```

- [ ] **Step 6: Run the full web suite (no regression)**

Run: `pnpm --filter @muster/web test`
Expected: PASS — all existing tests plus the new ones; `App.test.tsx` still green (no manifest served in jsdom → panel absent, no error).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @muster/web typecheck`
Expected: PASS (no type errors from the new state/props).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "$(printf 'feat(web): S-C wire StratagemPanel into the builder\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- Safe HTML renderer (allowlist, DOMParser, no dep, script/attr dropped) → Task 1. ✓
- Slug resolution + degrade-never-throw data loading → Task 2. ✓
- Collapsible panel, Core + per-detachment sections, CP/meta/effect text, empty hint, attribution → Task 3. ✓
- App wiring (mount load + faction-change load + placement beside DetachmentPanel) → Task 4. ✓
- Non-goals (no CP logic, no search, no dep, no domain/roster change, no keyword styling) → nothing in the plan builds them. ✓

**Placeholder scan:** every code step is complete; no TBD/TODO.

**Type/name consistency:** `renderStratagemHtml` (Task 1) is imported by StratagemPanel (Task 3). `slugForDescriptor`/`loadStratagemLibrary`/`loadStratagemsFor` (Task 2) are consumed by App (Task 4) with matching signatures. The data shape `{ core: StratagemFile; faction?: StratagemFile }` is identical across Task 2 (producer), Task 3 (panel prop), and Task 4 (state). `selectStratagems` / `selectedDetachmentNames` are the real S-B exports. `CatalogueDescriptor.source` (`{kind:"manifest",file} | {kind:"bundled",data}`) matches `slugForDescriptor`'s use.

## Post-implementation acceptance (controller-run, not a task)

After Task 4, the controller verifies live in the browser preview: start the web dev server, load a real faction (e.g. Space Marines), select a detachment, open the Stratagem panel, and confirm the Core section (11) + the detachment's stratagems render with formatted effect text and the attribution line. Screenshot as proof. (jsdom tests already cover logic; this validates the real fetch + render end-to-end.)
