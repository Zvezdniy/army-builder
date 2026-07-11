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

/** Append a root unit selection, prepopulated with its default/required loadout. */
export function addUnit(roster: Roster, entryId: string, catalogue?: IrCatalogue): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return { ...roster, selections: [...roster.selections, selection] };
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

/** Find an entry anywhere in the catalogue tree by id (roots and nested children). */
export function catalogueEntry(catalogue: IrCatalogue, entryId: string): IrEntry | undefined {
  return findEntry(catalogue, entryId);
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

/** How a choose-N group should be edited, derived from its selection constraints. */
export type GroupControl =
  | { kind: "single"; required: boolean } // max 1 — a radio (required when min >= 1)
  | { kind: "multi"; max: number };       // max > 1 — up to `max` toggles (Infinity if unbounded)

/** How a single option should be edited, derived from its own selection constraints. */
export type OptionControl =
  | { kind: "toggle" }                        // max 1 — on/off
  | { kind: "stepper"; min: number; max: number } // max > 1 — a bounded count (max may be Infinity)
  | { kind: "fixed"; count: number };         // min === max — always present, not editable

/** Read a selections-count bound from a group's constraints (missing → fallback). */
function groupBound(group: IrGroup, type: "min" | "max", fallback: number): number {
  return group.constraints.find((c) => c.type === type)?.value ?? fallback;
}

/** Read an entry's OWN selections-count bound (scope self/parent), missing → fallback. */
function ownBound(entry: IrEntry, type: "min" | "max", fallback: number): number {
  const c = entry.constraints.find(
    (x) => x.field === "selections" && (x.scope === "self" || x.scope === "parent") && x.type === type,
  );
  return c?.value ?? fallback;
}

/** Classify how a group is edited: single-choice radio (max 1) vs up-to-N (max > 1). */
export function groupControl(group: IrGroup): GroupControl {
  const max = groupBound(group, "max", Infinity);
  const min = groupBound(group, "min", 0);
  if (max === 1) return { kind: "single", required: min >= 1 };
  return { kind: "multi", max };
}

/**
 * Classify how an option is edited from its own count bounds:
 * - fixed when min === max (a fixed multiplicity),
 * - stepper when there is an explicit multiplicity signal (max > 1, or min > 1),
 * - toggle otherwise (on/off — the common no-constraint / max-1 case).
 */
export function optionControl(entry: IrEntry): OptionControl {
  const max = ownBound(entry, "max", Infinity);
  const min = ownBound(entry, "min", 0);
  if (max !== Infinity && min === max) return { kind: "fixed", count: max };
  if ((max !== Infinity && max > 1) || min > 1) return { kind: "stepper", min, max };
  return { kind: "toggle" };
}

/** Member entry ids of `group` currently selected directly under `selectionId`. */
export function selectedGroupMembers(
  roster: Roster,
  selectionId: string,
  group: IrGroup,
): string[] {
  const sel = findTree(roster.selections, selectionId);
  if (!sel) return [];
  return sel.selections
    .filter((c) => group.memberEntryIds.includes(c.entryId))
    .map((c) => c.entryId);
}

/**
 * Toggle a group member under a unit while respecting the group's `max`.
 * - already selected → deselect it (remove).
 * - room left (below max) → add it.
 * - at a max of 1 → swap: drop the current member, add the new one.
 * - at a max above 1 (full) → no-op (the group is full; deselect one first).
 * The group's `min` is intentionally NOT enforced here — the engine reports it.
 */
export function toggleGroupMember(
  roster: Roster,
  parentSelectionId: string,
  group: IrGroup,
  entryId: string,
): Roster {
  const parent = findTree(roster.selections, parentSelectionId);
  if (!parent) return roster;

  const members = parent.selections.filter((c) => group.memberEntryIds.includes(c.entryId));
  const already = members.find((c) => c.entryId === entryId);
  if (already) {
    // Deselect only if it keeps the group at or above its min (a required radio
    // group cannot be emptied — you swap to another member instead).
    const min = groupBound(group, "min", 0);
    return members.length - 1 >= min ? remove(roster, already.id) : roster;
  }

  const max = groupBound(group, "max", Infinity);
  if (members.length < max) return addOption(roster, parentSelectionId, entryId);
  if (max === 1) return addOption(remove(roster, members[0]!.id), parentSelectionId, entryId);
  return roster;
}

function freshSelection(entryId: string): RosterSelection {
  return { id: crypto.randomUUID(), entryId, count: 1, selections: [] };
}

/** Build the initial child selections for an entry: group defaults + min-required options. */
function initialChildren(entry: IrEntry): RosterSelection[] {
  const kids: RosterSelection[] = [];
  const grouped = new Set((entry.groups ?? []).flatMap((g) => g.memberEntryIds));

  for (const g of entry.groups ?? []) {
    const min = groupBound(g, "min", 0);
    const pick = g.defaultMemberEntryId ?? (min >= 1 ? g.memberEntryIds[0] : undefined);
    if (pick !== undefined) kids.push(seedChild(entry, pick));
  }
  for (const child of entry.children) {
    if (grouped.has(child.id)) continue; // group members handled above
    if (ownBound(child, "min", 0) >= 1) kids.push(seedChild(entry, child.id));
  }
  return kids;
}

/** A fresh child selection for `entryId`, counted to that option's own min (>=1). */
function seedChild(parent: IrEntry, entryId: string): RosterSelection {
  const child = parent.children.find((c) => c.id === entryId);
  const count = child ? Math.max(1, ownBound(child, "min", 0)) : 1;
  const grandkids = child ? initialChildren(child) : [];
  return { id: crypto.randomUUID(), entryId, count, selections: grandkids };
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
