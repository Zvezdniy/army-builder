import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, setDetachment } from "@muster/roster";
import { SetupWizard } from "./SetupWizard";

const cat: IrCatalogue = {
  id: "c", name: "Space Marines", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.captain", name: "Captain", type: "unit", costs: [], categories: [], constraints: [], children: [],
      groups: [{ id: "g.enh", name: "Gladius Task Force Enhancements", memberEntryIds: ["e.enh1"], constraints: [] }],
    },
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [] },
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Anvil Siege Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
};

// A catalogue without a Detachment root (mini-fixture shape).
const noDetCat: IrCatalogue = {
  id: "c", name: "Mini", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{ id: "e.u", name: "Unit", type: "unit", costs: [], categories: [], constraints: [], children: [] }],
};

const noop = () => {};

describe("SetupWizard", () => {
  it("renders points, faction and detachment steps", () => {
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Points")).toBeTruthy();
    expect(screen.getByText("Faction")).toBeTruthy();
    expect(screen.getByText("Detachment")).toBeTruthy();
  });

  it("choosing a points preset calls onSetPoints", () => {
    const onSetPoints = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={onSetPoints} onSetDetachment={noop} onClose={noop} />);
    fireEvent.click(screen.getByText("1000 pts"));
    expect(onSetPoints).toHaveBeenCalledWith(1000);
  });

  it("a custom points value calls onSetPoints", () => {
    const onSetPoints = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={onSetPoints} onSetDetachment={noop} onClose={noop} />);
    fireEvent.change(screen.getByLabelText("custom points"), { target: { value: "1250" } });
    expect(onSetPoints).toHaveBeenCalledWith(1250);
  });

  it("choosing a detachment calls onSetDetachment", () => {
    const onSetDetachment = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={2} onSetPoints={noop} onSetDetachment={onSetDetachment} onClose={noop} />);
    fireEvent.click(screen.getByText("Gladius Task Force"));
    expect(onSetDetachment).toHaveBeenCalledWith("e.gladius");
  });

  it("previews the chosen detachment's enhancements", () => {
    const roster = setDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<SetupWizard catalogue={cat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Artificer Armour")).toBeTruthy();
  });

  it("Start building is disabled until a detachment is chosen, then finishes", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={onClose} />,
    );
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    rerender(<SetupWizard catalogue={cat} roster={setDetachment(createRoster(cat, 2000), "e.gladius", cat)} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={onClose} />);
    const finish2 = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish2.disabled).toBe(false);
    fireEvent.click(finish2);
    expect(onClose).toHaveBeenCalled();
  });

  it("omits the detachment step when the catalogue models no detachment", () => {
    render(<SetupWizard catalogue={noDetCat} roster={createRoster(noDetCat, 2000)} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    expect(screen.queryByText("Detachment")).toBeNull();
    // Faction is the last step here → its finish button reads "Start building" and is enabled.
    fireEvent.click(screen.getByText("Next →")); // points → faction (last)
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
  });

  const registry = [
    { id: "a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } },
    { id: "b", catalogueId: "b", name: "Beta", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "b.ir.json" } },
  ];

  it("renders a card per registry faction and marks the active one", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={registry} activeDescriptorId="a" onSelectFaction={noop}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect((screen.getByText("Alpha").closest("button") as HTMLElement).className).toMatch(/chosen/);
  });

  it("calls onSelectFaction when a non-active faction is clicked", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={registry} activeDescriptorId="a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onSelectFaction).toHaveBeenCalledWith("b");
  });

  it("does not call onSelectFaction when the active faction is clicked", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={registry} activeDescriptorId="a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectFaction).not.toHaveBeenCalled();
  });

  it("shows a faction load error when provided", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={[{ id: "a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } }]}
        activeDescriptorId="a" onSelectFaction={noop} factionError="Couldn't load Beta"
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText(/Couldn't load Beta/)).toBeTruthy();
  });

  it("falls back to a single card for the current catalogue when no registry is passed", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText("Space Marines")).toBeTruthy();
  });
});
