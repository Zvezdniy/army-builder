import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MyArmies } from "./MyArmies";
import { emptyLibrary, upsertActive } from "@muster/roster";

const roster = { id: "r1", name: "Alpha", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000, selections: [] };
const lib = upsertActive(emptyLibrary(), roster, { edition: "10e", catalogueId: "cat", catalogueName: "Space Marines" }, 100);
const noop = () => {};
const props = { library: lib, onOpen: noop, onRename: noop, onDuplicate: noop, onDelete: noop, onExport: noop, onImport: noop, onNew: noop, onClose: noop };

describe("MyArmies", () => {
  it("lists saved armies with faction and points", () => {
    render(<MyArmies {...props} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/Space Marines/)).toBeTruthy();
    expect(screen.getByText(/2000/)).toBeTruthy();
  });
  it("Open fires onOpen with the entry id", () => {
    const onOpen = vi.fn();
    render(<MyArmies {...props} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /open Alpha/i }));
    expect(onOpen).toHaveBeenCalledWith("r1");
  });
  it("shows an empty state when there are no armies", () => {
    render(<MyArmies {...props} library={emptyLibrary()} />);
    expect(screen.getByText(/no saved armies/i)).toBeTruthy();
  });
});
