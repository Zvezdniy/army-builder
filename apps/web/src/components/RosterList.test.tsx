import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IrCatalogue, Roster } from "@muster/domain";
import { RosterList } from "./RosterList";

const cat = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  categoryNames: { "cat.hq": "HQ" },
  entries: [{ id: "e.cap", name: "Captain", costs: [], categories: ["cat.hq"], constraints: [], children: [], groups: [],
    profiles: [{ name: "Captain", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] }] }],
} as unknown as IrCatalogue;
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "s1", entryId: "e.cap", count: 1, selections: [] }],
} as unknown as Roster;

describe("RosterList", () => {
  it("shows units under their role heading and reports model count", () => {
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onAddUnit={() => {}} />);
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open Captain/i })).toHaveTextContent("1 models");
  });
  it("selects a unit on click", async () => {
    const onSelect = vi.fn();
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={onSelect} onAddUnit={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /open Captain/i }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });
});
