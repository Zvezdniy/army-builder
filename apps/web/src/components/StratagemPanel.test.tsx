import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue, StratagemFile } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
import { StratagemPanel } from "./StratagemPanel";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
    groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"], constraints: [] }],
    children: [{ id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
  }],
};
const strat = (id: string, name: string, detachment: string) =>
  ({ id, name, category: "Battle Tactic", cpCost: 1, turn: "Your turn", phase: "Shooting phase", detachment, detachmentId: "x", legend: "", description: `<b>WHEN:</b> ${name} fires.` });
const data: { core: StratagemFile; faction?: StratagemFile } = {
  core: { source: "Wahapedia", kind: "core", stratagems: [strat("c1", "GRENADE", "")] },
  faction: { source: "Wahapedia", kind: "faction", wahapediaFactionId: "SM", stratagems: [strat("s1", "ARMOUR OF CONTEMPT", "Gladius Task Force")] },
};

describe("StratagemPanel", () => {
  it("renders nothing when data is undefined", () => {
    const { container } = render(<StratagemPanel data={undefined} roster={createRoster(cat, 2000)} catalogue={cat} attribution="a" />);
    expect(container.querySelector("[data-testid='stratagem-panel']")).toBeNull();
  });

  it("shows Core stratagems when opened", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} attribution="Data from Wahapedia." />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("GRENADE")).toBeInTheDocument();
    expect(screen.getByText("Data from Wahapedia.")).toBeInTheDocument();
  });

  it("shows a selected detachment's section and stratagems", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={data} roster={roster} catalogue={cat} attribution="a" />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("Gladius Task Force")).toBeInTheDocument();
    expect(screen.getByText("ARMOUR OF CONTEMPT")).toBeInTheDocument();
    // effect text rendered via the safe renderer (bold label present); both the Core
    // and the Gladius stratagem share the "WHEN:" prefix, so several instances render:
    const whens = screen.getAllByText("WHEN:");
    expect(whens.length).toBeGreaterThan(0);
    whens.forEach((el) => expect(el.tagName).toBe("STRONG"));
  });

  it("shows the empty hint for a detachment with no matching stratagems", () => {
    const bareData = { core: data.core, faction: { source: "Wahapedia", kind: "faction" as const, stratagems: [] } };
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={bareData} roster={roster} catalogue={cat} attribution="a" />);
    fireEvent.click(screen.getByText("Stratagems"));
    expect(screen.getByText("No detachment-specific stratagems found.")).toBeInTheDocument();
  });

  it("is collapsed by default (body hidden until toggled)", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} attribution="a" />);
    expect(screen.queryByText("GRENADE")).toBeNull();
  });
});
