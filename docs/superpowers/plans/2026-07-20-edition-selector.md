# Edition Selector (Sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The catalogue library carries both 10th- and 11th-edition factions, and the user picks the edition when creating an army.

**Architecture:** An edition dimension threaded config → manifest → registry → wizard. See the spec: `docs/superpowers/specs/2026-07-20-edition-selector-design.md` — implementers READ IT FIRST. Descriptor identity becomes the composite `"<edition>:<catalogueId>"` because 10e and 11e reuse the same BSData catalogue ids.

**Tech Stack:** Node ESM scripts, TypeScript strict + Vitest + React Testing Library.

## Global Constraints

- **Catalogue ids collide across editions** (10e and 11e Space Marines are both `e0af-67df-9d63-8fb7`). Any dedup or lookup keyed on the bare catalogue id is a bug.
- No GW data enters git — `apps/web/public/` is gitignored. Only scripts, config and app code are versioned.
- Manifest **v1 must keep working** (attributed to edition `10e`); only a shape that is neither v1 nor v2 degrades to bundled-only.
- With a single-edition registry the wizard must be **unchanged** — no segmented control, existing step indices intact.
- `apps/web` typecheck + build clean; existing web tests keep passing (78 today).
- No push to origin. Merge to LOCAL main only. Do NOT run `git stash`.

---

### Task C1: pipeline — multi-edition config, packing and manifest

**Files:**
- Modify: `scripts/catalogues.config.json` (v2 `editions` shape; add the 11e edition)
- Modify: `scripts/update-catalogues.mjs` (edition loop, per-edition output dir, format-aware guard)
- Modify: `scripts/build-catalogue-manifest.mjs` (scan edition subdirs, emit manifest v2)

**Interfaces:**
- Produces manifest v2: `{ version: 2, editions: [{id, name}], catalogues: [{id, edition, name, file}] }` where `file` is `catalogues/<editionId>/<slug>.ir.json`. Task C2 consumes exactly this shape.

- [ ] **Step 1: config v2.** Restructure `scripts/catalogues.config.json` to:

```json
{
  "editions": [
    { "id": "10e", "name": "10th Edition", "repo": "BSData/wh40k-10e", "ref": "main",
      "gameSystem": "Warhammer 40,000.gst", "catalogues": [ /* the existing 35 entries, verbatim */ ] },
    { "id": "11e", "name": "11th Edition", "repo": "BSData/wh40k-11e", "ref": "main",
      "gameSystem": "Warhammer 40,000.json", "catalogues": [ /* same 35 minus ynnari, .json filenames */ ] }
  ]
}
```

The 11e faction list mirrors 10e's slugs and names with `.cat` → `.json` in every `primary`/`libraries` path. **Omit `ynnari`** — `BSData/wh40k-11e` has no `Aeldari - Ynnari.json`. Every other 10e filename exists in 11e with the same name. Do not invent factions that are not in the 10e list.

- [ ] **Step 2: format-aware acquisition guard.** In `update-catalogues.mjs`, replace the XML-only `assertCatalogueFile(path, rootTag)` with a version that keys on the file extension:

```js
// Guard against a bad acquisition (missing/truncated/HTML-error file) before it reaches
// the parser as a silent 0-root catalogue. 10e ships XML, 11e ships JSON — check the
// shape each format actually has.
function assertCatalogueFile(path, kind) { // kind: "catalogue" | "gameSystem"
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const size = statSync(path).size;
  if (size < 200) throw new Error(`${path} is ${size}B — truncated or empty`);
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`${path} is not valid JSON — ${err.message}`);
    }
    if (!parsed || typeof parsed !== "object" || !(kind in parsed)) {
      throw new Error(`${path} has no "${kind}" key — not a BattleScribe ${kind} file`);
    }
    return;
  }
  if (!text.slice(0, 4096).includes(`<${kind}`)) throw new Error(`${path} is not a <${kind}… file`);
}
```

Update both call sites to pass `"catalogue"` / `"gameSystem"` instead of `"<catalogue"` / `"<gameSystem"`.

- [ ] **Step 3: edition loop.** In `update-catalogues.mjs`'s `main()`, normalize the config and loop editions. A legacy flat config (no `editions` key) becomes one `10e` edition so ad-hoc smoke configs keep working:

```js
// Legacy flat configs (a single repo/gameSystem + catalogues) are the pre-edition shape
// still used by ad-hoc smoke configs — treat them as a lone 10th-edition entry.
function editionsOf(config) {
  if (Array.isArray(config.editions)) return config.editions;
  return [{ id: "10e", name: "10th Edition", repo: config.repo, ref: config.ref,
            gameSystem: config.gameSystem, catalogues: config.catalogues }];
}
```

Each edition: clone into its own temp subdirectory, write packed IR to `join(OUT_DIR, edition.id)` (`mkdirSync` recursive), and run the existing per-faction parse/pack/validate/copy logic unchanged. The stale-file sweep now runs **per edition directory** against that edition's slugs. Wrap each edition's clone + faction loop in a try/catch that warns (`skipped edition <id>: <message>`) and continues — one edition's upstream outage must not lose the other. Build the manifest once, after all editions. Keep the `built`/total counters reporting across all editions.

