import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster } from "@muster/domain";
import { UnitDetail } from "./UnitDetail";

const catalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, categoryNames: {},
  entries: [
    { id: "e.lead", name: "Canoness", costs: [], categories: [], constraints: [], children: [], groups: [],
      profiles: [{ name: "Leader", typeName: "Abilities", characteristics: [{ name: "Description", value: "attached to the following units:\n■ Battle Sisters Squad" }] }] },
    { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [] },
  ],
} as unknown as IrCatalogue;

const base = (attachedTo?: string): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "L", entryId: "e.lead", count: 1, selections: [], ...(attachedTo ? { attachedTo } : {}) },
    { id: "B", entryId: "e.bss", count: 1, selections: [] },
  ],
} as unknown as Roster);

const noop = () => {};
function renderDetail(roster: Roster, over: Partial<Record<string, unknown>> = {}) {
  return render(
    <UnitDetail roster={roster} catalogue={catalogue} selectedUnitId="L"
      onBack={noop} onAddOption={noop} onToggleGroupMember={noop}
      onSetGroupMemberCount={noop} onRemove={noop} onSetCount={noop}
      onAttachLeader={noop} onDetachLeader={noop} {...over} />,
  );
}

describe("UnitDetail attach section", () => {
  it("offers an eligible target and fires onAttachLeader", async () => {
    const onAttachLeader = vi.fn();
    renderDetail(base(), { onAttachLeader });
    await userEvent.click(screen.getByRole("button", { name: /attach to Battle Sisters Squad/i }));
    expect(onAttachLeader).toHaveBeenCalledWith("L", "B");
  });
  it("shows the current bodyguard and fires onDetachLeader when attached", async () => {
    const onDetachLeader = vi.fn();
    renderDetail(base("B"), { onDetachLeader });
    expect(screen.getByText(/Leading Battle Sisters Squad/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /detach/i }));
    expect(onDetachLeader).toHaveBeenCalledWith("L");
  });
});
