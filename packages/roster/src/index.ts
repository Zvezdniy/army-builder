import type { IrCatalogue, IrEntry, IrGroup, Roster, RosterSelection } from "@muster/domain";

/** Create an empty roster bound to a catalogue. */
export function createRoster(catalogue: IrCatalogue, pointsLimit: number, name = "New Roster"): Roster {
  return {
    id: crypto.randomUUID(),
    name,
    gameSystemId: catalogue.gameSystemId,
    catalogueId: catalogue.id,
    catalogueRevision: catalogue.revision,
    pointsLimit,
    selections: [],
  };
}

/** Units addable at the roster root (the catalogue's top-level entries). */
export function availableUnits(catalogue: IrCatalogue): IrEntry[] {
  return catalogue.entries;
}

/** Append a root unit selection. */
export function addUnit(roster: Roster, entryId: string): Roster {
  return { ...roster, selections: [...roster.selections, freshSelection(entryId)] };
}

/** Nest an option (child selection) under the selection with `parentSelectionId`. */
export function addOption(roster: Roster, parentSelectionId: string, entryId: string): Roster {
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, freshSelection(entryId)],
    })),
  };
}

/** Set a selection's model count. */
export function setCount(roster: Roster, selectionId: string, count: number): Roster {
  return { ...roster, selections: mapTree(roster.selections, selectionId, (s) => ({ ...s, count })) };
}

/** Remove a selection and its subtree. */
export function remove(roster: Roster, selectionId: string): Roster {
  return { ...roster, selections: removeTree(roster.selections, selectionId) };
}

/** What can be added under a selection: the entry's child options and its choose-N groups. */
export function optionsFor(
  roster: Roster,
  selectionId: string,
  catalogue: IrCatalogue,
): { options: IrEntry[]; groups: IrGroup[] } {
  const sel = findTree(roster.selections, selectionId);
  if (!sel) return { options: [], groups: [] };
  const entry = findEntry(catalogue, sel.entryId);
  if (!entry) return { options: [], groups: [] };
  return { options: entry.children, groups: entry.groups ?? [] };
}

function freshSelection(entryId: string): RosterSelection {
  return { id: crypto.randomUUID(), entryId, count: 1, selections: [] };
}

function mapTree(
  sels: RosterSelection[],
  id: string,
  fn: (s: RosterSelection) => RosterSelection,
): RosterSelection[] {
  return sels.map((s) =>
    s.id === id ? fn(s) : { ...s, selections: mapTree(s.selections, id, fn) },
  );
}

function removeTree(sels: RosterSelection[], id: string): RosterSelection[] {
  return sels
    .filter((s) => s.id !== id)
    .map((s) => ({ ...s, selections: removeTree(s.selections, id) }));
}

function findTree(sels: RosterSelection[], id: string): RosterSelection | undefined {
  for (const s of sels) {
    if (s.id === id) return s;
    const found = findTree(s.selections, id);
    if (found) return found;
  }
  return undefined;
}

function findEntry(catalogue: IrCatalogue, entryId: string): IrEntry | undefined {
  const stack: IrEntry[] = [...catalogue.entries];
  while (stack.length > 0) {
    const e = stack.pop() as IrEntry;
    if (e.id === entryId) return e;
    stack.push(...e.children);
  }
  return undefined;
}
