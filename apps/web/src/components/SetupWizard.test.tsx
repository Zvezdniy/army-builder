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
      // Real 10e group shape (min 1, max 1 → a required radio via toggleGroupMember),
      // so this regression guard exercises the actual data-driven path instead of
      // detachmentGroup's defensive fallback (see packages/roster/src/builder.ts).
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [
          { id: "c.max1", type: "max", value: 1, scope: "self" },
          { id: "c.min1", type: "min", value: 1, scope: "self" },
        ],
      }],
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

// A catalogue whose detachment cost carries a cost MODIFIER — the real Bastion Task
// Force shape (base 2 Detachment Points, `set 3`). The meter must sum the MODIFIED
// value (3), matching the engine's own legality check, not the raw declared 2 —
// otherwise 3 (Bastion, modified) + 1 (Outrider) reads as 3/3 (looks legal) instead
// of the real 4/3 (illegal).
const modifiedDpCat: IrCatalogue = {
  id: "c12", name: "Space Marines", gameSystemId: "gs", revision: 1,
  forceConstraints: [
    { id: "fc.dp", type: "max", value: 2, field: "Detachment Points", scope: "force", targetType: "force", targetId: "force", includeChildSelections: false },
  ],
  categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.bastion", "e.outrider"], constraints: [{ id: "c.min1", type: "min", value: 1, scope: "self" }] }],
      children: [
        {
          id: "e.bastion", name: "Bastion Task Force", type: "upgrade",
          costs: [{ name: "Detachment Points", value: 2, modifiers: [{ id: "m", type: "set", value: 3, conditions: [] }] }],
          categories: [], constraints: [], children: [],
        },
        {
          id: "e.outrider", name: "Outrider Detachment", type: "upgrade",
          costs: [{ name: "Detachment Points", value: 1 }], categories: [], constraints: [], children: [],
        },
      ],
    },
  ],
};

// A catalogue where the SAME named group ("Gladius Task Force Enhancements") appears
// at two different placements in the tree with DIFFERENT members — the entryLink
// scenario: a placement may declare its own children, so the same group name can
// legitimately carry a different member set at each spot it occurs.
const dupEnhCat: IrCatalogue = {
  id: "cdup", name: "Dup", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    // A placement elsewhere in the tree, carrying the group name with BOTH
    // members. It is reached only AFTER the detachment's own placement below in
    // a first-match traversal — pinning that a union, not a first-match, is
    // required to see this member set at all.
    {
      id: "e.other", name: "Other Placement", type: "upgrade", costs: [], categories: [], constraints: [], children: [],
      groups: [{ id: "g.enh.b", name: "Gladius Task Force Enhancements", memberEntryIds: ["e.enh1", "e.enh2"], constraints: [] }],
    },
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"],
        constraints: [
          { id: "c.max1", type: "max", value: 1, scope: "self" },
          { id: "c.min1", type: "min", value: 1, scope: "self" },
        ],
      }],
      children: [
        {
          id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [],
          groups: [{ id: "g.enh.a", name: "Gladius Task Force Enhancements", memberEntryIds: ["e.enh1"], constraints: [] }],
        },
      ],
    },
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [] },
    { id: "e.enh2", name: "Iron Halo", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [] },
  ],
};

// A single-placement catalogue (only one group named "Gladius Task Force
// Enhancements" anywhere in the tree) whose members are declared out of id order —
// pins that the preview renders members in first-encounter (declaration) order,
// unchanged from before the union-across-placements change.
const orderedEnhCat: IrCatalogue = {
  id: "cord", name: "Ordered", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"],
        constraints: [
          { id: "c.max1", type: "max", value: 1, scope: "self" },
          { id: "c.min1", type: "min", value: 1, scope: "self" },
        ],
      }],
      children: [
        {
          id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [],
          groups: [{ id: "g.enh", name: "Gladius Task Force Enhancements", memberEntryIds: ["e.enh2", "e.enh1"], constraints: [] }],
        },
      ],
    },
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [] },
    { id: "e.enh2", name: "Iron Halo", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [] },
  ],
};

