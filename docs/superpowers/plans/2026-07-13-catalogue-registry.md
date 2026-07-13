# Catalogue Registry (faction library) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SetupWizard "faction" step real — a runtime catalogue registry (bundled fixture + a local `public/catalogues.json` manifest) with lazy loading and active-faction switching, holding zero GW data in git.

**Architecture:** A pure, fetch-injected web module (`catalogueRegistry.ts`) assembles a list of `CatalogueDescriptor`s (bundled mini40k first, then valid manifest entries) and lazily materializes an `IrCatalogue` for a chosen descriptor through the existing `loadCatalogue` seam. `App` loads the registry on mount and switches the active catalogue; `SetupWizard`'s faction step renders the registry.

**Tech Stack:** TypeScript (strict, noUncheckedIndexedAccess, ESM), Zod (@muster/domain), React 18 + Vite (apps/web), Vitest + @testing-library/react in jsdom (no coverage thresholds in web), `@muster/domain`'s `loadCatalogue`.

## Global Constraints

- ZERO GW/BSData catalogue data committed. Only the existing synthetic `apps/web/src/mini40k.ir.json` is bundled. Registry infra lives in git; catalogue content does not. `apps/web/public/` stays gitignored.
- No real network in tests: `catalogueRegistry` takes an injected `fetchFn: typeof fetch`; tests pass a fake.
- The registry module NEVER throws while assembling the list: any manifest fetch/parse failure degrades to bundled-only.
- New `SetupWizard` faction props are OPTIONAL; without them the wizard renders a single card for the current `catalogue.name` (existing SetupWizard tests, which pass no faction props, stay green).
- Existing web tests stay green, including `data-testid="points"` and the setup/wizard/detachment contracts.
- No Rust/parser changes; parser golden test unaffected.
- Code, identifiers, commit messages in English. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `catalogueRegistry` pure module

**Files:**
- Create: `apps/web/src/registry/catalogueRegistry.ts`
- Test: `apps/web/src/registry/catalogueRegistry.test.ts`

**Interfaces:**
- Consumes: `loadCatalogue`, `IrCatalogue` from `@muster/domain`; a `fetchFn: typeof fetch`.
- Produces:
  - `type CatalogueDescriptor = { id: string; name: string; source: { kind: "bundled"; data: unknown } | { kind: "manifest"; file: string } }`
  - `const CatalogueManifest` (Zod) + `type CatalogueManifest = { version: 1; catalogues: { id: string; name: string; file: string }[] }`
  - `function bundledDescriptor(data: unknown): CatalogueDescriptor` — parses `data` via `loadCatalogue`, returns `{ id, name, source: { kind: "bundled", data } }`.
  - `function loadRegistry(bundled: CatalogueDescriptor, fetchFn: typeof fetch, manifestUrl: string): Promise<CatalogueDescriptor[]>`
  - `function loadCatalogueFor(descriptor: CatalogueDescriptor, fetchFn: typeof fetch, baseUrl: string): Promise<IrCatalogue>`

- [ ] **Step 1: Write failing tests**

