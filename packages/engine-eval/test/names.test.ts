import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { targetNamer } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c",
  name: "C",
  gameSystemId: "g",
  revision: 1,
  forceConstraints: [],
  categoryNames: { "cat.heavy": "Heavy Support" },
  entries: [
    { id: "e.sgt", name: "Sergeant", costs: [], categories: [], constraints: [], children: [] },
  ],
};

describe("targetNamer", () => {
  const nameOf = targetNamer(cat);

  it("resolves a category id via categoryNames", () => {
    expect(nameOf("category", "cat.heavy")).toBe("Heavy Support");
  });

  it("resolves an entry id via the entry index", () => {
    expect(nameOf("entry", "e.sgt")).toBe("Sergeant");
  });

  it("falls back to the raw id for an unknown category", () => {
    expect(nameOf("category", "cat.unknown")).toBe("cat.unknown");
  });

  it("falls back to the raw id for an unknown entry", () => {
    expect(nameOf("entry", "e.unknown")).toBe("e.unknown");
  });
});
