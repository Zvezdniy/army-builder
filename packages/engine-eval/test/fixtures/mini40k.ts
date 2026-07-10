import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";

// A 40k-shaped mini catalogue: force requires 1-2 HQ and max 3 Heavy Support.
export const mini40kCatalogue: IrCatalogue = {
  id: "cat.mini40k",
  name: "Mini 40k",
  gameSystemId: "gs.40k",
  revision: 1,
  forceConstraints: [
    { id: "fc.hq.min", type: "min", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.hq.max", type: "max", value: 2, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.heavy.max", type: "max", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy", includeChildSelections: false },
  ],
  entries: [
    { id: "e.captain", name: "Captain", costs: [{ name: "points", value: 80 }], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.troops", name: "Battle Line", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], constraints: [], children: [] },
    { id: "e.heavy", name: "Heavy Support", costs: [{ name: "points", value: 150 }], categories: ["cat.heavy"], constraints: [], children: [] },
  ],
};

let seq = 0;
const sel = (entryId: string, count = 1): RosterSelection => ({
  id: `s${seq++}`,
  entryId,
  count,
  selections: [],
});

export function rosterWith(selections: RosterSelection[], pointsLimit = 1000): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs.40k",
    catalogueId: "cat.mini40k", catalogueRevision: 1,
    pointsLimit, selections,
  };
}

// 80 + 100 + 100 + 150 = 430, 1 HQ, 1 Heavy — legal at 1000.
export const legalRoster: Roster = rosterWith([
  sel("e.captain"),
  sel("e.troops"),
  sel("e.troops"),
  sel("e.heavy"),
]);

export { sel };
