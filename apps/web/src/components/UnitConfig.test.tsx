import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnitConfig } from "./UnitConfig";
import type { IrCatalogue, Roster } from "@muster/domain";

// Owner unit e.u (category cat.u) has a free option e.opt whose visibility
// modifier hides it unless its parent (the owner) is instanceOf cat.absent.
// The owner is never cat.absent, so lessThan 1 is true -> the option is hidden.
const catalogueWithGate = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.u", name: "Unit", costs: [], categories: ["cat.u"], constraints: [],
      children: [
        {
          id: "e.opt", name: "Opt", costs: [], categories: [], constraints: [], children: [],
          visibilityModifiers: [{
            set: true,
            conditions: [{
              id: "c", comparator: "lessThan", value: 1, field: "selections",
              scope: "parent", targetType: "category", targetId: "cat.absent",
            }],
          }],
        },
      ],
    },
  ],
} as unknown as IrCatalogue;

// Control catalogue: same shape, no visibility modifier on the option.
const catalogueWithoutGate = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.u", name: "Unit", costs: [], categories: ["cat.u"], constraints: [],
      children: [
        { id: "e.opt", name: "Opt", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
} as unknown as IrCatalogue;

const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.u", count: 1, selections: [] }],
} as unknown as Roster;

const noop = () => {};

describe("UnitConfig hidden filtering (owner-scoped, via data)", () => {
  it("hides a free option whose gate is true in the owner's context", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithGate}
      onAddOption={noop} onToggleGroupMember={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Opt")).toBeNull();
  });

  it("keeps a free option visible when it carries no hiding gate", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithoutGate}
      onAddOption={noop} onToggleGroupMember={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Opt")).not.toBeNull();
  });
});
