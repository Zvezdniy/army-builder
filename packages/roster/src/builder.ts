import type { IrCatalogue, IrEntry, IrGroup, IrProfile, Roster, RosterSelection, VisibilityModifier, IrCondition } from "@muster/domain";
import { battlefieldRole, OTHER_ROLE, roleRank } from "./roles";

// The BSData cost-type an 11e detachment is priced in. Used only to shape the
// synthetic fallback group's max (a budgeted root accumulates; an unpriced 10e root is
// single-choice). engine-eval owns the canonical copy for legality — this rules-free
// package can't import it, so it names the same literal; both are fixed BSData strings.
const DETACHMENT_POINTS = "Detachment Points";

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

/** Units addable at the roster root (the catalogue's top-level entries). The
 *  detachment root is excluded — it is an army-level choice made in the setup
 *  wizard (via toggleDetachment), not a unit to add through the picker. */
export function availableUnits(catalogue: IrCatalogue): IrEntry[] {
  const detId = detachmentRoot(catalogue)?.id;
  return catalogue.entries.filter((e) => e.id !== detId);
}

/** Append a root unit selection, prepopulated with its default/required loadout. */
export function addUnit(roster: Roster, entryId: string, catalogue?: IrCatalogue): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return { ...roster, selections: [...roster.selections, selection] };
}

/** Nest an option (child selection) under `parentSelectionId`. With a `catalogue`, the
 *  option is prepopulated with its default/required loadout (`initialChildren`), the way
 *  `addUnit` seeds a root unit — so a picked option arrives with its mandatory sub-parts
 *  (weapons, shields, abilities). Without a catalogue it is added bare (legacy callers). */
export function addOption(
  roster: Roster,
  parentSelectionId: string,
  entryId: string,
  catalogue?: IrCatalogue,
): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, selection],
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
 * Most BSData catalogues name the detachment root (and its choose-group) exactly
 * "Detachment", but a handful use spelling variants that are otherwise identical in
 * shape: "Detachments" (Adeptus Custodes, Adeptus Mechanicus, Aeldari, Drukhari,
 * Grey Knights) and "Detachment Choice" (Leagues of Votann, Ynnari). Matching only
 * "Detachment" silently disabled detachment support (Custodes) or capped selection at
 * one via the synthetic fallback group (Mechanicus). This predicate accepts all three
 * so the naming variant no longer breaks detachments.
 */
function isDetachmentLabel(name: string): boolean {
  return /^detachments?(?: choice)?$/i.test(name.trim());
}

/**
 * The root "Detachment" choice entry, if this catalogue models detachments. It is a
 * top-level `upgrade` entry named "Detachment" (or a spelling variant — see
 * `isDetachmentLabel`) whose children are the detachment options. Absent in catalogues
 * without detachments.
 *
 * NOTE: identification is by English name + type; a localized detachment node would
 * still slip past. Revisit if we ingest non-English catalogues.
 */
function detachmentRoot(catalogue: IrCatalogue): IrEntry | undefined {
  return catalogue.entries.find((e) => e.type === "upgrade" && isDetachmentLabel(e.name));
}

/** The detachment options available in this catalogue (empty if it models none). */
export function availableDetachments(catalogue: IrCatalogue): IrEntry[] {
  return detachmentRoot(catalogue)?.children ?? [];
}

/** The chosen detachments' entryIds, in selection order — several in 11e (a DP
 *  budget, no group max), at most one in 10e (matched play, `max 1`). Empty if
 *  the catalogue models no detachment or none is chosen yet. */
export function selectedDetachments(roster: Roster, catalogue: IrCatalogue): string[] {
  const root = detachmentRoot(catalogue);
  if (!root) return [];
  const rootSel = roster.selections.find((s) => s.entryId === root.id);
  return rootSel ? rootSel.selections.map((s) => s.entryId) : [];
}

/** The first chosen detachment's entryId, or undefined if none is selected. A
 *  thin "first of" wrapper over `selectedDetachments` for callers that only
 *  care about a single detachment (10e is always exactly this; 11e callers
 *  that need the full set use `selectedDetachments` directly). */
