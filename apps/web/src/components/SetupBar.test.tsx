import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { IrCatalogue } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
import { SetupBar } from "./SetupBar";

const detCat: IrCatalogue = {
  id: "c", name: "Space Marines", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      // Real 10e group shape (min 1, max 1) — exercises the actual data-driven path
      // instead of detachmentGroup's defensive fallback (see builder.ts).
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"],
        constraints: [
          { id: "c.max1", type: "max", value: 1, scope: "self" },
          { id: "c.min1", type: "min", value: 1, scope: "self" },
        ],
      }],
      children: [{ id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
    },
  ],
};
// 11e-shaped: no `max` on the root's "Detachment" group, so several accumulate.
const multiDetCat: IrCatalogue = {
  id: "c11", name: "Space Marines", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"], constraints: [{ id: "c.min1", type: "min", value: 1, scope: "self" }] }],
      children: [
        { id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Anvil Siege Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
};
const noDetCat: IrCatalogue = {
  id: "c", name: "Mini", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{ id: "e.u", name: "Unit", type: "unit", costs: [], categories: [], constraints: [], children: [] }],
};

describe("SetupBar", () => {
  it("shows points, faction and the chosen detachment; a chip reopens the wizard at its step", () => {
    const onEdit = vi.fn();
    const roster = toggleDetachment(createRoster(detCat, 1500), "e.gladius", detCat);
    render(<SetupBar catalogue={detCat} roster={roster} onEdit={onEdit} />);
    expect(screen.getByText("1500 pts")).toBeTruthy();
    expect(screen.getByText("Space Marines")).toBeTruthy();
    expect(screen.getByText("Gladius Task Force")).toBeTruthy();
    fireEvent.click(screen.getByText("Gladius Task Force"));
    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it("shows a 'Choose…' detachment chip before one is picked", () => {
    render(<SetupBar catalogue={detCat} roster={createRoster(detCat, 2000)} onEdit={() => {}} />);
    expect(screen.getByText("Choose…")).toBeTruthy();
  });

  it("joins several chosen detachments in the chip instead of showing only the first", () => {
    let roster = createRoster(multiDetCat, 2000);
    roster = toggleDetachment(roster, "e.gladius", multiDetCat);
    roster = toggleDetachment(roster, "e.anvil", multiDetCat);
    render(<SetupBar catalogue={multiDetCat} roster={roster} onEdit={() => {}} />);
    expect(screen.getByText("Gladius Task Force, Anvil Siege Force")).toBeTruthy();
  });

  it("omits the detachment chip when the catalogue models no detachment", () => {
    render(<SetupBar catalogue={noDetCat} roster={createRoster(noDetCat, 2000)} onEdit={() => {}} />);
    expect(screen.getByText("Mini")).toBeTruthy();
    expect(screen.queryByText("Detachment")).toBeNull();
  });
});
