import { describe, it, expect } from "vitest";
import { loadCatalogue, packCatalogue, IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import mini40k from "./mini40k.ir.json";

// The web load path must accept a packed-v1 payload and yield the same runtime
// catalogue as loading the tree fixture directly.
describe("web packed load path", () => {
  it("loadCatalogue(pack(tree)) equals loadCatalogue(tree)", () => {
    const tree = IrCatalogueSchema.parse(mini40k);
    const packed = JSON.parse(JSON.stringify(packCatalogue(tree)));
    expect(loadCatalogue(packed)).toEqual(loadCatalogue(mini40k));
  });
});