`apps/web/src/registry/catalogueRegistry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bundledDescriptor, loadRegistry, loadCatalogueFor, type CatalogueDescriptor } from "./catalogueRegistry";
import mini40k from "../mini40k.ir.json";

const bundled = bundledDescriptor(mini40k);

function fakeFetch(routes: Record<string, { ok: boolean; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: hit.ok, status: hit.ok ? 200 : 500, json: async () => hit.body } as Response;
  }) as typeof fetch;
}

describe("bundledDescriptor", () => {
  it("derives id and name from the parsed catalogue", () => {
    expect(bundled.name).toBe("Mini 40k");
    expect(bundled.source.kind).toBe("bundled");
  });
});

describe("loadRegistry", () => {
  const manifestUrl = "/catalogues.json";
  it("returns bundled first, then valid manifest entries", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: {
      version: 1, catalogues: [{ id: "sm", name: "Space Marines", file: "catalogues/sm.ir.json" }],
    } } });
    const reg = await loadRegistry(bundled, f, manifestUrl);
    expect(reg.map((d) => d.name)).toEqual(["Mini 40k", "Space Marines"]);
    expect(reg[1]?.source).toEqual({ kind: "manifest", file: "catalogues/sm.ir.json" });
  });

  it("degrades to bundled-only when the manifest 404s", async () => {
    const reg = await loadRegistry(bundled, fakeFetch({}), manifestUrl);
    expect(reg).toEqual([bundled]);
  });

  it("degrades to bundled-only on malformed manifest JSON", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: { nonsense: true } } });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("degrades to bundled-only when version is not 1", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: { version: 2, catalogues: [] } } });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("does not let a manifest entry shadow the bundled id", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: {
      version: 1, catalogues: [{ id: bundled.id, name: "Dupe", file: "x.ir.json" }],
    } } });
    const reg = await loadRegistry(bundled, f, manifestUrl);
    expect(reg).toEqual([bundled]);
  });
});

describe("loadCatalogueFor", () => {
  it("materializes a bundled descriptor", async () => {
    const cat = await loadCatalogueFor(bundled, fakeFetch({}), "/");
    expect(cat.name).toBe("Mini 40k");
  });

  it("fetches and parses a manifest descriptor relative to baseUrl", async () => {
    const desc: CatalogueDescriptor = { id: "sm", name: "SM", source: { kind: "manifest", file: "catalogues/sm.ir.json" } };
    const f = fakeFetch({ "/catalogues/sm.ir.json": { ok: true, body: mini40k } });
    const cat = await loadCatalogueFor(desc, f, "/");
    expect(cat.name).toBe("Mini 40k");
  });

  it("throws when a manifest catalogue fetch is not ok", async () => {
    const desc: CatalogueDescriptor = { id: "sm", name: "SM", source: { kind: "manifest", file: "catalogues/sm.ir.json" } };
    await expect(loadCatalogueFor(desc, fakeFetch({}), "/")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter web test -- catalogueRegistry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/registry/catalogueRegistry.ts`:

```ts
import { z } from "zod";
import { loadCatalogue, type IrCatalogue } from "@muster/domain";

export type CatalogueDescriptor = {
  id: string;
  name: string;
  source: { kind: "bundled"; data: unknown } | { kind: "manifest"; file: string };
};

export const CatalogueManifest = z.object({
  version: z.literal(1),
  catalogues: z.array(z.object({ id: z.string(), name: z.string(), file: z.string() })),
});
export type CatalogueManifest = z.infer<typeof CatalogueManifest>;

/** Build the always-present bundled descriptor from an imported IR JSON. */
export function bundledDescriptor(data: unknown): CatalogueDescriptor {
  const cat = loadCatalogue(data);
  return { id: cat.id, name: cat.name, source: { kind: "bundled", data } };
}

/** Assemble the registry: bundled first, then valid manifest entries (deduped by
 *  id, bundled wins). Any fetch/parse failure degrades to bundled-only; never throws. */
export async function loadRegistry(
  bundled: CatalogueDescriptor,
  fetchFn: typeof fetch,
  manifestUrl: string,
): Promise<CatalogueDescriptor[]> {
  try {
    const res = await fetchFn(manifestUrl);
    if (!res.ok) return [bundled];
    const parsed = CatalogueManifest.safeParse(await res.json());
    if (!parsed.success) return [bundled];
    const seen = new Set([bundled.id]);
    const out = [bundled];
    for (const c of parsed.data.catalogues) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, source: { kind: "manifest", file: c.file } });
    }
    return out;
  } catch {
    return [bundled];
  }
}

/** Lazily materialize the IrCatalogue for a descriptor through the shared load seam. */
export async function loadCatalogueFor(
  descriptor: CatalogueDescriptor,
  fetchFn: typeof fetch,
  baseUrl: string,
): Promise<IrCatalogue> {
  if (descriptor.source.kind === "bundled") return loadCatalogue(descriptor.source.data);
  const url = `${baseUrl}${descriptor.source.file}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load catalogue "${descriptor.name}" (${res.status})`);
  return loadCatalogue(await res.json());
}
```

