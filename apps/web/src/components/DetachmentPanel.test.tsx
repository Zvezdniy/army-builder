import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
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
      children: [
        { id: "e.saga", name: "Legends of Saga", type: "upgrade", costs: [], categories: [], constraints: [], children: [], ruleNames: ["Loping Charge"] },
      ],
    },
    { id: "e.hero", name: "Hero", type: "model", costs: [], categories: [], constraints: [], children: [
      { id: "e.enh", name: "Thirst for Glory", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.saga")] },
    ] },
  ],
};

describe("DetachmentPanel", () => {
  it("renders nothing when no detachment is chosen", () => {
    const { container } = render(<DetachmentPanel catalogue={cat} roster={createRoster(cat, 2000)} />);
    expect(container.firstChild).toBeNull();
  });
  it("is collapsed by default and reveals rule + enhancement on expand", () => {
    const roster = toggleDetachment(createRoster(cat, 2000), "e.saga", cat);
    render(<DetachmentPanel catalogue={cat} roster={roster} />);
    // Collapsed: content hidden.
    expect(screen.queryByText("Advance and charge.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /detachment/i }));
    // Expanded: rule text + enhancement name + points shown.
    expect(screen.getByText("Advance and charge.")).toBeTruthy();
    expect(screen.getByText("Thirst for Glory")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
  });
});