- [ ] **Step 4: manifest v2 builder.** Rewrite `scripts/build-catalogue-manifest.mjs` to scan edition subdirectories:

```js
// Edition display names come from the pipeline config when it is present; an edition
// directory with no config entry still ships, labelled by its id.
const configPath = join(process.cwd(), "scripts/catalogues.config.json");
const editionNames = new Map();
if (existsSync(configPath)) {
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  for (const e of cfg.editions ?? []) editionNames.set(e.id, e.name);
}

function collect(dir, edition, prefix) { // prefix: path recorded in the manifest
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ir.json")).sort()) {
    const json = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (typeof json.id !== "string" || typeof json.name !== "string") {
      console.warn(`Skipping ${f}: missing id/name`);
      continue;
    }
    out.push({ id: json.id, edition, name: json.name, file: `${prefix}${f}` });
  }
  return out;
}
```

Walk `readdirSync(dir, { withFileTypes: true })`: each directory is an edition (`collect(join(dir, d.name), d.name, `catalogues/${d.name}/`)`); loose `*.ir.json` at the top level are collected as edition `10e` with prefix `catalogues/` (a stale flat output must degrade, not vanish). Emit:

```js
const editions = [...new Set(catalogues.map((c) => c.edition))].sort()
  .map((id) => ({ id, name: editionNames.get(id) ?? id }));
writeFileSync(out, JSON.stringify({ version: 2, editions, catalogues }, null, 2) + "\n");
console.log(`Wrote ${out} with ${catalogues.length} catalogue(s) across ${editions.length} edition(s).`);
```

- [ ] **Step 5: sanity-run the manifest builder.** With whatever `apps/web/public/catalogues/*.ir.json` exist locally, run `node scripts/build-catalogue-manifest.mjs` and confirm it writes a v2 manifest listing those files under edition `10e` with `catalogues/<file>` paths. Do NOT run `update-catalogues.mjs` (network + cargo; the controller runs it in C4).

- [ ] **Step 6: commit** — `feat(edition): multi-edition catalogue pipeline and manifest v2`.

---

### Task C2: registry — edition-aware descriptors

**Files:**
- Modify: `apps/web/src/registry/catalogueRegistry.ts`
- Modify: `apps/web/src/registry/catalogueRegistry.test.ts`
- Modify: `apps/web/src/App.tsx` (pass the bundled edition)

**Interfaces:**
- Consumes C1's manifest v2. Produces:

```ts
export type CatalogueDescriptor = {
  id: string;            // composite "<edition>:<catalogueId>" — opaque key, never parsed by callers
  catalogueId: string;   // the raw BSData catalogue id (NOT unique across editions)
  name: string;
  edition: string;       // e.g. "10e"
  editionName: string;   // e.g. "10th Edition"
  source: { kind: "bundled"; data: unknown } | { kind: "manifest"; file: string };
};
export function bundledDescriptor(data: unknown, edition: { id: string; name: string }): CatalogueDescriptor;
```

- [ ] **Step 1: write the failing tests.** In `catalogueRegistry.test.ts` add:

```ts
const v2 = {
  version: 2,
  editions: [{ id: "10e", name: "10th Edition" }, { id: "11e", name: "11th Edition" }],
  catalogues: [
    { id: "sm", edition: "10e", name: "Space Marines", file: "catalogues/10e/space-marines.ir.json" },
    { id: "sm", edition: "11e", name: "Space Marines", file: "catalogues/11e/space-marines.ir.json" },
  ],
};

it("keeps same-id catalogues from different editions as distinct descriptors", async () => {
  const reg = await loadRegistry(bundled, fetchOk(v2), "/catalogues.json");
  const sm = reg.filter((d) => d.catalogueId === "sm");
  expect(sm.map((d) => d.edition)).toEqual(["10e", "11e"]);
  expect(new Set(sm.map((d) => d.id)).size).toBe(2);
  expect(sm[1].editionName).toBe("11th Edition");
});

it("reads a v1 manifest as 10th edition", async () => {
  const v1 = { version: 1, catalogues: [{ id: "sm", name: "Space Marines", file: "catalogues/sm.ir.json" }] };
  const reg = await loadRegistry(bundled, fetchOk(v1), "/catalogues.json");
  const sm = reg.find((d) => d.catalogueId === "sm");
  expect(sm?.edition).toBe("10e");
  expect(sm?.editionName).toBe("10th Edition");
});
```

Reuse the file's existing bundled fixture and fetch stub (`fetchOk` here stands for whatever the file already uses to serve a JSON body — do not add a second helper). Run `pnpm --filter web test` → FAIL.