export function selectedDetachment(roster: Roster, catalogue: IrCatalogue): string | undefined {
  return selectedDetachments(roster, catalogue)[0];
}

/** Selection ids of the detachment root subtree — the army-level detachment choice
 *  and everything under it. Callers exclude these from unit-facing signals (like the
 *  "became unavailable" warning): the detachment is picked in the setup wizard, not a
 *  roster unit, and its options carry their own availability gates, so surfacing that
 *  as a unit warning is noise. Empty if the catalogue models no detachment or none is
 *  chosen. */
export function detachmentSelectionIds(roster: Roster, catalogue: IrCatalogue): Set<string> {
  const ids = new Set<string>();
  const root = detachmentRoot(catalogue);
  if (!root) return ids;
  const rootSel = roster.selections.find((s) => s.entryId === root.id);
  const walk = (s: RosterSelection): void => {
    ids.add(s.id);
    s.selections.forEach(walk);
  };
  if (rootSel) walk(rootSel);
  return ids;
}

/**
 * The root Detachment entry's own choose-group (named "Detachment" or a spelling
 * variant — see `isDetachmentLabel`; Adeptus Mechanicus names the group "Detachments").
 * Its constraints ARE the edition rule: 10e catalogues declare `min 1, max 1` on it, so
 * `toggleGroupMember` swaps; 11e catalogues declare only `min 1` (the `max` is gone,
 * replaced by a Detachment Points budget), so it accumulates. No edition check —
 * the difference is read straight from the data.
 *
 * Falls back to a synthetic group when the root carries no matching group at all —
 * defensive only; every real BSData Detachment root models this group. The fallback's
 * max mirrors the edition: a root whose options are priced in Detachment Points (11e)
 * budgets several detachments, so it gets `min 1` only; otherwise (10e) `min 1, max 1`.
 */
function detachmentGroup(root: IrEntry): IrGroup {
  const modelled = root.groups?.find((g) => isDetachmentLabel(g.name));
  if (modelled) return modelled;
  // `min 1` makes this a REQUIRED radio in toggleGroupMember: you swap/keep the chosen
  // detachment, you never empty it. A Detachment-Points-budgeted (11e) root omits the
  // max so the fallback accumulates like the real modelled 11e group would.
  const budgeted = root.children.some((c) => c.costs.some((cost) => cost.name === DETACHMENT_POINTS));
  const min: IrGroup["constraints"][number] = { id: `${root.id}.detachment.min1`, type: "min", value: 1, scope: "self" };
  return {
    id: `${root.id}.detachment`,
    name: "Detachment",
    memberEntryIds: root.children.map((c) => c.id),
    constraints: budgeted
      ? [min]
      : [{ id: `${root.id}.detachment.max1`, type: "max", value: 1, scope: "self" }, min],
  };
}

/**
 * Toggle a detachment option: select it, or deselect it, or (on a `max 1` group,
 * i.e. 10e) swap it for whatever was selected before — exactly `toggleGroupMember`'s
 * existing behaviour against the root Detachment entry's "Detachment" group. Creates
 * the root "Detachment" selection the first time a detachment is picked, and reuses
 * it afterwards (never duplicated). The option is stored as a bare selection (no
 * initialChildren seeding) so roster-scoped enhancement gates still count it as a real
 * selection without nesting unrelated sub-parts under it. No-op if the catalogue
 * models no detachment.
 */
export function toggleDetachment(roster: Roster, detachmentEntryId: string, catalogue: IrCatalogue): Roster {
  const root = detachmentRoot(catalogue);
  if (!root) return roster;
  const existing = roster.selections.find((s) => s.entryId === root.id);
  const rootSel = existing ?? freshSelection(root.id);
  const withRoot = existing ? roster : { ...roster, selections: [...roster.selections, rootSel] };
  return toggleGroupMember(withRoot, rootSel.id, detachmentGroup(root), detachmentEntryId);
}