// A catalogue exercising the detachment RULES preview (Task 3): one detachment whose
// entry carries `ruleNames` with a matching `ruleTexts` body (the real 11e Space Wolves
// shape — hard line breaks + a blank-line paragraph split), one with no `ruleNames` at
// all, and one whose `ruleNames` entry has no matching `ruleTexts` body.
const ruleCat: IrCatalogue = {
  id: "c.rules", name: "Space Wolves", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  ruleTexts: {
    "Loping Charge": "Friendly ADEPTUS ASTARTES TERMINATOR units have +1 to charge rolls.\n\n\nRestrictions: Your army can include SPACE WOLVES units, but it\ncannot include any ADEPTUS ASTARTES units drawn from any\nother Chapter.",
  },
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.saga", "e.anvil", "e.unknown"],
        constraints: [{ id: "c.min1", type: "min", value: 1, scope: "self" }],
      }],
      children: [
        {
          id: "e.saga", name: "Legends of Saga and Song", type: "upgrade", costs: [], categories: [], constraints: [], children: [],
          ruleNames: ["Loping Charge"],
        },
        { id: "e.anvil", name: "Anvil Siege Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        {
          id: "e.unknown", name: "Unknown Rule Detachment", type: "upgrade", costs: [], categories: [], constraints: [], children: [],
          ruleNames: ["Mystery Rule"],
        },
      ],
    },
  ],
};

const noop = () => {};

