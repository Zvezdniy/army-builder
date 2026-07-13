import type { IrCatalogue, IrEntry, IrGroup, IrProfile, Roster, RosterSelection } from "@muster/domain";

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

/**
 * The root "Detachment" choice entry, if this catalogue models detachments. It is a
 * top-level `upgrade` entry named "Detachment" whose children are the detachment options
 * (matched-play requires exactly one). Absent in catalogues without detachments.
 *
 * NOTE: identification is by English name + type. A localized or differently-named
 * detachment node would silently disable detachment support; revisit if we ingest
 * catalogues that don't follow the BSData "Detachment" convention.
 */
function detachmentRoot(catalogue: IrCatalogue): IrEntry | undefined {
  return catalogue.entries.find((e) => e.name === "Detachment" && e.type === "upgrade");
}

/** The detachment options available in this catalogue (empty if it models none). */
export function availableDetachments(catalogue: IrCatalogue): IrEntry[] {
  return detachmentRoot(catalogue)?.children ?? [];
}

/** The chosen detachment option's entryId, or undefined if none is selected. */
export function selectedDetachment(roster: Roster, catalogue: IrCatalogue): string | undefined {
  const root = detachmentRoot(catalogue);
  if (!root) return undefined;
  return roster.selections.find((s) => s.entryId === root.id)?.selections[0]?.entryId;
}

/**
 * Set (or replace) the army's detachment: ensure exactly one "Detachment" root selection
 * holding the single chosen option. Idempotent per option; changing detachment swaps the
 * option without leaving a duplicate. The option is stored as a real roster selection so
 * roster-scoped enhancement gates count it. No-op if the catalogue models no detachment.
 */
export function setDetachment(roster: Roster, detachmentEntryId: string, catalogue: IrCatalogue): Roster {
  const root = detachmentRoot(catalogue);
  if (!root) return roster;
  // The detachment option is a leaf army-level choice: store it as a bare selection
  // (no initialChildren seeding, which would nest counted selections under it).
  const rootSel: RosterSelection = { ...freshSelection(root.id), selections: [freshSelection(detachmentEntryId)] };
  const withoutOld = roster.selections.filter((s) => s.entryId !== root.id);
  return { ...roster, selections: [...withoutOld, rootSel] };
}

/** Change the army's points limit. */
export function setPointsLimit(roster: Roster, pointsLimit: number): Roster {
  return { ...roster, pointsLimit };
}

/** Find an entry anywhere in the catalogue tree by id (roots and nested children). */
export function catalogueEntry(catalogue: IrCatalogue, entryId: string): IrEntry | undefined {
  return findEntry(catalogue, entryId);
}

/** A datasheet section: all profiles of one typeName across the selected subtree. */
export interface DatasheetSection {
  typeName: string;
  profiles: IrProfile[];
}

/**
 * The live datasheet for a unit selection: every profile found on the unit's own
 * entry and on the entries of its selected descendants, grouped by `typeName` in
 * first-seen order. Profiles identical in name+typeName+characteristics collapse to
 * one (two identical weapons from two models show a single row).
 */
export function datasheet(catalogue: IrCatalogue, selection: RosterSelection): DatasheetSection[] {
  const sections: DatasheetSection[] = [];
  const byType = new Map<string, DatasheetSection>();
  const seen = new Set<string>();

  const visit = (sel: RosterSelection): void => {
    // A selection's entryId always resolves within its own catalogue (the same
    // invariant mapTree/removeTree rely on), so no defensive fallback here.
    const entry = catalogueEntry(catalogue, sel.entryId)!;
    for (const profile of entry.profiles ?? []) {
      const key = profileKey(profile);
      if (seen.has(key)) continue;
      seen.add(key);
      let section = byType.get(profile.typeName);
      if (!section) {
        section = { typeName: profile.typeName, profiles: [] };
        byType.set(profile.typeName, section);
        sections.push(section);
      }
      section.profiles.push(profile);
    }
    for (const child of sel.selections) visit(child);
  };

  visit(selection);
  return sections;
}