/** Change the army's points limit. */
export function setPointsLimit(roster: Roster, pointsLimit: number): Roster {
  return { ...roster, pointsLimit };
}

/** Find an entry anywhere in the catalogue tree by id (roots and nested children). */
export function catalogueEntry(catalogue: IrCatalogue, entryId: string): IrEntry | undefined {
  return findEntry(catalogue, entryId);
}

/** Flatten a visibility modifier's conditions: its own `conditions` plus, recursively,
 *  every nested `conditionGroups[].conditions`. */
function flattenConditions(vm: VisibilityModifier): IrCondition[] {
  const out: IrCondition[] = [...(vm.conditions ?? [])];
  const stack = [...(vm.conditionGroups ?? [])];
  while (stack.length > 0) {
    const g = stack.pop()!;
    out.push(...(g.conditions ?? []));
    stack.push(...(g.conditionGroups ?? []));
  }
  return out;
}

/** True when `entry` has a `set hidden` visibility gate that hides it until
 *  `detachmentId` is selected — a `lessThan selections <detachmentId>` condition. */
function visibilityGatesDetachment(entry: IrEntry, detachmentId: string): boolean {
  for (const vm of entry.visibilityModifiers ?? []) {
    if (vm.set !== true) continue;
    for (const c of flattenConditions(vm)) {
      if (c.field === "selections" && c.comparator === "lessThan"
        && c.targetType === "entry" && c.targetId === detachmentId) {
        return true;
      }
    }
  }
  return false;
}

/** The enhancements a detachment unlocks: every entry in the catalogue tree whose
 *  `set hidden` visibility gate is keyed on this detachment's selection (see
 *  `visibilityGatesDetachment`). Deduped by entry id in first-encounter order. This
 *  reads the real per-detachment gate the parser emits, so it works for every faction
 *  — unlike a group-name convention that only the Space Marine family follows. */
export function enhancementsForDetachment(catalogue: IrCatalogue, detachmentId: string): IrEntry[] {
  const stack: IrEntry[] = [...catalogue.entries];
  const seen = new Set<string>();
  const out: IrEntry[] = [];
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (!seen.has(e.id) && visibilityGatesDetachment(e, detachmentId)) {
      seen.add(e.id);
      out.push(e);
    }
    stack.push(...e.children);
  }
  return out;
}

/** The detachment's own rules resolved to displayable text, in declaration order,
 *  dropping any name whose text is absent or empty in `ruleTexts`. Shared by the
 *  wizard preview and the builder's detachment panel so they render identical rules. */
