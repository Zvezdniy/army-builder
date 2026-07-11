import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnitConfig } from "./UnitConfig";
import type { IrCatalogue, Roster } from "@muster/domain";

const catalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.unit", name: "Unit", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.free", name: "Free Option", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.opt1", name: "Option One", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.opt2", name: "Option Two", costs: [], categories: [], constraints: [], children: [] },
      ],
      groups: [
        { id: "g.wpn", name: "Weapon", memberEntryIds: ["e.opt1", "e.opt2"], constraints: [{ id: "gc", type: "max", value: 1 }] },
      ],
    },
  ],
} as unknown as IrCatalogue;

const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.unit", count: 1, selections: [] }],
} as unknown as Roster;

const noop = () => {};

describe("UnitConfig hidden filtering", () => {
  it("omits a free option whose id is in hiddenIds", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogue}
      hiddenIds={new Set(["e.free"])}
      onAddOption={noop} onToggleGroupMember={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Free Option")).toBeNull();
  });

  it("keeps a free option visible when not hidden", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogue}
      hiddenIds={new Set()}
      onAddOption={noop} onToggleGroupMember={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Free Option")).not.toBeNull();
  });

  it("omits a group member whose id is in hiddenIds", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogue}
      hiddenIds={new Set(["e.opt1"])}
      onAddOption={noop} onToggleGroupMember={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("select Option One")).toBeNull();
    expect(screen.queryByLabelText("select Option Two")).not.toBeNull();
  });
});
