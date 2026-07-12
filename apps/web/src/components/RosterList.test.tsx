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
      onSelect={() => {}} onOpenPicker={() => {}} />);
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open Captain/i })).toHaveTextContent("1 model");
  });
  it("selects a unit on click", async () => {
    const onSelect = vi.fn();
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={onSelect} onOpenPicker={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /open Captain/i }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });
  it("opens the picker from the add-unit button", async () => {
    const onOpenPicker = vi.fn();
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onOpenPicker={onOpenPicker} />);
    await userEvent.click(screen.getByRole("button", { name: /Add unit/i }));
    expect(onOpenPicker).toHaveBeenCalled();
  });
  it("marks a unit whose subtree contains a hidden selection", () => {
    const rosterNested = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "u1", entryId: "e.cap", count: 1, selections: [{ id: "opt1", entryId: "e.opt", count: 1, selections: [] }] }],
    } as unknown as Roster;
    render(<RosterList roster={rosterNested} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onOpenPicker={() => {}} hiddenIds={new Set(["opt1"])} />);
    expect(screen.getByTitle(/not available in the current army/i)).toBeInTheDocument();
  });
  it("shows no marker when nothing in the unit is hidden", () => {
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onOpenPicker={() => {}} hiddenIds={new Set()} />);
    expect(screen.queryByTitle(/not available in the current army/i)).toBeNull();
  });
});