export function detachmentRuleTexts(
  catalogue: IrCatalogue, detachmentId: string,
): { name: string; text: string }[] {
  const det = availableDetachments(catalogue).find((d) => d.id === detachmentId);
  if (det === undefined) return [];
  const out: { name: string; text: string }[] = [];
  for (const name of det.ruleNames ?? []) {
    const text = catalogue.ruleTexts?.[name];
    if (typeof text === "string" && text.length > 0) out.push({ name, text });
  }
  return out;
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

/** First "N+" save token in a string, or undefined. Handles a bare "4+", a sentence
 *  ("The bearer has a 5+ invulnerable save"), and a footnoted "4+\n* …". */
function extractSavePlus(text: string): string | undefined {
  const m = text.match(/(\d+)\+/);
  return m ? `${m[1]}+` : undefined;
}

/** A resolved invulnerable save for the statline chip: its value ("4+"), the granting
 *  profile's name, and whether the source text is a BARE save (just the value) — a bare
 *  one is redundant with the chip and dropped from the Abilities list by the web. */
export interface InvulnSave {
  value: string;
  sourceName: string;
  bare: boolean;
}

interface InvulnCandidate extends InvulnSave {
  rank: number;  // numeric save (4 for "4+"); lower is better (invulns don't stack)
  named: boolean; // class 1/2 (trusted by name) beats class 3 (text-scanned) on a tie
}

/**
 * Resolve a unit's invulnerable save from its selected subtree, PROVENANCE-AWARE.
 * Three candidate classes, best (lowest) wins:
 *  1. any source — a `typeName === "Invulnerable Save"` profile (legacy/synthetic);
 *  2. any source — an `Abilities` profile named /^invulnerable save/i (the infoLink/native
 *     form, e.g. Logan Grimnar — trusted by NAME regardless of provenance);
 *  3. WARGEAR source ONLY (a selection at depth>0 whose entry is not a model body — an
 *     equipped item or enhancement) — an `Abilities` profile whose Description mentions an
 *     invulnerable save with an `N+`.
 * Class 3 is provenance-gated so faction/army rules collated onto the unit's OWN entry
 * (e.g. "Veil of Ancients"), which share the phrasing, never leak in. `undefined` when no
 * candidate parses to a save value (a broken chip never shows).
 */
export function invulnSave(
  catalogue: IrCatalogue,
  selection: RosterSelection,
): InvulnSave | undefined {
  const candidates: InvulnCandidate[] = [];
  const consider = (value: string | undefined, sourceName: string, bare: boolean, named: boolean): void => {
    if (!value) return;
    const rank = parseInt(value, 10);
    if (Number.isNaN(rank)) return;
    candidates.push({ value, sourceName, bare, rank, named });
  };

  const visit = (sel: RosterSelection, depth: number): void => {
    const entry = catalogueEntry(catalogue, sel.entryId)!;
    const profiles = entry.profiles ?? [];
    const isBody = profiles.some((p) => p.typeName === "Unit");
    const isWargear = depth > 0 && !isBody;
    for (const p of profiles) {
      // Class 1: dedicated section — value is its single characteristic.
      if (p.typeName === "Invulnerable Save") {
        const raw = p.characteristics[0]?.value ?? "";
        consider(extractSavePlus(raw) ?? (raw.trim() || undefined), p.name, true, true);
        continue;
      }
      if (p.typeName !== "Abilities") continue;
      const desc = p.characteristics.find((c) => c.name === "Description")?.value ?? "";
      // Class 2: ability literally named "Invulnerable Save" — trusted by name.
      if (/^invulnerable save/i.test(p.name)) {
        const v = extractSavePlus(desc);
        consider(v, p.name, desc.trim() === v, true);
        continue;
      }
      // Class 3: wargear-sourced ability whose text grants an invuln (provenance-gated).
      if (isWargear && /invulnerable save/i.test(desc)) {
        consider(extractSavePlus(desc), p.name, false, false);
      }
    }
    for (const child of sel.selections) visit(child, depth + 1);
  };

  visit(selection, 0);
  if (candidates.length === 0) return undefined;
  // Best save first; tie-break prefers a bare (unconditional) then a named candidate.
  candidates.sort(
    (a, b) => a.rank - b.rank || Number(b.bare) - Number(a.bare) || Number(b.named) - Number(a.named),
  );
  const best = candidates[0]!;
  return { value: best.value, sourceName: best.sourceName, bare: best.bare };
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
  | { kind: "single"; required: boolean }         // max 1 — a radio (required when min >= 1)
  | { kind: "multi"; max: number }                // max > 1, single-count members — up to `max` toggles
  | { kind: "counted"; min: number; max: number }; // max > 1, repeatable members — per-member steppers summing to [min,max]

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

/** True when a group's members are repeatable models (each can appear more than
 *  once), so the group is a count-distribution ("4-9 Terminators": pick how many
 *  of each loadout, summing to the group bound) rather than a set of on/off toggles.
 *  Detected from the members' OWN count bounds: a stepper (max > 1) or a fixed
 *  multiplicity above 1. Empty/omitted members → not counted (the toggle default). */
function membersAreCounted(members: IrEntry[]): boolean {
  return members.some((m) => {
    const c = optionControl(m);
    return c.kind === "stepper" || (c.kind === "fixed" && c.count > 1);
  });
}

/**
 * Classify how a group is edited. Pass the group's member entries to detect the
 * counted case (per-member steppers); without them a max>1 group falls back to
 * `multi` toggles, which keeps existing name-only callers working.
 * - `single` (max 1): a radio (required when min >= 1).
 * - `counted` (max > 1, repeatable members): per-member count steppers summing to [min,max].
 * - `multi` (max > 1, single-count members): up to `max` on/off toggles.
 */
export function groupControl(group: IrGroup, members: IrEntry[] = []): GroupControl {
  const max = groupBound(group, "max", Infinity);
  const min = groupBound(group, "min", 0);
  if (max === 1) return { kind: "single", required: min >= 1 };
  if (max > 1 && membersAreCounted(members)) return { kind: "counted", min, max };
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

/** Per-member model counts of a counted group directly under `selectionId`
 *  (entryId → number of model selections; members with none are absent). A counted
 *  member is stored as N distinct one-each selections, so this counts occurrences. */
export function groupMemberCounts(
  roster: Roster,
  selectionId: string,
  group: IrGroup,
): Map<string, number> {
  const counts = new Map<string, number>();
  const sel = findTree(roster.selections, selectionId);
  if (!sel) return counts;
  for (const c of sel.selections) {
    if (group.memberEntryIds.includes(c.entryId)) {
      counts.set(c.entryId, (counts.get(c.entryId) ?? 0) + c.count);
    }
  }
  return counts;
}

/** Total models chosen across all of a group's members under `selectionId` — the
 *  quantity the group's min/max bounds (matches the engine's group aggregate). */
export function groupTotal(roster: Roster, selectionId: string, group: IrGroup): number {
  let total = 0;
  for (const n of groupMemberCounts(roster, selectionId, group).values()) total += n;
  return total;
}

/**
 * Reconcile a counted group member to exactly `count` model selections under a unit.
 * Each model is a distinct one-each selection carrying its own required loadout (via
 * initialChildren), so per-model wargear constraints (e.g. "1 storm bolter per model")
 * hold — a single count-N node would inflate that wargear's effectiveCount and trip
 * those max-1 gates. Surplus models are dropped from the end; new ones are appended.
 * `count <= 0` removes all of the member's models. Group/member bounds are the
 * caller's/engine's concern; this primitive just matches the requested model count.
 */
export function setGroupMemberCount(
  roster: Roster,
  parentSelectionId: string,
  group: IrGroup,
  entryId: string,
  count: number,
  catalogue: IrCatalogue,
): Roster {
  if (!group.memberEntryIds.includes(entryId)) return roster;
  const parent = findTree(roster.selections, parentSelectionId);
  if (!parent) return roster;
  const current = parent.selections.filter((c) => c.entryId === entryId);
  const target = Math.max(0, count);
  if (target === current.length) return roster;

  if (target < current.length) {
    // Drop the surplus models (the trailing ones), removing each subtree.
    let next = roster;
    for (const surplus of current.slice(target)) next = remove(next, surplus.id);
    return next;
  }

  // Append the shortfall as fresh one-each model selections, each with its own loadout.
  // An unresolvable member (dangling/cross-file link the parser could not inline) is a
  // no-op: never inject an entryId absent from the catalogue — it would crash the
  // datasheet/evaluate lookups (the same invariant groupSeed protects on seeding).
  const memberEntry = findEntry(catalogue, entryId);
  if (!memberEntry) return roster;
  const additions: RosterSelection[] = [];
  for (let i = 0; i < target - current.length; i += 1) additions.push(modelInstance(memberEntry));
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, ...additions],
    })),
  };
}

