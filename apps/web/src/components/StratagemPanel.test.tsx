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

const openPanel = () => fireEvent.click(screen.getByText("Stratagems"));

describe("StratagemPanel", () => {
  it("renders nothing when data is undefined", () => {
    const { container } = render(<StratagemPanel data={undefined} roster={createRoster(cat, 2000)} catalogue={cat} />);
    expect(container.querySelector("[data-testid='stratagem-panel']")).toBeNull();
  });

  it("shows section heads but keeps the groups collapsed when the panel opens", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} />);
    openPanel();
    expect(screen.getByText("Core")).toBeInTheDocument();  // section head visible
    expect(screen.queryByText("GRENADE")).toBeNull();      // its cards hidden until the section is clicked
  });

  it("reveals a group's stratagem names when its section is clicked, descriptions still hidden", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} />);
    openPanel();
    fireEvent.click(screen.getByText("Core"));
    expect(screen.getByText("GRENADE")).toBeInTheDocument(); // name now shown
    expect(screen.queryByText("WHEN:")).toBeNull();          // effect text still collapsed
  });

  it("reveals a stratagem's effect text when its card is clicked", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} />);
    openPanel();
    fireEvent.click(screen.getByText("Core"));
    fireEvent.click(screen.getByText("GRENADE"));
    const when = screen.getByText("WHEN:");
    expect(when.tagName).toBe("STRONG"); // rendered via the safe HTML renderer
  });

  it("shows a Core head and a selected-detachment head, each opening independently", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={data} roster={roster} catalogue={cat} />);
    openPanel();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Gladius Task Force")).toBeInTheDocument();
    expect(screen.queryByText("ARMOUR OF CONTEMPT")).toBeNull(); // hidden until its section opens
    fireEvent.click(screen.getByText("Gladius Task Force"));
    expect(screen.getByText("ARMOUR OF CONTEMPT")).toBeInTheDocument();
  });

  it("shows the empty hint for a detachment with no matching stratagems (once its section opens)", () => {
    const bareData = { core: data.core, faction: { source: "Wahapedia", kind: "faction" as const, stratagems: [] } };
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<StratagemPanel data={bareData} roster={roster} catalogue={cat} />);
    openPanel();
    fireEvent.click(screen.getByText("Gladius Task Force"));
    expect(screen.getByText("No detachment-specific stratagems found.")).toBeInTheDocument();
  });

  it("is collapsed by default — nothing shown until the panel is opened", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} />);
    expect(screen.queryByText("Core")).toBeNull();
    expect(screen.queryByText("GRENADE")).toBeNull();
  });

  it("no longer renders a Wahapedia attribution line", () => {
    render(<StratagemPanel data={data} roster={createRoster(cat, 2000)} catalogue={cat} />);
    openPanel();
    fireEvent.click(screen.getByText("Core"));
    expect(screen.queryByText(/Wahapedia/)).toBeNull();
  });
});
