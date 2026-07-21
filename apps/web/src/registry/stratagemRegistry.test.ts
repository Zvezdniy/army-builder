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