/**
 * Toggle a group member under a unit while respecting the group's `max`.
 * - already selected → deselect it (remove), UNLESS it is the sole pick of a
 *   required single-choice group (a radio can't be emptied — you swap instead).
 * - room left (below max) → add it.
 * - at a max of 1 → swap: drop the current member, add the new one.
 * - at a max above 1 (full) → no-op (the group is full; deselect one first).
 * The group's `min` is intentionally NOT enforced for multi/counted groups — the
 * engine reports it; enforcing it here only traps the user below a min they cannot
 * reach through the UI (the original "can't deselect a below-min group" bug).
 * With a `catalogue`, a newly added member is seeded with its required loadout
 * (see `addOption`); without one it is added bare (legacy callers).
 */
export function toggleGroupMember(
  roster: Roster,
  parentSelectionId: string,
  group: IrGroup,
  entryId: string,
  catalogue?: IrCatalogue,
): Roster {
  const parent = findTree(roster.selections, parentSelectionId);
  if (!parent) return roster;

  const members = parent.selections.filter((c) => group.memberEntryIds.includes(c.entryId));
  const already = members.find((c) => c.entryId === entryId);
  const max = groupBound(group, "max", Infinity);
  if (already) {
    // A required radio (max 1, min >= 1) keeps its sole pick; you swap to another
    // member instead of emptying it. Every other group deselects freely.
    const required = max === 1 && groupBound(group, "min", 0) >= 1;
    return required ? roster : remove(roster, already.id);
  }

  if (members.length < max) return addOption(roster, parentSelectionId, entryId, catalogue);
  if (max === 1) return addOption(remove(roster, members[0]!.id), parentSelectionId, entryId, catalogue);
  return roster;
}

