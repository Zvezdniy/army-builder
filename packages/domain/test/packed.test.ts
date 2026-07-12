import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry } from "../src/ir";
import { IrCatalogue as IrCatalogueSchema } from "../src/ir";
import { canonicalKey, packCatalogue, rehydrateCatalogue, loadCatalogue, PackedCatalogue } from "../src/packed";

// Minimal valid entry (Zod fills defaults on parse). Build via schema so runtime
// shape matches what the app feeds pack().
const entry = (over: Partial<IrEntry> & { id: string; name: string }): IrEntry =>
  IrCatalogueSchema.parse({
    id: "c",
    name: "c",
    gameSystemId: "g",
    revision: 1,
    entries: [over],
  }).entries[0]!;

const cat = (entries: IrEntry[]): IrCatalogue =>
  IrCatalogueSchema.parse({ id: "c", name: "c", gameSystemId: "g", revision: 1, entries });

describe("canonicalKey", () => {
  it("is order-independent over object keys but content-sensitive", () => {
    expect(canonicalKey({ a: 1, b: 2 })).toBe(canonicalKey({ b: 2, a: 1 }));
    expect(canonicalKey({ a: 1 })).not.toBe(canonicalKey({ a: 2 }));
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
  });
});

describe("packCatalogue", () => {
  it("dedups identical inlined subtrees into one pool entry", () => {
    const shared = entry({ id: "w", name: "Bolter" });
    const a = entry({ id: "a", name: "A", children: [shared] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const packed = packCatalogue(cat([a, b]));
    // pool: shared(1) + a + b = 3 distinct; a and b each reference shared's index
    expect(packed.entryPool.length).toBe(3);
    expect(packed.entries.length).toBe(2);
    const poolA = packed.entryPool[packed.entries[0]!]!;
    const poolB = packed.entryPool[packed.entries[1]!]!;
    expect(poolA.children[0]).toBe(poolB.children[0]); // same shared index
  });

  it("keeps divergent same-id clones as separate pool entries (keystone)", () => {
    const a = entry({ id: "x", name: "X", costs: [{ name: "pts", value: 3 }] });
    const b = entry({ id: "x", name: "X", costs: [{ name: "pts", value: 5 }] });
    const packed = packCatalogue(cat([a, b]));
    expect(packed.entryPool.length).toBe(2);
  });

  it("treats child order as significant", () => {
    const p = entry({ id: "c1", name: "c1" });
    const q = entry({ id: "c2", name: "c2" });
    const ab = entry({ id: "ab", name: "ab", children: [p, q] });
    const ba = entry({ id: "ba", name: "ba", children: [q, p] });
    const packed = packCatalogue(cat([ab, ba]));
    // p, q, ab, ba => 4 distinct (ab and ba differ in child order + own id)
    expect(packed.entryPool.length).toBe(4);
  });
});

describe("packCatalogue defensive fills", () => {
  it("materializes optional fields absent on a hand-built (non-parsed) entry", () => {
    // The IrEntry interface leaves groups/profiles/hidden/… optional; a catalogue
    // built without Zod (e.g. a hand-authored fixture) may omit them. pack must
    // still produce a schema-valid pool entry.
    const bare = {
      id: "x",
      name: "X",
      costs: [],
      categories: [],
      constraints: [],
      children: [],
    } as unknown as IrEntry;
    const c = { id: "c", name: "c", gameSystemId: "g", revision: 1, entries: [bare] } as unknown as IrCatalogue;
    const packed = packCatalogue(c);
    const pooled = packed.entryPool[0]!;
    expect(pooled.groups).toEqual([]);
    expect(pooled.profiles).toEqual([]);
    expect(pooled.hidden).toBe(false);
    expect(pooled.visibilityModifiers).toEqual([]);
    expect(pooled.validationRules).toEqual([]);
    expect(pooled.categoryModifiers).toEqual([]);
    expect(() => PackedCatalogue.parse(packed)).not.toThrow();
  });
});

describe("rehydrateCatalogue", () => {
  it("shares one object for identical subtrees (DAG)", () => {
    const shared = entry({ id: "w", name: "Bolter" });
    const a = entry({ id: "a", name: "A", children: [shared] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const r = rehydrateCatalogue(packCatalogue(cat([a, b])));
    expect(r.entries[0]!.children[0]).toBe(r.entries[1]!.children[0]); // same ref
  });

  it("round-trips: rehydrate(pack(c)) deep-equals c", () => {
    const shared = entry({ id: "w", name: "Bolter", costs: [{ name: "pts", value: 2 }] });
    const a = entry({ id: "a", name: "A", children: [shared], categories: ["k"] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const c = cat([a, b]);
    expect(rehydrateCatalogue(packCatalogue(c))).toEqual(c);
  });

  it("produces a PackedCatalogue that its own schema accepts", () => {
    const packed = packCatalogue(cat([entry({ id: "a", name: "A" })]));
    expect(() => PackedCatalogue.parse(packed)).not.toThrow();
  });

  it("round-trips ruleTexts when present", () => {
    const c = IrCatalogueSchema.parse({
      id: "c",
      name: "c",
      gameSystemId: "g",
      revision: 1,
      entries: [{ id: "a", name: "A" }],
      ruleTexts: { r1: "Rule one text" },
    });
    const back = rehydrateCatalogue(packCatalogue(c));
    expect(back.ruleTexts).toEqual({ r1: "Rule one text" });
    expect(back).toEqual(c);
  });

  it("throws on a child index that points outside the pool", () => {
    const packed = PackedCatalogue.parse({
      format: "packed-v1",
      id: "c",
      name: "c",
      gameSystemId: "g",
      revision: 1,
      entryPool: [{ id: "a", name: "A", children: [99] }],
      entries: [0],
    });
    expect(() => rehydrateCatalogue(packed)).toThrow(/out of range/);
  });
});

describe("loadCatalogue", () => {
  const tree = cat([entry({ id: "a", name: "A" })]);

  it("rehydrates a packed-v1 payload", () => {
    const packed = packCatalogue(tree);
    expect(loadCatalogue(JSON.parse(JSON.stringify(packed)))).toEqual(tree);
  });

  it("parses a plain tree IrCatalogue (backward compatible)", () => {
    expect(loadCatalogue(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
  });

  it("throws on a malformed packed payload", () => {
    expect(() => loadCatalogue({ format: "packed-v1", id: "x" })).toThrow();
  });

  it("routes non-object / nullish input to the tree schema (which rejects it)", () => {
    expect(() => loadCatalogue(null)).toThrow();
    expect(() => loadCatalogue("not a catalogue")).toThrow();
  });
});
