import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
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

// An 11e-shaped fixture: detachments priced in "Detachment Points", the root
// "Detachment" group has only `min 1` (no max → toggleDetachment accumulates), and the
// force constraint's value (2) is deliberately below Gladius's own cost (3) — the
// documented upstream inconsistency the floor-3 correction exists for.
const elevenECat: IrCatalogue = {
  id: "c11", name: "Space Marines", gameSystemId: "gs", revision: 1,
  forceConstraints: [
    { id: "fc.dp", type: "max", value: 2, field: "Detachment Points", scope: "force", targetType: "force", targetId: "force", includeChildSelections: false },
  ],
  categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"], constraints: [{ id: "c.min1", type: "min", value: 1, scope: "self" }] }],
      children: [
        {
          id: "e.gladius", name: "Gladius Task Force", type: "upgrade",
          costs: [{ name: "Detachment Points", value: 3 }], categories: [], constraints: [], children: [],
          groups: [{ id: "g.enh1", name: "Gladius Task Force Enhancements", memberEntryIds: ["e.enh1"], constraints: [] }],
        },
        {
          id: "e.anvil", name: "Anvil Siege Force", type: "upgrade",
          costs: [{ name: "Detachment Points", value: 2 }], categories: [], constraints: [], children: [],
        },
      ],
    },
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [] },
  ],
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
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
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
    rerender(<SetupWizard catalogue={cat} roster={toggleDetachment(createRoster(cat, 2000), "e.gladius", cat)} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={onClose} />);
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

  it("10e-shaped catalogue: unpriced detachments, no DP meter (regression guard)", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<SetupWizard catalogue={cat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    expect(screen.queryByTestId("dp-meter")).toBeNull();
  });

  it("11e-shaped catalogue: selecting several detachments accumulates and the meter sums them over the (corrected) cap", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);

    const list = within(screen.getByTestId("step-detachment").querySelector(".det-list") as HTMLElement);
    const gladiusCard = list.getByText("Gladius Task Force").closest("button") as HTMLElement;
    const anvilCard = list.getByText("Anvil Siege Force").closest("button") as HTMLElement;
    expect(gladiusCard.className).toMatch(/chosen/);
    expect(anvilCard.className).toMatch(/chosen/);
    expect(gladiusCard.getAttribute("aria-pressed")).toBe("true");
    expect(anvilCard.getAttribute("aria-pressed")).toBe("true");

    // 3 + 2 = 5 DP used; the raw data cap (2) is floored to 3 by engine-eval's
    // correctedConstraintValue, so the meter must read against 3, not 2.
    const meter = screen.getByTestId("dp-meter");
    expect(meter.textContent).toContain("5");
    expect(meter.textContent).toContain("3");
    expect(meter.className).toMatch(/over/);
    expect(meter.textContent).toMatch(/over budget/i);
  });

  it("over-budget is shown but never disables Start building — legality stays the engine's job", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
  });

  it("previews enhancements for each selected detachment, not just the first", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Artificer Armour")).toBeTruthy();
    // Both chosen detachment names appear (as a card label and a preview section head).
    expect(screen.getAllByText("Gladius Task Force").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Anvil Siege Force").length).toBeGreaterThanOrEqual(2);
  });

  it("toggling an already-selected 11e detachment calls onSetDetachment (deselect goes through the same toggle)", () => {
    const onSetDetachment = vi.fn();
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep={2} onSetPoints={noop} onSetDetachment={onSetDetachment} onClose={noop} />);
    const list = within(screen.getByTestId("step-detachment").querySelector(".det-list") as HTMLElement);
    fireEvent.click(list.getByText("Gladius Task Force"));
    expect(onSetDetachment).toHaveBeenCalledWith("e.gladius");
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

  const twoEditionRegistry = [
    { id: "10e:a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } },
    { id: "10e:b", catalogueId: "b", name: "Beta", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "b.ir.json" } },
    { id: "11e:a", catalogueId: "a", name: "Alpha", edition: "11e", editionName: "11th Edition", source: { kind: "manifest" as const, file: "a11.ir.json" } },
  ];

  it("renders one segment per edition with the active descriptor's edition selected", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={noop}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    const picker = screen.getByTestId("edition-picker");
    const tenE = screen.getByText("10th Edition").closest("button") as HTMLElement;
    const elevenE = screen.getByText("11th Edition").closest("button") as HTMLElement;
    expect(picker.contains(tenE)).toBe(true);
    expect(picker.contains(elevenE)).toBe(true);
    expect(tenE.getAttribute("aria-pressed")).toBe("true");
    expect(elevenE.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows only the selected edition's factions in the grid", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={noop}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    // 10e has Alpha + Beta; 11e's Alpha is a distinct descriptor and must not appear
    // alongside them even though it shares the display name.
    expect(screen.getAllByText("Alpha")).toHaveLength(1);
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("clicking another edition segment switches the grid without selecting a faction", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("11th Edition"));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
    expect(onSelectFaction).not.toHaveBeenCalled();
  });

  it("clicking a faction after switching edition calls onSelectFaction with the composite id", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("11th Edition"));
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectFaction).toHaveBeenCalledWith("11e:a");
  });

  it("hides the edition picker with a single-edition registry", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep={1}
        registry={registry} activeDescriptorId="a" onSelectFaction={noop}
        onSetPoints={noop} onSetDetachment={noop} onClose={noop} />,
    );
    expect(screen.queryByTestId("edition-picker")).toBeNull();
  });
});
