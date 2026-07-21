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
