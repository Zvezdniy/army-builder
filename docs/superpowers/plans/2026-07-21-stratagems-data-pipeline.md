# Stratagems S-A — Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A build script that fetches the Wahapedia stratagem export and writes per-faction stratagem JSON + a manifest under `apps/web/public/stratagems/`, consumed later by S-B.

**Architecture:** A pure, unit-tested transform module (`scripts/stratagems/transform.mjs`) does CSV parsing, record→Stratagem mapping, Core-vs-faction bucketing, and manifest building. A thin orchestrator (`scripts/update-stratagems.mjs`) fetches, guards, calls the transform, and writes files atomically (build in memory, then write). A dedicated Vitest config (`scripts/vitest.config.ts`) runs the transform tests with **no** coverage gate, kept out of the packages' `turbo run test` so the engine's 100% gate is untouched.

**Tech Stack:** Node ESM `.mjs` (native `fetch`, Node 25), Vitest for the transform tests. No new runtime deps. No parser/engine/app changes.

## Global Constraints

- **Output is gitignored already:** `/apps/web/public/` is in `.gitignore`. Do **not** add a new ignore entry; do **not** commit any file under `apps/web/public/`.
- **Single network dependency:** fetch only `Stratagems.csv`. The faction mapping lives in `scripts/stratagems.config.json`; `Factions.csv` is not fetched.
- **Edition-agnostic, flat output:** no `10e/`/`11e/` subdirectories. One shared dataset (11e currently mirrors 10e byte-for-byte).
- **Source base URL:** `https://wahapedia.ru/wh40k10ed` (config `sourceBase`).
- **Browser User-Agent required** on the fetch, from config `userAgent`.
- **Core detection:** a Core stratagem is `faction_id === "" AND` the `type` prefix (text before the en-dash `–`, U+2013) trimmed `=== "Core"`. Expected Core count: **11**.
- **`id`:** use `rec.id` verbatim (Wahapedia's stable globally-unique id; all 1481 distinct). No synthesis.
- **Attribution string:** `"Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop."` (config `attribution`, echoed into the manifest).
- **Scripts tests run via `pnpm test:scripts`** (not `turbo run test`; scripts are not a package). `dangerouslyDisableSandbox: true` is required only for the live acceptance fetch in Task 5.
- **Commit messages** end with a blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Do **not** push.

## File Structure

- Create `scripts/stratagems/transform.mjs` — pure functions: `parseStratagemCsv`, `deriveCategory`, `coerceCp`, `recordToStratagem`, `bucketStratagems`, `buildManifest`, `validateCsvBody`.
- Create `scripts/stratagems/transform.test.mjs` — Vitest unit tests for the reader + transform + bucketing + manifest.
- Create `scripts/stratagems/config.test.mjs` — integrity test: real config vs `catalogues.config.json` slugs.
- Create `scripts/stratagems.config.json` — `sourceBase`, `userAgent`, `attribution`, `factionMap`, `canonicalSlug`.
- Create `scripts/vitest.config.ts` — Vitest project for `scripts/**/*.test.mjs`, node env, no coverage gate.
- Create `scripts/update-stratagems.mjs` — orchestrator (fetch → guard → transform → atomic write).
- Modify `package.json` — add `test:scripts` and `update-stratagems` npm scripts.

---

### Task 1: CSV reader + scripts test harness

**Files:**
- Create: `scripts/stratagems/transform.mjs`
- Create: `scripts/stratagems/transform.test.mjs`
- Create: `scripts/vitest.config.ts`
- Modify: `package.json` (add `test:scripts` script)

**Interfaces:**
- Produces: `parseStratagemCsv(text: string) => Array<Record<column,string>>` where columns are `faction_id, name, id, type, cp_cost, legend, turn, phase, detachment, detachment_id, description`. Reassembles records whose `description` contains embedded newlines by accumulating physical lines until the record's `|` count reaches the header's; strips the UTF-8 BOM; tolerates the trailing empty 11th field.

- [ ] **Step 1: Add the `test:scripts` npm script**

In `package.json`, add to `"scripts"` (after the existing `update-catalogues` line):

```json
    "test:scripts": "vitest run --config scripts/vitest.config.ts"
```

- [ ] **Step 2: Create the scripts Vitest config**

Create `scripts/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// Build-pipeline scripts get their own Vitest project: node env, NO coverage
// gate (they are glue, not the engine's 100%-covered logic). Kept out of
// `turbo run test`, which stays package-scoped, so this never touches the
// engine's 100% threshold.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/**/*.test.mjs"],
  },
});
```

- [ ] **Step 3: Write the failing reader test**

Create `scripts/stratagems/transform.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { parseStratagemCsv } from "./transform.mjs";

// Real-shaped fixture: BOM, header with 11 named columns + trailing empty field,
// a one-line record, and a record whose description spans two physical lines.
const HEADER = "faction_id|name|id|type|cp_cost|legend|turn|phase|detachment|detachment_id|description|";
const FIXTURE =
  "﻿" + HEADER + "\n" +
  "SM|HEROES OF THE CHAPTER|000008495003|1st Company Task Force – Battle Tactic Stratagem|1|leg|Your turn|Shooting phase|1st Company Task Force|000000798|<b>WHEN:</b> Your Shooting phase.|\n" +
  "AdM|THREAT TARGETERS|000010748005|Eradication Cohort – Wargear Stratagem|1|Supplementary routines identify targets and assist in their\nrapid elimination.|Your turn|Shooting phase|Eradication Cohort|000010900|<b>WHEN:</b> Your Shooting phase.|\n";

describe("parseStratagemCsv", () => {
  it("recovers all records, including one with an embedded newline", () => {
    const rows = parseStratagemCsv(FIXTURE);
    expect(rows).toHaveLength(2);
  });

  it("strips the BOM and maps named columns by position", () => {
    const [first] = parseStratagemCsv(FIXTURE);
    expect(first.faction_id).toBe("SM");
    expect(first.name).toBe("HEROES OF THE CHAPTER");
    expect(first.id).toBe("000008495003");
    expect(first.cp_cost).toBe("1");
    expect(first.detachment_id).toBe("000000798");
    expect(first.description).toBe("<b>WHEN:</b> Your Shooting phase.");
  });

  it("keeps an embedded newline inside the description field", () => {
    const rows = parseStratagemCsv(FIXTURE);
    expect(rows[1].legend).toContain("\n");
    expect(rows[1].name).toBe("THREAT TARGETERS");
    expect(rows[1].description).toBe("<b>WHEN:</b> Your Shooting phase.");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test:scripts`
Expected: FAIL — `parseStratagemCsv` is not defined / module not found.

- [ ] **Step 5: Implement `parseStratagemCsv`**

Create `scripts/stratagems/transform.mjs`:

```js
// Pure, network-free transforms for the Wahapedia stratagem export. Unit-tested
// via scripts/stratagems/transform.test.mjs (no coverage gate — see scripts/vitest.config.ts).

// Wahapedia CSV: pipe-delimited, no quoting, a trailing empty field after the
// last column, and descriptions that CAN contain literal newlines. Reassemble a
// record by accumulating physical lines until its '|' count reaches the header's.
export function parseStratagemCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split("\n");
  const header = lines[0].replace(/\r$/, "");
  const names = header.split("|").slice(0, -1); // drop the trailing empty field name
  const pipeCount = (header.match(/\|/g) || []).length;

  const records = [];
  let buf = "";
  for (let i = 1; i < lines.length; i++) {
    buf = buf === "" ? lines[i] : buf + "\n" + lines[i];
    if ((buf.match(/\|/g) || []).length >= pipeCount) {
      records.push(buf);
      buf = "";
    }
  }
  if (buf.trim() !== "") records.push(buf);

  return records.map((r) => {
    const parts = r.replace(/\r$/, "").split("|");
    const obj = {};
    names.forEach((n, idx) => { obj[n] = parts[idx] ?? ""; });
    return obj;
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test:scripts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/stratagems/transform.mjs scripts/stratagems/transform.test.mjs scripts/vitest.config.ts package.json
git commit -m "$(printf 'feat(stratagems): S-A CSV reader + scripts test harness\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Record → `Stratagem` transform

**Files:**
- Modify: `scripts/stratagems/transform.mjs`
- Modify: `scripts/stratagems/transform.test.mjs`

**Interfaces:**
- Consumes: a parsed record object from `parseStratagemCsv`.
- Produces:
  - `deriveCategory(type: string) => string` — the category between the en-dash and the trailing "Stratagem" (`"1st Company Task Force – Battle Tactic Stratagem"` → `"Battle Tactic"`; `"… – Stratagem"` → `""`; `""` → `""`).
  - `coerceCp(s: string) => number` — `parseInt`, `NaN` → `0`.
  - `recordToStratagem(rec) => { id, name, category, cpCost, turn, phase, detachment, detachmentId, legend, description }` — `id` is `rec.id` verbatim; `description` preserved as-is.

- [ ] **Step 1: Write the failing transform tests**

Append to `scripts/stratagems/transform.test.mjs`:

```js
import { deriveCategory, coerceCp, recordToStratagem } from "./transform.mjs";

describe("deriveCategory", () => {
  it("extracts the category between the en-dash and 'Stratagem'", () => {
    expect(deriveCategory("1st Company Task Force – Battle Tactic Stratagem")).toBe("Battle Tactic");
    expect(deriveCategory("Core – Strategic Ploy Stratagem")).toBe("Strategic Ploy");
  });
  it("returns empty for a bare '… – Stratagem' or empty type", () => {
    expect(deriveCategory("Serpent's Brood – Stratagem")).toBe("");
    expect(deriveCategory("")).toBe("");
  });
});

describe("coerceCp", () => {
  it("parses an integer, defaulting non-numeric to 0", () => {
    expect(coerceCp("1")).toBe(1);
    expect(coerceCp("2")).toBe(2);
    expect(coerceCp("")).toBe(0);
    expect(coerceCp("free")).toBe(0);
  });
});

describe("recordToStratagem", () => {
  const detRec = {
    faction_id: "SM", name: "ARMOUR OF CONTEMPT", id: "000008495003",
    type: "1st Company Task Force – Battle Tactic Stratagem", cp_cost: "1",
    legend: "flavour", turn: "Either Player's turn", phase: "Shooting or Fight phase",
    detachment: "1st Company Task Force", detachment_id: "000000798",
    description: "<b>WHEN:</b> …",
  };
  it("maps a detachment record, using rec.id verbatim", () => {
    expect(recordToStratagem(detRec)).toEqual({
      id: "000008495003", name: "ARMOUR OF CONTEMPT", category: "Battle Tactic",
      cpCost: 1, turn: "Either Player's turn", phase: "Shooting or Fight phase",
      detachment: "1st Company Task Force", detachmentId: "000000798",
      legend: "flavour", description: "<b>WHEN:</b> …",
    });
  });
  it("maps a Core record (empty detachment, category still parsed)", () => {
    const core = { faction_id: "", name: "GRENADE", id: "000000123",
      type: "Core – Wargear Stratagem", cp_cost: "1", legend: "", turn: "Your turn",
      phase: "Shooting phase", detachment: "", detachment_id: "", description: "<b>WHEN:</b> …" };
    const out = recordToStratagem(core);
    expect(out.detachment).toBe("");
    expect(out.detachmentId).toBe("");
    expect(out.category).toBe("Wargear");
    expect(out.id).toBe("000000123");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:scripts`
Expected: FAIL — `deriveCategory` / `coerceCp` / `recordToStratagem` not exported.

- [ ] **Step 3: Implement the transform functions**

Append to `scripts/stratagems/transform.mjs`:

```js
// "1st Company Task Force – Battle Tactic Stratagem" → "Battle Tactic".
// The owner (detachment or "Core") is before the en-dash; the category is the
// segment after it, minus the trailing "Stratagem". A bare "… – Stratagem" → "".
export function deriveCategory(type) {
  if (!type) return "";
  const seg = type.split("–").pop().trim();
  return seg.replace(/\s*Stratagem\s*$/i, "").trim();
}

export function coerceCp(s) {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function recordToStratagem(rec) {
  return {
    id: rec.id,
    name: rec.name,
    category: deriveCategory(rec.type),
    cpCost: coerceCp(rec.cp_cost),
    turn: rec.turn,
    phase: rec.phase,
    detachment: rec.detachment,
    detachmentId: rec.detachment_id,
    legend: rec.legend,
    description: rec.description,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:scripts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/stratagems/transform.mjs scripts/stratagems/transform.test.mjs
git commit -m "$(printf 'feat(stratagems): S-A record→Stratagem transform\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Core-vs-faction bucketing + manifest builder

**Files:**
- Modify: `scripts/stratagems/transform.mjs`
- Modify: `scripts/stratagems/transform.test.mjs`

**Interfaces:**
- Consumes: parsed records, plus a config-shaped object `{ attribution, factionMap: {slug→wahaId}, canonicalSlug: {wahaId→slug} }`.
- Produces:
  - `isCore(rec) => boolean` — `rec.faction_id === "" AND` type-prefix (before the en-dash, trimmed) `=== "Core"`.
  - `bucketStratagems(records, factionIds: Set<string>) => { core: Stratagem[], byFaction: Map<wahaId, Stratagem[]>, dropped: Map<string, number> }` — `dropped` counts records that are neither Core nor an in-map faction, keyed by a label (`faction_id` or the type-prefix for empty-faction non-Core rows).
  - `buildManifest(config, buckets) => { version:1, source:"Wahapedia", attribution, core:{file,count}, factions:[{slug,wahapediaFactionId,file,count}] }` — one `factions` entry per `factionMap` slug; `file` is `stratagems/${canonicalSlug[wahaId]}.json`.

- [ ] **Step 1: Write the failing bucketing + manifest tests**

Append to `scripts/stratagems/transform.test.mjs`:

```js
import { isCore, bucketStratagems, buildManifest } from "./transform.mjs";

const rec = (o) => ({ faction_id: "", name: "X", id: "i" + Math.abs(0), type: "", cp_cost: "1",
  legend: "", turn: "", phase: "", detachment: "", detachment_id: "", description: "", ...o });

describe("isCore", () => {
  it("is true only for empty faction_id with a 'Core' type-prefix", () => {
    expect(isCore(rec({ faction_id: "", type: "Core – Wargear Stratagem" }))).toBe(true);
    expect(isCore(rec({ faction_id: "", type: "Boarding Actions – Battle Tactic Stratagem" }))).toBe(false);
    expect(isCore(rec({ faction_id: "", type: "Core Stratagem – Strategic Ploy Stratagem" }))).toBe(false);
    expect(isCore(rec({ faction_id: "SM", type: "Core – Wargear Stratagem" }))).toBe(false);
  });
});

describe("bucketStratagems", () => {
  const records = [
    rec({ faction_id: "", id: "c1", type: "Core – Wargear Stratagem", name: "GRENADE" }),
    rec({ faction_id: "", id: "b1", type: "Boarding Actions – Battle Tactic Stratagem", name: "EXPLOSIVE CLEARANCE" }),
    rec({ faction_id: "SM", id: "s1", type: "Foo – Battle Tactic Stratagem", detachment_id: "d1", detachment: "Foo" }),
    rec({ faction_id: "TL", id: "t1", type: "Bar – Battle Tactic Stratagem", detachment_id: "d2", detachment: "Bar" }),
  ];
  const factionIds = new Set(["SM", "NEC"]);
  it("splits Core, per-faction, and drops game-mode + out-of-map", () => {
    const { core, byFaction, dropped } = bucketStratagems(records, factionIds);
    expect(core.map((s) => s.name)).toEqual(["GRENADE"]);
    expect(byFaction.get("SM")).toHaveLength(1);
    expect(byFaction.has("NEC")).toBe(false);
    expect(dropped.get("Boarding Actions")).toBe(1); // empty-faction non-Core
    expect(dropped.get("TL")).toBe(1);               // out-of-map faction
  });
});

describe("buildManifest", () => {
  const config = {
    attribution: "ATTR",
    factionMap: { "space-marines": "SM", "blood-angels": "SM", "necrons": "NEC" },
    canonicalSlug: { SM: "space-marines", NEC: "necrons" },
  };
  const buckets = {
    core: [rec({}), rec({})],
    byFaction: new Map([["SM", [rec({}), rec({})]], ["NEC", [rec({})]]]),
    dropped: new Map(),
  };
  it("emits one entry per slug, chapters sharing the SM file", () => {
    const m = buildManifest(config, buckets);
    expect(m.version).toBe(1);
    expect(m.attribution).toBe("ATTR");
    expect(m.core).toEqual({ file: "stratagems/_core.json", count: 2 });
    const bySlug = Object.fromEntries(m.factions.map((f) => [f.slug, f]));
    expect(bySlug["space-marines"]).toEqual({ slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 2 });
    expect(bySlug["blood-angels"].file).toBe("stratagems/space-marines.json");
    expect(bySlug["blood-angels"].count).toBe(2);
    expect(bySlug["necrons"].count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:scripts`
Expected: FAIL — `isCore` / `bucketStratagems` / `buildManifest` not exported.

- [ ] **Step 3: Implement bucketing + manifest**

Append to `scripts/stratagems/transform.mjs`:

```js
// The owner label before the en-dash ("Core", "Boarding Actions", a detachment name).
function typePrefix(type) {
  return (type || "").split("–")[0].trim();
}

// A universal Core stratagem: no faction AND owner exactly "Core". This excludes
// empty-faction game-mode rows (Boarding Actions, Challenger) and the "Core
// Stratagem" artefact rows.
export function isCore(rec) {
  return rec.faction_id === "" && typePrefix(rec.type) === "Core";
}

export function bucketStratagems(records, factionIds) {
  const core = [];
  const byFaction = new Map();
  const dropped = new Map();
  const bump = (key) => dropped.set(key, (dropped.get(key) ?? 0) + 1);
  for (const rec of records) {
    if (isCore(rec)) { core.push(recordToStratagem(rec)); continue; }
    if (rec.faction_id === "") { bump(typePrefix(rec.type) || "(blank)"); continue; }
    if (!factionIds.has(rec.faction_id)) { bump(rec.faction_id); continue; }
    if (!byFaction.has(rec.faction_id)) byFaction.set(rec.faction_id, []);
    byFaction.get(rec.faction_id).push(recordToStratagem(rec));
  }
  return { core, byFaction, dropped };
}

export function buildManifest(config, buckets) {
  const factions = Object.entries(config.factionMap).map(([slug, wahaId]) => {
    const canonical = config.canonicalSlug[wahaId];
    return {
      slug,
      wahapediaFactionId: wahaId,
      file: `stratagems/${canonical}.json`,
      count: buckets.byFaction.get(wahaId)?.length ?? 0,
    };
  });
  return {
    version: 1,
    source: "Wahapedia",
    attribution: config.attribution,
    core: { file: "stratagems/_core.json", count: buckets.core.length },
    factions,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:scripts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add scripts/stratagems/transform.mjs scripts/stratagems/transform.test.mjs
git commit -m "$(printf 'feat(stratagems): S-A Core/faction bucketing + manifest builder\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Config file + config-integrity test

**Files:**
- Create: `scripts/stratagems.config.json`
- Create: `scripts/stratagems/config.test.mjs`

**Interfaces:**
- Consumes: `scripts/catalogues.config.json` (existing) for the authoritative slug list; `scripts/stratagems.config.json` (this task).
- Produces: the real `factionMap` / `canonicalSlug` used by the orchestrator (Task 5). The integrity test guarantees every catalogue slug is mapped and every mapped Wahapedia code has a canonical slug.

- [ ] **Step 1: Create the config file**

Create `scripts/stratagems.config.json`:

```json
{
  "sourceBase": "https://wahapedia.ru/wh40k10ed",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "attribution": "Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop.",
  "factionMap": {
    "space-marines": "SM", "blood-angels": "SM", "dark-angels": "SM", "space-wolves": "SM",
    "black-templars": "SM", "deathwatch": "SM", "ultramarines": "SM", "imperial-fists": "SM",
    "iron-hands": "SM", "raven-guard": "SM", "salamanders": "SM", "white-scars": "SM",
    "chaos-space-marines": "CSM", "aeldari": "AE", "ynnari": "AE", "drukhari": "DRU",
    "necrons": "NEC", "orks": "ORK", "tyranids": "TYR", "genestealer-cults": "GC",
    "astra-militarum": "AM", "agents-of-the-imperium": "AoI", "adeptus-mechanicus": "AdM",
    "adeptus-custodes": "AC", "adepta-sororitas": "AS", "grey-knights": "GK",
    "imperial-knights": "QI", "tau-empire": "TAU", "leagues-of-votann": "LoV",
    "chaos-daemons": "CD", "chaos-knights": "QT", "death-guard": "DG",
    "thousand-sons": "TS", "emperors-children": "EC", "world-eaters": "WE"
  },
  "canonicalSlug": {
    "SM": "space-marines", "CSM": "chaos-space-marines", "AE": "aeldari", "DRU": "drukhari",
    "NEC": "necrons", "ORK": "orks", "TYR": "tyranids", "GC": "genestealer-cults",
    "AM": "astra-militarum", "AoI": "agents-of-the-imperium", "AdM": "adeptus-mechanicus",
    "AC": "adeptus-custodes", "AS": "adepta-sororitas", "GK": "grey-knights",
    "QI": "imperial-knights", "TAU": "tau-empire", "LoV": "leagues-of-votann",
    "CD": "chaos-daemons", "QT": "chaos-knights", "DG": "death-guard",
    "TS": "thousand-sons", "EC": "emperors-children", "WE": "world-eaters"
  }
}
```

- [ ] **Step 2: Write the failing integrity test**

Create `scripts/stratagems/config.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const strat = JSON.parse(readFileSync(join(here, "../stratagems.config.json"), "utf8"));
const cats = JSON.parse(readFileSync(join(here, "../catalogues.config.json"), "utf8"));

// Every catalogue slug across every edition (10e includes Ynnari; 11e drops it).
const catalogueSlugs = new Set(cats.editions.flatMap((e) => e.catalogues.map((c) => c.slug)));

describe("stratagems.config integrity", () => {
  it("maps every catalogue slug to a Wahapedia faction", () => {
    const missing = [...catalogueSlugs].filter((s) => !(s in strat.factionMap));
    expect(missing).toEqual([]);
  });
  it("has a canonical slug for every mapped Wahapedia code", () => {
    const codes = new Set(Object.values(strat.factionMap));
    const missing = [...codes].filter((c) => !(c in strat.canonicalSlug));
    expect(missing).toEqual([]);
  });
  it("every canonical slug is itself a mapped catalogue slug", () => {
    const bad = Object.values(strat.canonicalSlug).filter((s) => !catalogueSlugs.has(s));
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes (config already correct)**

Run: `pnpm test:scripts`
Expected: PASS. (This test asserts the just-authored config is complete; if it fails, a slug is missing from `factionMap` or `canonicalSlug` — fix the config, not the test.)

- [ ] **Step 4: Commit**

```bash
git add scripts/stratagems.config.json scripts/stratagems/config.test.mjs
git commit -m "$(printf 'feat(stratagems): S-A pipeline config + slug-mapping integrity test\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Orchestrator + live acceptance run

**Files:**
- Create: `scripts/update-stratagems.mjs`
- Modify: `package.json` (add `update-stratagems` script)

**Interfaces:**
- Consumes: `parseStratagemCsv`, `bucketStratagems`, `buildManifest`, `validateCsvBody` from `transform.mjs`; `scripts/stratagems.config.json`.
- Produces: `apps/web/public/stratagems/_core.json`, `apps/web/public/stratagems/<canonical-slug>.json` (one per Wahapedia faction), `apps/web/public/stratagems.json` (manifest). Adds `validateCsvBody(text, {minBytes, headerPrefix})` to `transform.mjs` (throws on a short/wrong-header body).

- [ ] **Step 1: Write the failing `validateCsvBody` test**

Append to `scripts/stratagems/transform.test.mjs`:

```js
import { validateCsvBody } from "./transform.mjs";

describe("validateCsvBody", () => {
  const opts = { minBytes: 20, headerPrefix: "faction_id|name|id|type" };
  it("passes a well-formed body", () => {
    expect(() => validateCsvBody("faction_id|name|id|type|more|padding|here", opts)).not.toThrow();
  });
  it("throws on a too-short body", () => {
    expect(() => validateCsvBody("short", opts)).toThrow(/floor/);
  });
  it("throws on a wrong header (e.g. an HTML error page)", () => {
    expect(() => validateCsvBody("<html>error</html> and some more padding text", opts)).toThrow(/header/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:scripts`
Expected: FAIL — `validateCsvBody` not exported.

- [ ] **Step 3: Implement `validateCsvBody`**

Append to `scripts/stratagems/transform.mjs`:

```js
// Guard a fetched body before it can overwrite good data: reject a truncated body
// or an HTML error page whose first line is not the expected pipe header.
export function validateCsvBody(text, { minBytes, headerPrefix }) {
  if (text.length < minBytes) {
    throw new Error(`body ${text.length}B < ${minBytes}B floor — truncated or error page`);
  }
  const first = text.replace(/^﻿/, "").split("\n", 1)[0];
  if (!first.startsWith(headerPrefix)) {
    throw new Error(`unexpected header "${first.slice(0, 40)}" — not the Wahapedia stratagem CSV`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:scripts`
Expected: PASS (all transform + config tests).

- [ ] **Step 5: Create the orchestrator**

Create `scripts/update-stratagems.mjs`:

```js
#!/usr/bin/env node
// Refresh the local stratagem library from the Wahapedia data export: fetch the
// pipe-delimited Stratagems.csv, transform it to per-faction JSON + a manifest,
// and write them into apps/web/public/stratagems/. No GW data enters git —
// apps/web/public/ is gitignored. Only this script + its config are versioned.
//
// Edition-agnostic: Wahapedia's 11e export currently mirrors 10e byte-for-byte,
// so one shared dataset serves both editions. Point config.sourceBase at wh40k11ed
// when it carries real 11e content.
//
// Usage: node scripts/update-stratagems.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStratagemCsv, bucketStratagems, buildManifest, validateCsvBody } from "./stratagems/transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "apps/web/public");
const OUT_DIR = join(PUBLIC_DIR, "stratagems");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "scripts/stratagems.config.json"), "utf8"));
const MIN_RECORDS = 1000;

async function main() {
  const url = `${CONFIG.sourceBase}/Stratagems.csv`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, { headers: { "User-Agent": CONFIG.userAgent } });
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const text = await res.text();
  validateCsvBody(text, { minBytes: 100_000, headerPrefix: "faction_id|name|id|type" });

  const records = parseStratagemCsv(text);
  if (records.length < MIN_RECORDS) {
    throw new Error(`only ${records.length} records — reader broke or thin data`);
  }

  const factionIds = new Set(Object.keys(CONFIG.canonicalSlug));
  const buckets = bucketStratagems(records, factionIds);
  const manifest = buildManifest(CONFIG, buckets);

  // Build every output in memory first; only write once all are ready, so a
  // parse/validate failure never leaves a half-written directory.
  const files = new Map();
  files.set(join(OUT_DIR, "_core.json"),
    JSON.stringify({ source: "Wahapedia", kind: "core", stratagems: buckets.core }, null, 2) + "\n");
  for (const [wahaId, strats] of buckets.byFaction) {
    const canonical = CONFIG.canonicalSlug[wahaId];
    files.set(join(OUT_DIR, `${canonical}.json`),
      JSON.stringify({ source: "Wahapedia", kind: "faction", wahapediaFactionId: wahaId, stratagems: strats }, null, 2) + "\n");
  }
  files.set(join(PUBLIC_DIR, "stratagems.json"), JSON.stringify(manifest, null, 2) + "\n");

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [p, content] of files) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  const droppedSummary = [...buckets.dropped].map(([f, n]) => `${f}:${n}`).join(", ") || "none";
  console.log(`Wrote ${buckets.core.length} core, ${buckets.byFaction.size} faction files, ` +
    `manifest ${manifest.factions.length} slugs. Dropped: ${droppedSummary}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Add the `update-stratagems` npm script**

In `package.json`, add to `"scripts"`:

```json
    "update-stratagems": "node scripts/update-stratagems.mjs"
```

- [ ] **Step 7: Live acceptance run** (requires network — `dangerouslyDisableSandbox: true`)

Run: `pnpm update-stratagems`
Expected stdout ends with roughly:
`Wrote 11 core, 23 faction files, manifest 35 slugs. Dropped: Boarding Actions:5, Challenger:9, Core Stratagem:3, TL:… , UN:… , UA:…`
(Exact dropped labels/counts for out-of-map factions may vary; Core must be 11, faction files 23, manifest 35.)

- [ ] **Step 8: Verify the written output**

Run:
```bash
node -e "const m=require('./apps/web/public/stratagems.json'); console.log('version',m.version,'core',m.core.count,'factions',m.factions.length); const sm=require('./apps/web/public/stratagems/space-marines.json'); console.log('SM kind',sm.kind,'count',sm.stratagems.length); const c=require('./apps/web/public/stratagems/_core.json'); console.log('core names',c.stratagems.map(s=>s.name).join(', '));"
```
Expected: `version 1 core 11 factions 35`; `SM kind faction count 255`; core names list the 11 GW core stratagems (Command Re-roll, Go to Ground, Insane Bravery, Epic Challenge, Heroic Intervention, Counter-offensive, Tank Shock, Rapid Ingress, Fire Overwatch, Grenade, Smokescreen).

- [ ] **Step 9: Confirm nothing under `apps/web/public/` is staged**

Run: `git status --porcelain apps/web/public`
Expected: **empty output** (the whole dir is gitignored — the data must not be committed).

- [ ] **Step 10: Commit** (script + package.json only; no data)

```bash
git add scripts/update-stratagems.mjs scripts/stratagems/transform.mjs scripts/stratagems/transform.test.mjs package.json
git commit -m "$(printf 'feat(stratagems): S-A orchestrator — fetch, guard, write per-faction JSON + manifest\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- Source fetch (single CSV, UA, guard) → Task 5. ✓
- CSV embedded-newline reassembly → Task 1. ✓
- Record→Stratagem shape, `rec.id` verbatim, category parse, cp coerce → Task 2. ✓
- Two-tier + drop classification (Core=11 by type-prefix; drop game-mode/out-of-map) → Task 3. ✓
- 35-slug faction mapping, chapters→SM, canonical slug → Task 4 (config) + Task 3 (manifest builder). ✓
- Output shape (`_core.json`, `<faction>.json`, `stratagems.json` manifest), atomic write, gitignored → Task 5. ✓
- Attribution string in manifest → Task 3 (builder) + Task 4 (config value) + Task 5 (real run). ✓
- Edition-agnostic flat output → Task 5 (no edition subdirs). ✓
- Non-goals (no domain/UI/CI/sanitisation) → nothing in the plan builds them. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `parseStratagemCsv`, `deriveCategory`, `coerceCp`, `recordToStratagem`, `isCore`, `bucketStratagems`, `buildManifest`, `validateCsvBody` are defined once and referenced with the same names/signatures across tasks; the Stratagem field names (`id, name, category, cpCost, turn, phase, detachment, detachmentId, legend, description`) match between Task 2's producer and Task 5's writer; manifest fields (`version, source, attribution, core{file,count}, factions[{slug,wahapediaFactionId,file,count}]`) match between Task 3's builder and Task 5's verification. ✓
