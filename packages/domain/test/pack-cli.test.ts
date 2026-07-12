import { describe, it, expect } from "vitest";
import { IrCatalogue as IrCatalogueSchema } from "../src/ir";
import { packCatalogue, loadCatalogue } from "../src/packed";

// The CLI is a thin file wrapper around packCatalogue; this test pins the
// transform contract the CLI relies on: a parsed tree, packed then loaded,
// equals the parsed tree, and the pool is strictly smaller than the node count.
describe("pack CLI transform contract", () => {
  it("pack then load restores the parsed catalogue and shrinks the pool", () => {
    const tree = IrCatalogueSchema.parse({
      id: "c",
      name: "c",
      gameSystemId: "g",
      revision: 1,
      entries: [
        { id: "a", name: "A", children: [{ id: "w", name: "Bolter" }] },
        { id: "b", name: "B", children: [{ id: "w", name: "Bolter" }] },
      ],
    });
    const packed = packCatalogue(tree);
    const nodeCount = tree.entries.reduce((n, e) => n + 1 + e.children.length, 0);
    expect(packed.entryPool.length).toBeLessThan(nodeCount); // dedup happened
    expect(loadCatalogue(JSON.parse(JSON.stringify(packed)))).toEqual(tree);
  });
});