/** A battlefield-role bucket of root units, for the roster list. */
export interface RoleGroup {
  role: string;
  units: RosterSelection[];
}

/** Group the roster's root units by their battlefield role (`battlefieldRole`),
 *  ordered by `ROLE_ORDER` so Characters lead and Other trails — instead of the
 *  entry's incidental first category. */
export function unitsByRole(roster: Roster, catalogue: IrCatalogue): RoleGroup[] {
  const groups: RoleGroup[] = [];
  const byRole = new Map<string, RoleGroup>();
  // The detachment is an army-level choice shown in the setup bar, not a roster unit;
  // exclude its root selection so it never surfaces as a clickable "Detachment" unit.
  const detId = detachmentRoot(catalogue)?.id;
  for (const sel of roster.selections) {
    if (sel.entryId === detId) continue;
    const entry = catalogueEntry(catalogue, sel.entryId);
    const role = entry ? battlefieldRole(entry, catalogue) : OTHER_ROLE;
    let group = byRole.get(role);
    if (!group) {
      group = { role, units: [] };
      byRole.set(role, group);
      groups.push(group);
    }
    group.units.push(sel);
  }
  return groups.sort((a, b) => roleRank(a.role) - roleRank(b.role));
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
    if (pick === undefined) continue;
    // A counted group (repeatable models, e.g. "4-9 Terminators") seeds its default
    // member as N distinct one-each model selections up to the group minimum, so the
    // unit starts at a legal squad size AND each model carries its own per-model
    // wargear (a single count-N node would inflate that wargear's effectiveCount and
    // trip per-model max-1 constraints). A single/toggle member stays one selection.
    const members = g.memberEntryIds.map((id) => childById.get(id)).filter((m): m is IrEntry => m !== undefined);
    const control = groupControl(g, members);
    if (control.kind === "counted") {
      // Seed as N one-each model instances (count:1), NOT seedChild — seedChild would
      // apply the member's own min as the count, breaking the one-model-per-node
      // invariant a counted group relies on (and re-inflating nested per-model wargear).
      const n = Math.max(1, Math.min(control.min, ownBound(pick, "max", Infinity)));
      for (let i = 0; i < n; i++) kids.push(modelInstance(pick));
    } else {
      kids.push(seedChild(pick));
    }
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

/** One model instance of `entry` (count:1) with its own required loadout seeded. A
 *  counted group member is stored as N of these so each model keeps its own wargear
 *  at effectiveCount 1 — used by both group seeding and setGroupMemberCount. */
function modelInstance(entry: IrEntry): RosterSelection {
  return { id: crypto.randomUUID(), entryId: entry.id, count: 1, selections: initialChildren(entry) };
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
