import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddUnitPicker } from "./AddUnitPicker";
import type { IrCatalogue } from "@muster/domain";

const catalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    { id: "e.shown", name: "Shown Unit", costs: [], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.hidden", name: "Hidden Unit", costs: [], categories: ["cat.hq"], constraints: [], children: [] },
  ],
} as unknown as IrCatalogue;

describe("AddUnitPicker hidden filtering", () => {
  it("omits units whose id is in hiddenIds", () => {
    render(<AddUnitPicker catalogue={catalogue} hiddenIds={new Set(["e.hidden"])} onAdd={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Shown Unit")).not.toBeNull();
    expect(screen.queryByText("Hidden Unit")).toBeNull();
  });

  it("shows all units when hiddenIds is empty", () => {
    render(<AddUnitPicker catalogue={catalogue} hiddenIds={new Set()} onAdd={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Shown Unit")).not.toBeNull();
    expect(screen.queryByText("Hidden Unit")).not.toBeNull();
  });
});