describe("SetupWizard", () => {
  it("renders points, faction and detachment steps", () => {
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Points")).toBeTruthy();
    expect(screen.getByText("Faction")).toBeTruthy();
    expect(screen.getByText("Detachment")).toBeTruthy();
  });

  it("choosing a points preset calls onSetPoints", () => {
    const onSetPoints = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={onSetPoints} onToggleDetachment={noop} onClose={noop} />);
    fireEvent.click(screen.getByText("1000 pts"));
    expect(onSetPoints).toHaveBeenCalledWith(1000);
  });

  it("a custom points value calls onSetPoints", () => {
    const onSetPoints = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} onSetPoints={onSetPoints} onToggleDetachment={noop} onClose={noop} />);
    fireEvent.change(screen.getByLabelText("custom points"), { target: { value: "1250" } });
    expect(onSetPoints).toHaveBeenCalledWith(1250);
  });

  it("choosing a detachment calls onToggleDetachment", () => {
    const onToggleDetachment = vi.fn();
    render(<SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="detachment" onSetPoints={noop} onToggleDetachment={onToggleDetachment} onClose={noop} />);
    fireEvent.click(screen.getByText("Gladius Task Force"));
    expect(onToggleDetachment).toHaveBeenCalledWith("e.gladius");
  });

  it("previews the chosen detachment's enhancements", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<SetupWizard catalogue={cat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Artificer Armour")).toBeTruthy();
  });

  it("the enhancement preview unions members across every placement of the same-named group", () => {
    const roster = toggleDetachment(createRoster(dupEnhCat, 2000), "e.gladius", dupEnhCat);
    render(<SetupWizard catalogue={dupEnhCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getAllByText("Artificer Armour")).toHaveLength(1);
    expect(screen.getAllByText("Iron Halo")).toHaveLength(1);
  });

  it("the enhancement preview renders members in first-encounter order (unchanged for a single placement)", () => {
    const roster = toggleDetachment(createRoster(orderedEnhCat, 2000), "e.gladius", orderedEnhCat);
    const { container } = render(<SetupWizard catalogue={orderedEnhCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    const names = Array.from(container.querySelectorAll(".enh-name")).map((el) => el.textContent);
    expect(names).toEqual(["Iron Halo", "Artificer Armour"]);
  });

  it("previews a chosen detachment's rule name AND its text, preserving line breaks", () => {
    const roster = toggleDetachment(createRoster(ruleCat, 2000), "e.saga", ruleCat);
    const { container } = render(<SetupWizard catalogue={ruleCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Loping Charge")).toBeTruthy();
    const text = container.querySelector(".det-rule-text") as HTMLElement;
    expect(text).toBeTruthy();
    expect(text.textContent).toBe(ruleCat.ruleTexts!["Loping Charge"]);
  });

  it("a detachment with no rules renders no rules block at all", () => {
    const roster = toggleDetachment(createRoster(ruleCat, 2000), "e.anvil", ruleCat);
    const { container } = render(<SetupWizard catalogue={ruleCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(container.querySelector(".det-rules")).toBeNull();
    expect(container.querySelector(".det-rule-name")).toBeNull();
  });

  it("a rule name with no matching ruleTexts entry renders the name without inventing text", () => {
    const roster = toggleDetachment(createRoster(ruleCat, 2000), "e.unknown", ruleCat);
    const { container } = render(<SetupWizard catalogue={ruleCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Mystery Rule")).toBeTruthy();
    expect(container.querySelector(".det-rule-text")).toBeNull();
  });

  it("Start building is disabled until a detachment is chosen, then finishes", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={onClose} />,
    );
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    rerender(<SetupWizard catalogue={cat} roster={toggleDetachment(createRoster(cat, 2000), "e.gladius", cat)} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={onClose} />);
    const finish2 = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish2.disabled).toBe(false);
    fireEvent.click(finish2);
    expect(onClose).toHaveBeenCalled();
  });

  it("omits the detachment step when the catalogue models no detachment", () => {
    render(<SetupWizard catalogue={noDetCat} roster={createRoster(noDetCat, 2000)} onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.queryByText("Detachment")).toBeNull();
    // Faction is the last step here → its finish button reads "Start building" and is enabled.
    fireEvent.click(screen.getByText("Next →")); // points → faction (last)
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
  });

  it("10e-shaped catalogue: unpriced detachments, no DP meter (regression guard)", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.gladius", cat);
    render(<SetupWizard catalogue={cat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.queryByTestId("dp-meter")).toBeNull();
  });

  it("11e-shaped catalogue: selecting several detachments accumulates and the meter sums them over the (corrected) cap", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);

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

  it("the meter sums the MODIFIED detachment cost, not the raw declared value (matches the engine)", () => {
    let roster = createRoster(modifiedDpCat, 2000);
    roster = toggleDetachment(roster, "e.bastion", modifiedDpCat);
    roster = toggleDetachment(roster, "e.outrider", modifiedDpCat);
    render(<SetupWizard catalogue={modifiedDpCat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);

    // Bastion's raw cost is 2, but its `set 3` modifier is always active, so the
    // true total is 3 (Bastion) + 1 (Outrider) = 4 over the (corrected) cap of 3 —
    // summing the raw values would wrongly read 2 + 1 = 3 / 3 (looks legal).
    const meter = screen.getByTestId("dp-meter");
    expect(meter.textContent).toContain("4");
    expect(meter.textContent).not.toContain("3 / 3");
    expect(meter.className).toMatch(/over/);
    expect(meter.textContent).toMatch(/over budget/i);
  });

  it("over-budget is shown but never disables Start building — legality stays the engine's job", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    const finish = screen.getByText("Start building") as HTMLButtonElement;
    expect(finish.disabled).toBe(false);
  });

  it("previews enhancements for each selected detachment, not just the first", () => {
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    roster = toggleDetachment(roster, "e.anvil", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />);
    expect(screen.getByText("Artificer Armour")).toBeTruthy();
    // Both chosen detachment names appear (as a card label and a preview section head).
    expect(screen.getAllByText("Gladius Task Force").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Anvil Siege Force").length).toBeGreaterThanOrEqual(2);
  });

  it("toggling an already-selected 11e detachment calls onToggleDetachment (deselect goes through the same toggle)", () => {
    const onToggleDetachment = vi.fn();
    let roster = createRoster(elevenECat, 2000);
    roster = toggleDetachment(roster, "e.gladius", elevenECat);
    render(<SetupWizard catalogue={elevenECat} roster={roster} initialStep="detachment" onSetPoints={noop} onToggleDetachment={onToggleDetachment} onClose={noop} />);
    const list = within(screen.getByTestId("step-detachment").querySelector(".det-list") as HTMLElement);
    fireEvent.click(list.getByText("Gladius Task Force"));
    expect(onToggleDetachment).toHaveBeenCalledWith("e.gladius");
  });

  const registry = [
    { id: "a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "a.ir.json" } },
    { id: "b", catalogueId: "b", name: "Beta", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "b.ir.json" } },
  ];

  it("hides the bundled fixture from the picker once a real faction exists", () => {
    const withBundled = [
      { id: "bundled", catalogueId: "mini", name: "Mini 40k", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } },
      ...registry,
    ];
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={withBundled} activeDescriptorId="bundled" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.queryByText("Mini 40k")).toBeNull();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("keeps the bundled fixture when it is the only faction (manifest unavailable)", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={[{ id: "bundled", catalogueId: "mini", name: "Mini 40k", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } }]}
        activeDescriptorId="bundled" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText("Mini 40k")).toBeTruthy();
  });

  it("renders a card per registry faction and marks the active one", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={registry} activeDescriptorId="a" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect((screen.getByText("Alpha").closest("button") as HTMLElement).className).toMatch(/chosen/);
  });

  it("calls onSelectFaction when a non-active faction is clicked", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={registry} activeDescriptorId="a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onSelectFaction).toHaveBeenCalledWith("b");
  });

  it("does not call onSelectFaction when the active faction is clicked", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={registry} activeDescriptorId="a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectFaction).not.toHaveBeenCalled();
  });

  it("shows a faction load error when provided", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={[{ id: "a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "bundled" as const, data: {} } }]}
        activeDescriptorId="a" onSelectFaction={noop} factionError="Couldn't load Beta"
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText(/Couldn't load Beta/)).toBeTruthy();
  });

  it("falls back to a single card for the current catalogue when no registry is passed", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.getByText("Space Marines")).toBeTruthy();
  });

  const twoEditionRegistry = [
    { id: "10e:a", catalogueId: "a", name: "Alpha", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "a.ir.json" } },
    { id: "10e:b", catalogueId: "b", name: "Beta", edition: "10e", editionName: "10th Edition", source: { kind: "manifest" as const, file: "b.ir.json" } },
    { id: "11e:a", catalogueId: "a", name: "Alpha", edition: "11e", editionName: "11th Edition", source: { kind: "manifest" as const, file: "a11.ir.json" } },
  ];

  it("the Edition step renders one card per edition with the active edition chosen", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="edition"
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    const step = screen.getByTestId("step-edition");
    const tenE = within(step).getByText("10th Edition").closest("button") as HTMLElement;
    const elevenE = within(step).getByText("11th Edition").closest("button") as HTMLElement;
    expect(tenE.className).toMatch(/chosen/);
    expect(tenE.getAttribute("aria-pressed")).toBe("true");
    expect(elevenE.className).not.toMatch(/chosen/);
    expect(elevenE.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking another edition card advances to the Faction step showing that edition's factions", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="edition"
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("11th Edition"));
    const step = screen.getByTestId("step-faction");
    // 11e has only Alpha (a distinct descriptor from 10e's Alpha); 10e's Beta must not
    // appear alongside it.
    expect(within(step).getAllByText("Alpha")).toHaveLength(1);
    expect(within(step).queryByText("Beta")).toBeNull();
    expect(onSelectFaction).not.toHaveBeenCalled();
  });

  it("selecting a faction after switching edition calls onSelectFaction with the composite id", () => {
    const onSelectFaction = vi.fn();
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="edition"
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={onSelectFaction}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    fireEvent.click(screen.getByText("11th Edition"));
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectFaction).toHaveBeenCalledWith("11e:a");
  });

  it("the old inline edition segmented control is gone from the Faction step", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={twoEditionRegistry} activeDescriptorId="10e:a" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.queryByTestId("edition-picker")).toBeNull();
  });

  it("no Edition step or tab with a single-edition registry", () => {
    render(
      <SetupWizard catalogue={cat} roster={createRoster(cat, 2000)} initialStep="faction"
        registry={registry} activeDescriptorId="a" onSelectFaction={noop}
        onSetPoints={noop} onToggleDetachment={noop} onClose={noop} />,
    );
    expect(screen.queryByTestId("step-edition")).toBeNull();
    expect(screen.queryByText("Edition")).toBeNull();
  });
});
