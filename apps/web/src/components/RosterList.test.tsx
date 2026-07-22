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
  it("shows units under their role heading with a points chip; a 1-model unit shows no model chip", () => {
    render(<RosterList roster={roster} catalogue={cat} selectedUnitId={undefined}
      onSelect={() => {}} onOpenPicker={() => {}} />);
    expect(screen.getByText("HQ")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /open Captain/i });
    expect(card).toHaveTextContent("0 pts"); // Captain has no cost in this fixture
    expect(card).not.toHaveTextContent(/model/); // single-model unit: model chip suppressed
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
  it("renders an attached leader under its bodyguard, not in its own bucket", () => {
    const cat2 = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1,
      categoryNames: { "cat.hq": "HQ", "cat.tr": "Battleline" },
      entries: [
        { id: "e.lead", name: "Canoness", costs: [], categories: ["cat.hq"], constraints: [], children: [], groups: [],
          profiles: [{ name: "Canoness", typeName: "Unit", characteristics: [] }] },
        { id: "e.bss", name: "Battle Sisters Squad", costs: [], categories: ["cat.tr"], constraints: [], children: [], groups: [],
          profiles: [{ name: "Battle Sisters Squad", typeName: "Unit", characteristics: [] }] },
      ],
    } as unknown as IrCatalogue;
    const r2 = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "L", entryId: "e.lead", count: 1, selections: [], attachedTo: "B" },
        { id: "B", entryId: "e.bss", count: 1, selections: [] },
      ],
    } as unknown as Roster;
    render(<RosterList roster={r2} catalogue={cat2} selectedUnitId={undefined}
      onSelect={() => {}} onOpenPicker={() => {}} />);
    // The leader is not listed under its own "HQ" role bucket…
    expect(screen.queryByRole("heading", { name: "HQ" })).toBeNull();
    // …but appears as a "leading" child of the bodyguard.
    expect(screen.getByRole("button", { name: /open Canoness/i })).toHaveTextContent(/leading/i);
  });
});