- [ ] **Step 2: implement.** Widen `CatalogueDescriptor` as above. `parseManifest` returns `{ version: 2, editions, catalogues }` for both inputs: for a v2 body validate `editions` (array of `{id, name}` strings) and require a string `edition` on every catalogue; for a v1 body map every catalogue to `edition: "10e"` and synthesize `editions: [{ id: "10e", name: "10th Edition" }]`. Anything else → `null` (existing warn + bundled-only degrade). In `loadRegistry`, build each descriptor with `id: `${c.edition}:${c.id}``, `catalogueId: c.id`, and `editionName` looked up from the manifest's `editions` (falling back to the edition id), and dedup on the composite id. `bundledDescriptor(data, edition)` sets `id: `${edition.id}:${cat.id}``, `catalogueId: cat.id`, `edition: edition.id`, `editionName: edition.name`.

- [ ] **Step 3: App wiring.** In `App.tsx`, `const bundled = bundledDescriptor(mini40k, { id: "10e", name: "10th Edition" });` — mini40k is a 10e-shaped fixture. Nothing else in `App` changes: `activeDescriptorId` is already an opaque string.

- [ ] **Step 4: verify.** `pnpm --filter web test` → PASS (all tests, including the pre-existing ones). `pnpm --filter web typecheck` (or `tsc --noEmit` per the package's script) and `pnpm --filter web build` clean.

- [ ] **Step 5: commit** — `feat(edition): edition-aware catalogue descriptors`.

---

### Task C3: wizard — the edition segmented control

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx`
- Modify: `apps/web/src/components/SetupWizard.test.tsx`
- Modify: `apps/web/src/styles.css` (or wherever `.faction-grid`/`.step-tab` live — follow the existing file)

**Interfaces:**
- Consumes C2's `CatalogueDescriptor` (`edition`, `editionName`). No prop signature change: the control derives everything from the existing `registry` + `activeDescriptorId` props.

- [ ] **Step 1: write the failing tests.** In `SetupWizard.test.tsx`, add a two-edition registry fixture and assert:
  - the segmented control renders one button per edition (`role="radio"` or `aria-pressed` buttons inside a container with `data-testid="edition-picker"`), and the active descriptor's edition is selected;
  - the faction grid shows ONLY that edition's factions;
  - clicking the other edition's segment switches the grid to that edition's factions and calls nothing (no `onSelectFaction` until a faction is clicked);
  - clicking a faction then calls `onSelectFaction` with that descriptor's composite `id`;
  - with a single-edition registry `queryByTestId("edition-picker")` is `null`.
  Run `pnpm --filter web test` → FAIL.

- [ ] **Step 2: implement.** In the step-1 (Faction) block, derive the edition list from `registry` preserving first-appearance order:

```tsx
const editions = registry
  ? registry.reduce<{ id: string; name: string }[]>((acc, d) => (
      acc.some((e) => e.id === d.edition) ? acc : [...acc, { id: d.edition, name: d.editionName }]
    ), [])
  : [];
const activeEdition = registry?.find((d) => d.id === activeDescriptorId)?.edition ?? editions[0]?.id;
const [edition, setEdition] = useState(activeEdition);
```

Render the control above `.faction-grid` only when `editions.length > 1`, and filter the grid to `d.edition === edition`. Keep the existing card markup, `chosen`/`aria-pressed` logic and the `factionError` line unchanged. Hooks must stay unconditional — declare the `useState` at component top level alongside the existing ones, not inside the `step === 1` branch.

- [ ] **Step 3: style.** Add a `.edition-picker` rule matching the existing segmented/tab styling in the app's stylesheet (reuse the `.step-tab` visual language; no new colour tokens).

- [ ] **Step 4: verify.** `pnpm --filter web test` → PASS (all tests). Typecheck + build clean.

- [ ] **Step 5: commit** — `feat(web): pick the edition when choosing a faction`.

---

### Task C4: real data + browser verification (controller, not committed)

- [ ] **Step 1:** run `node scripts/update-catalogues.mjs` for both editions; record per-edition faction counts and any skips.
- [ ] **Step 2:** confirm `apps/web/public/catalogues.json` is v2, lists both editions, and that `catalogues/11e/space-marines.ir.json` exists and carries `characteristicModifiers`.
- [ ] **Step 3:** run the dev server; in the wizard switch to 11th Edition, pick Space Marines, add a character, take an Artificer-Armour-style enhancement, and confirm the datasheet save changes (sub-project B visible in the browser at last). Confirm 10th Edition Space Marines still loads and renders unchanged.
- [ ] **Step 4:** record results in the ledger.

---

## Self-Review notes
- Spec coverage: C1 = spec §1–2 (config, pipeline, manifest); C2 = §3 (registry); C3 = §4 (wizard); C4 = §5 (data) + the spec's real-data testing section.
- Collision guard: the composite id is introduced in C2 and pinned by an explicit test; C1's manifest carries the `edition` field that makes it derivable.
- Naming consistency: `edition` (id string) and `editionName` (display) are used identically in C1's manifest, C2's descriptor and C3's control.