function profileKey(p: IrProfile): string {
  const chars = p.characteristics.map((c) => `${c.name}=${c.value}`).join("|");
  return `${p.typeName}|${p.name}|${chars}`;
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

/** A battlefield-role bucket of root units, for the roster list. */
export interface RoleGroup {
  role: string;
  units: RosterSelection[];
}

/** Group the roster's root units by their entry's first category, resolved to a
 *  human name via `catalogue.categoryNames` (fallback: the id, then "Other"). */
export function unitsByRole(roster: Roster, catalogue: IrCatalogue): RoleGroup[] {
  const groups: RoleGroup[] = [];
  const byRole = new Map<string, RoleGroup>();
  // The detachment is an army-level choice shown in the setup bar, not a roster unit;
  // exclude its root selection so it never surfaces as a clickable "Detachment" unit.
  const detId = detachmentRoot(catalogue)?.id;
  for (const sel of roster.selections) {
    if (sel.entryId === detId) continue;
    const entry = catalogueEntry(catalogue, sel.entryId);
    const catId = entry?.categories[0];
    const role = catId === undefined ? "Other" : (catalogue.categoryNames?.[catId] ?? catId);
    let group = byRole.get(role);
    if (!group) {
      group = { role, units: [] };
      byRole.set(role, group);
      groups.push(group);
    }
    group.units.push(sel);
  }
  return groups;
}

/** A readable loadout summary: the unit's name plus the distinct names of its
 *  selected wargear — descendant selections whose entry carries no Unit statline
 *  (i.e. options/weapons chosen, not the unit's model bodies). */
export function unitLoadout(
  catalogue: IrCatalogue,
  selection: RosterSelection,
): { unit: string; wargear: string[] } {
  const root = catalogueEntry(catalogue, selection.entryId);
  const wargear: string[] = [];
  const seen = new Set<string>();
  const visit = (sel: RosterSelection, depth: number): void => {
    const entry = catalogueEntry(catalogue, sel.entryId);
    const isBody = (entry?.profiles ?? []).some((p) => p.typeName === "Unit");
    if (depth > 0 && entry && !isBody && !seen.has(entry.name)) {
      seen.add(entry.name);
      wargear.push(entry.name);
    }
    for (const child of sel.selections) visit(child, depth + 1);
  };
  visit(selection, 0);
  return { unit: root?.name ?? selection.entryId, wargear };
}

/** Number of models in a unit: sum of counts over selected nodes whose entry
 *  carries a Unit statline profile (IR has no explicit model type). */
export function modelCount(catalogue: IrCatalogue, selection: RosterSelection): number {
  let count = 0;
  const visit = (sel: RosterSelection): void => {
    const entry = catalogueEntry(catalogue, sel.entryId);
    if ((entry?.profiles ?? []).some((p) => p.typeName === "Unit")) count += sel.count;
    for (const child of sel.selections) visit(child);
  };
  visit(selection);
  return count;
}

function freshSelection(entryId: string): RosterSelection {
  return { id: crypto.randomUUID(), entryId, count: 1, selections: [] };
}

/** Build the initial child selections for an entry: group defaults + min-required options. */
function initialChildren(entry: IrEntry): RosterSelection[] {
  const kids: RosterSelection[] = [];
  const grouped = new Set((entry.groups ?? []).flatMap((g) => g.memberEntryIds));
  const childById = new Map(entry.children.map((c) => [c.id, c]));

  for (const g of entry.groups ?? []) {
    const pick = groupSeed(g, childById);
    if (pick !== undefined) kids.push(seedChild(pick));
  }
  for (const child of entry.children) {
    if (grouped.has(child.id)) continue; // group members handled above
    if (ownBound(child, "min", 0) >= 1) kids.push(seedChild(child));
  }
  return kids;
}

/**
 * Choose which member of a group to pre-seed, returning only an id that is a real
 * materialized child of the entry. Prefer the declared default; if it is absent,
 * the "no default" case, or doesn't resolve to a child (e.g. a dangling/cross-file
 * link the parser could not inline), fall back to the first resolvable member when
 * the group is required (min>=1); otherwise seed nothing. This keeps addUnit from
 * ever injecting an unresolvable entryId that would crash evaluate().
 */
function groupSeed(g: IrGroup, childById: Map<string, IrEntry>): IrEntry | undefined {
  // childById spans all of the entry's children; a group's default/members always
  // name its own members, so resolving against the full child set is safe and any
  // real child seeds without crashing.
  if (g.defaultMemberEntryId !== undefined) {
    const def = childById.get(g.defaultMemberEntryId);
    if (def) return def;
  }
  if (groupBound(g, "min", 0) >= 1) {
    for (const id of g.memberEntryIds) {
      const m = childById.get(id);
      if (m) return m;
    }
  }
  return undefined;
}

/** A fresh child selection for a materialized child entry, counted to its own min (>=1). */
function seedChild(child: IrEntry): RosterSelection {
  const count = Math.max(1, ownBound(child, "min", 0));
  return { id: crypto.randomUUID(), entryId: child.id, count, selections: initialChildren(child) };
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
