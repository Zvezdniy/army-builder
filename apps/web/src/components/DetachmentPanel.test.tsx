import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment, addUnit } from "@muster/roster";
import { DetachmentPanel } from "./DetachmentPanel";

function selGate(detId: string) {
  return { set: true, conditionGroups: [{ type: "and" as const, conditions: [{
    id: `c.${detId}`, comparator: "lessThan" as const, value: 1, field: "selections" as const,
    scope: "roster", targetType: "entry" as const, targetId: detId, includeChildSelections: true,
  }] }] };
}
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  ruleTexts: { "Loping Charge": "Advance and charge." },
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.saga"], constraints: [] }],
      children: [{ id: "e.saga", name: "Legends of Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [], ruleNames: ["Loping Charge"] }],
    },
    {
      id: "e.canoness", name: "Canoness", type: "model", costs: [{ name: "pts", value: 50 }], categories: [], constraints: [],
      groups: [{ id: "g.enh", name: "Enhancements", memberEntryIds: ["e.enh"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
      children: [{ id: "e.enh", name: "Thirst for Glory", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.saga")] }],
    },
  ],
};
const noop = () => {};
function withDet() { return toggleDetachment(createRoster(cat, 2000), "e.saga", cat); }

describe("DetachmentPanel", () => {
  it("renders nothing when no detachment is chosen", () => {
    const { container } = render(<DetachmentPanel catalogue={cat} roster={createRoster(cat, 2000)} onSelectUnit={noop} onToggleGroupMember={noop} />);
    expect(container.firstChild).toBeNull();
  });
  it("collapsed by default; expands to rule + enhancement", () => {
    render(<DetachmentPanel catalogue={cat} roster={withDet()} onSelectUnit={noop} onToggleGroupMember={noop} />);
    expect(screen.queryByText("Advance and charge.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText("Advance and charge.")).toBeTruthy();
    expect(screen.getByText("Thirst for Glory")).toBeTruthy();
  });
  it("shows a hint when no Character is in the roster", () => {
    render(<DetachmentPanel catalogue={cat} roster={withDet()} onSelectUnit={noop} onToggleGroupMember={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText(/add a character/i)).toBeTruthy();
  });
  it("assigns to the single eligible Character on click", () => {
    const onToggle = vi.fn(); const onSelect = vi.fn();
    const roster = addUnit(withDet(), "e.canoness", cat);
    const unitSel = roster.selections.find((s) => s.entryId === "e.canoness")!;
    render(<DetachmentPanel catalogue={cat} roster={roster} onSelectUnit={onSelect} onToggleGroupMember={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    fireEvent.click(screen.getByRole("button", { name: "Thirst for Glory" }));
    expect(onToggle).toHaveBeenCalledWith(unitSel.id, expect.objectContaining({ id: "g.enh" }), "e.enh");
    expect(onSelect).toHaveBeenCalledWith(unitSel.id);
  });
  it("shows `on <unit>` and removes when already assigned", () => {
    const onToggle = vi.fn();
    let roster = addUnit(withDet(), "e.canoness", cat);
    const unitSel = roster.selections.find((s) => s.entryId === "e.canoness")!;
    // Pre-assign the enhancement by nesting it under the Canoness.
    roster = { ...roster, selections: roster.selections.map((s) => s.id !== unitSel.id ? s
      : { ...s, selections: [...s.selections, { id: "sel.enh", entryId: "e.enh", count: 1, selections: [] }] }) };
    render(<DetachmentPanel catalogue={cat} roster={roster} onSelectUnit={noop} onToggleGroupMember={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    expect(screen.getByText(/on Canoness/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /on Canoness/i }));
    expect(onToggle).toHaveBeenCalledWith(unitSel.id, expect.objectContaining({ id: "g.enh" }), "e.enh");
  });
});
