import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

// Same shape as catalogueWithoutGate, but the owner entry carries a `type`
// so we can assert the display-only type badge in UnitConfig's self-row.
const catalogueWithType = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.u", name: "Unit", type: "unit", costs: [], categories: ["cat.u"], constraints: [],
      children: [
        { id: "e.opt", name: "Opt", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
} as unknown as IrCatalogue;

describe("UnitConfig entry type badge", () => {
  it("shows the entry's type in the self-row when the entry has a type", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithType}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.getByText("unit")).toBeInTheDocument();
  });

  it("shows no type badge when the entry has no type", () => {
    const { container } = render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithoutGate}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(container.querySelector(".uc-type")).toBeNull();
  });
});

describe("UnitConfig hidden filtering (owner-scoped, via data)", () => {
  it("hides a free option whose gate is true in the owner's context", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithGate}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Opt")).toBeNull();
  });

  it("keeps a free option visible when it carries no hiding gate", () => {
    render(<UnitConfig roster={roster} selection={roster.selections[0]!} catalogue={catalogueWithoutGate}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.queryByLabelText("add option Opt")).not.toBeNull();
  });
});

// A counted-distribution group: members carry per-member max (parent scope), the
// group spans [min,max]. Rendered as one stepper per member, not toggles.
const memberMax = (id: string, value: number) => ({
  id: `${id}.max`, type: "max", value, field: "selections",
  scope: "parent", targetType: "entry", targetId: id, includeChildSelections: false,
});
const countedCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.u", name: "Squad", costs: [], categories: [], constraints: [],
    children: [
      { id: "bolter", name: "w/ bolter", costs: [], categories: [], constraints: [memberMax("bolter", 9)], children: [] },
      { id: "shield", name: "w/ shield", costs: [], categories: [], constraints: [memberMax("shield", 2)], children: [] },
    ],
    groups: [{
      id: "g4", name: "4-9 Bodies", memberEntryIds: ["bolter", "shield"], defaultMemberEntryId: "bolter",
      constraints: [{ id: "g4.min", type: "min", value: 4, scope: "self" }, { id: "g4.max", type: "max", value: 9, scope: "self" }],
    }],
  }],
} as unknown as IrCatalogue;

// Roster with 5 bolters chosen (group total 5, budget 4 left before max 9).
const countedRoster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.u", count: 1, selections: [
    { id: "s2", entryId: "bolter", count: 5, selections: [] },
  ] }],
} as unknown as Roster;

describe("UnitConfig counted group", () => {
  it("renders a stepper per member with the group range and running total", () => {
    render(<UnitConfig roster={countedRoster} selection={countedRoster.selections[0]!} catalogue={countedCatalogue}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    // no on/off toggle pills for the members — steppers instead
    expect(screen.queryByLabelText("select w/ bolter")).toBeNull();
    expect(screen.getByLabelText("increase w/ bolter")).toBeInTheDocument();
    expect(screen.getByText(/4–9 · 5 chosen/)).toBeInTheDocument();
  });

  it("increments a member through onSetGroupMemberCount", () => {
    const onSet = vi.fn();
    render(<UnitConfig roster={countedRoster} selection={countedRoster.selections[0]!} catalogue={countedCatalogue}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={onSet} onRemove={noop} onSetCount={noop} />);
    fireEvent.click(screen.getByLabelText("increase w/ bolter"));
    expect(onSet).toHaveBeenCalledWith("s1", expect.objectContaining({ id: "g4" }), "bolter", 6);
  });

  it("disables a member's + at its own max even with group budget left", () => {
    // shield max 2; at 2 it can't grow though the group has room (total 7 < 9).
    const atShieldMax = {
      ...countedRoster,
      selections: [{ id: "s1", entryId: "e.u", count: 1, selections: [
        { id: "s2", entryId: "bolter", count: 5, selections: [] },
        { id: "s3", entryId: "shield", count: 2, selections: [] },
      ] }],
    } as unknown as Roster;
    render(<UnitConfig roster={atShieldMax} selection={atShieldMax.selections[0]!} catalogue={countedCatalogue}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.getByLabelText("increase w/ shield")).toBeDisabled();
    expect(screen.getByLabelText("decrease w/ shield")).not.toBeDisabled();
  });

  it("disables every + when the group is full at its max", () => {
    const full = {
      ...countedRoster,
      selections: [{ id: "s1", entryId: "e.u", count: 1, selections: [
        { id: "s2", entryId: "bolter", count: 9, selections: [] },
      ] }],
    } as unknown as Roster;
    render(<UnitConfig roster={full} selection={full.selections[0]!} catalogue={countedCatalogue}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.getByLabelText("increase w/ bolter")).toBeDisabled();
    expect(screen.getByLabelText("increase w/ shield")).toBeDisabled();
  });

  it("disables − for a member at zero", () => {
    render(<UnitConfig roster={countedRoster} selection={countedRoster.selections[0]!} catalogue={countedCatalogue}
      onAddOption={noop} onToggleGroupMember={noop} onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop} />);
    expect(screen.getByLabelText("decrease w/ shield")).toBeDisabled(); // shield at 0
  });
});