> Note: `res.json()` on the fake returns the raw body object; `loadCatalogue` handles both packed-v1 and tree. `baseUrl` ends with `/` (Vite's `import.meta.env.BASE_URL` does), so `${baseUrl}${file}` concatenates cleanly.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter web test -- catalogueRegistry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/registry/catalogueRegistry.ts apps/web/src/registry/catalogueRegistry.test.ts
git commit -m "feat(web): catalogue registry module (bundled + manifest, fetch-injected)"
```

---

### Task 2: SetupWizard faction step renders the registry

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx`
- Test: `apps/web/src/components/SetupWizard.test.tsx`

**Interfaces:**
- Consumes: `CatalogueDescriptor` (Task 1).
- Adds OPTIONAL props to `SetupWizard`:
  ```ts
  registry?: CatalogueDescriptor[];
  activeDescriptorId?: string;
  onSelectFaction?: (descriptorId: string) => void;
  factionError?: string;
  ```
  When `registry` is undefined, the faction step renders a single `chosen` card for `catalogue.name` (current behavior, minus the disabled placeholders).

- [ ] **Step 1: Write failing tests**

Add to `apps/web/src/components/SetupWizard.test.tsx` (import `CatalogueDescriptor` type as needed; construct plain objects):

```ts
it("renders a card per registry faction and marks the active one", () => {
  const registry = [
    { id: "a", name: "Alpha", source: { kind: "bundled" as const, data: {} } },
    { id: "b", name: "Beta", source: { kind: "manifest" as const, file: "b.ir.json" } },
  ];
  render(
    <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
      registry={registry} activeDescriptorId="a" onSelectFaction={noop}
      onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
  );
  expect(screen.getByText("Alpha")).toBeTruthy();
  expect(screen.getByText("Beta")).toBeTruthy();
});

it("calls onSelectFaction when a non-active faction is clicked", () => {
  const onSelectFaction = vi.fn();
  const registry = [
    { id: "a", name: "Alpha", source: { kind: "bundled" as const, data: {} } },
    { id: "b", name: "Beta", source: { kind: "manifest" as const, file: "b.ir.json" } },
  ];
  render(
    <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
      registry={registry} activeDescriptorId="a" onSelectFaction={onSelectFaction}
      onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
  );
  fireEvent.click(screen.getByText("Beta"));
  expect(onSelectFaction).toHaveBeenCalledWith("b");
});

it("shows a faction load error when provided", () => {
  render(
    <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
      registry={[{ id: "a", name: "Alpha", source: { kind: "bundled" as const, data: {} } }]}
      activeDescriptorId="a" onSelectFaction={noop} factionError="Couldn't load Beta"
      onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
  );
  expect(screen.getByText(/Couldn't load Beta/)).toBeTruthy();
});
```

> Ensure `vi` is imported in the test file (add to the existing `vitest` import if missing).

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter web test -- SetupWizard`
Expected: FAIL — registry cards not rendered.

- [ ] **Step 3: Implement**

In `SetupWizard.tsx`:
- Extend the props type with the four optional props above.
- Replace the hardcoded faction step (`step === 1` block) with:
  - If `registry` present: map it to cards. Each card:
    ```tsx
    <button key={d.id} className={`faction-card${d.id === activeDescriptorId ? " chosen" : ""}`}
      aria-pressed={d.id === activeDescriptorId}
      onClick={() => { if (d.id !== activeDescriptorId) onSelectFaction?.(d.id); }}>
      <span className="fname">{d.name}</span>
      <span className="fmeta">{d.source.kind === "bundled" ? "Bundled" : "Local"}</span>
    </button>
    ```
  - If `registry` absent: a single `chosen` card for `catalogue.name` (label `fmeta` "Loaded catalogue").
  - Below the grid, if `factionError` is set, render `<p className="faction-error">{factionError}</p>`.
  - Keep the `data-testid="step-faction"` wrapper and the existing `.faction-grid` container class.
- Remove the hardcoded `["Astra Militarum", "Necrons", "Orks"]` disabled cards and the "Library soon" note (replaced by real registry).

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter web test -- SetupWizard`
Expected: PASS — new registry tests pass; existing SetupWizard tests (no faction props) still pass via the single-card fallback.

- [ ] **Step 5: CSS**

In `apps/web/src/index.css`, add `.faction-error { color: var(--error); font-size: 13px; margin-top: 8px; }`. (`.faction-card`/`.fname`/`.fmeta`/`.faction-grid` already exist.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SetupWizard.tsx apps/web/src/components/SetupWizard.test.tsx apps/web/src/index.css
git commit -m "feat(web): SetupWizard faction step renders the catalogue registry"
```

---

### Task 3: App loads the registry and switches the active faction

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `bundledDescriptor`, `loadRegistry`, `loadCatalogueFor`, `CatalogueDescriptor` (Task 1); the extended `SetupWizard` props (Task 2).

- [ ] **Step 1: Write/adjust tests**

Add to `apps/web/src/App.test.tsx`:

```ts
it("opens the faction step showing at least the bundled faction", async () => {
  render(<App />);
  // Open the wizard at the faction step via the setup bar faction chip.
  fireEvent.click(screen.getByText("Faction"));
  expect(await screen.findByText("Mini 40k")).toBeTruthy();
});
```

> Import `fireEvent` in `App.test.tsx` if not already. The registry loads via an injected/default fetch; with no `public/catalogues.json` in jsdom the fetch rejects/404s and the registry degrades to bundled-only — so "Mini 40k" is present. If the default `fetch` is undefined in jsdom, guard it (see Step 3).

- [ ] **Step 2: Run tests, observe**

Run: `pnpm --filter web test -- App`
Expected: the new test FAILS (faction chip/registry not wired) or the registry throws; existing App tests still pass.

- [ ] **Step 3: Implement**

In `apps/web/src/App.tsx`:
- Import `useEffect`, and `bundledDescriptor`, `loadRegistry`, `loadCatalogueFor`, `type CatalogueDescriptor` from `./registry/catalogueRegistry`.
- Build the bundled descriptor once: `const bundled = useMemo(() => bundledDescriptor(mini40k), []);`
- State: `const [registry, setRegistry] = useState<CatalogueDescriptor[]>([bundled]);`
  `const [activeDescriptorId, setActiveDescriptorId] = useState(bundled.id);`
  `const [factionError, setFactionError] = useState<string | undefined>(undefined);`
- Extract the catalogue-swap logic shared by `loadIr` and faction switching:
  ```ts
  const applyCatalogue = (next: IrCatalogue, descriptorId: string) => {
    const nextRoster = createRoster(next, 2000);
    setCatalogue(next);
    setRoster(nextRoster);
    setActiveDescriptorId(descriptorId);
    setSelectedUnitId(undefined);
    setPickerOpen(false);
    setWizardStep(0);
    setWizardOpen(needsSetup(next, nextRoster));
  };
  ```
  Refactor `loadIr` to call `applyCatalogue(parsed, "imported")` (imported files use a synthetic id and are not added to the registry — scope).
- Load the registry on mount:
  ```ts
  useEffect(() => {
    const fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : undefined;
    if (!fetchFn) return;
    const base = import.meta.env.BASE_URL;
    void loadRegistry(bundled, fetchFn, `${base}catalogues.json`).then(setRegistry).catch(() => setRegistry([bundled]));
  }, [bundled]);
  ```
- Faction switch handler:
  ```ts
  const onSelectFaction = (descriptorId: string) => {
    const desc = registry.find((d) => d.id === descriptorId);
    if (!desc) return;
    setFactionError(undefined);
    const fetchFn = typeof fetch === "function" ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch);
    void loadCatalogueFor(desc, fetchFn, import.meta.env.BASE_URL)
      .then((next) => applyCatalogue(next, desc.id))
      .catch(() => setFactionError(`Couldn't load ${desc.name}`));
  };
  ```
- Pass to `SetupWizard`: `registry={registry} activeDescriptorId={activeDescriptorId} onSelectFaction={onSelectFaction} factionError={factionError}`.

> Implementer: confirm `IrCatalogue` is already imported in App.tsx (it is, as a type). Keep the existing `loadIr` file-input behavior otherwise intact.

- [ ] **Step 4: Run tests, verify green**

Run: `pnpm --filter web test`
Expected: PASS — new faction test passes; all existing App/builder/setup/legality tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat(web): load catalogue registry on mount and switch active faction"
```

---

### Task 4: manifest builder script

**Files:**
- Create: `scripts/build-catalogue-manifest.mjs`

**Interfaces:** standalone Node ESM script; no imports from workspace packages (reads JSON only).

- [ ] **Step 1: Implement the script**

`scripts/build-catalogue-manifest.mjs`:

```js
#!/usr/bin/env node
// Scans apps/web/public/catalogues/*.ir.json and writes apps/web/public/catalogues.json
// listing each catalogue's { id, name, file }. Run after dropping packed/tree IRs there.
// No GW data enters git — apps/web/public/ is gitignored; this only builds a local manifest.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "apps/web/public/catalogues");
const out = join(process.cwd(), "apps/web/public/catalogues.json");

if (!existsSync(dir)) {
  console.error(`No ${dir} — create it and add *.ir.json catalogues first.`);
  process.exit(1);
}

const catalogues = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".ir.json")).sort()) {
  const json = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (typeof json.id !== "string" || typeof json.name !== "string") {
    console.warn(`Skipping ${f}: missing id/name`);
    continue;
  }
  catalogues.push({ id: json.id, name: json.name, file: `catalogues/${f}` });
}

writeFileSync(out, JSON.stringify({ version: 1, catalogues }, null, 2) + "\n");
console.log(`Wrote ${out} with ${catalogues.length} catalogue(s).`);
```

- [ ] **Step 2: Smoke-test the script**

Run (creates a throwaway fixture, builds, inspects, cleans up):
```bash
mkdir -p apps/web/public/catalogues
cp apps/web/src/mini40k.ir.json apps/web/public/catalogues/mini.ir.json
node scripts/build-catalogue-manifest.mjs
cat apps/web/public/catalogues.json
```
Expected: a manifest with one entry `{ id: <mini id>, name: "Mini 40k", file: "catalogues/mini.ir.json" }`.
(Leave the throwaway fixture for Task 5 browser verification; it is gitignored.)

- [ ] **Step 3: Commit** (script only; the public/ fixtures are gitignored and not staged)

```bash
git add scripts/build-catalogue-manifest.mjs
git commit -m "chore(scripts): build-catalogue-manifest for the local faction library"
```

---

### Task 5: full-suite gate + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm turbo run test`
Expected: all packages green (web incl. new registry tests; domain/engine-eval/roster unchanged; parser cached).

- [ ] **Step 2: Browser proof of a real 2-faction switch**

Locally (gitignored, not committed): ensure `apps/web/public/catalogues/` holds two synthetic catalogues with DISTINCT `id` and `name` (e.g. copy `mini40k.ir.json` twice, edit the second copy's top-level `id` and `name` to a different value), then `node scripts/build-catalogue-manifest.mjs`. Start the dev server, open the setup wizard's faction step, confirm BOTH factions list, switch to the second, and confirm the header/setup-bar name changes and the roster resets. Capture a screenshot.

> If editing a 3MB JSON's id/name is awkward, use a tiny hand-written second catalogue: `{ "id": "demo-2", "name": "Demo Legion", "gameSystemId": "gs", "revision": 1, "entries": [], "forceConstraints": [] }` saved as `apps/web/public/catalogues/demo.ir.json`.

- [ ] **Step 3: No commit** (verification only). If the browser reveals a defect, fix at the relevant task's source, re-run its tests, re-verify. Remove the throwaway `public/` fixtures afterward (they are gitignored regardless).

---

## Self-Review

- **Spec coverage:** registry module + manifest schema + lazy load → Task 1; faction step UI → Task 2; App wiring (mount load, switch, error) → Task 3; manifest builder script → Task 4; verification → Task 5. All spec sections mapped.
- **Placeholder scan:** No TBD/TODO; every code step carries full code. The "implementer: confirm import" notes are grounding, not placeholders.
- **Type consistency:** `CatalogueDescriptor` shape identical across Tasks 1/2/3. `loadRegistry`/`loadCatalogueFor` signatures identical in Tasks 1 and 3. Optional `SetupWizard` faction props identical in Tasks 2 and 3. Manifest `{ version: 1, catalogues: [{id,name,file}] }` identical in the schema (Task 1) and the script output (Task 4).
