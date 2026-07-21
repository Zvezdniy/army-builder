import type { IrCatalogue, IrProfile } from "@muster/domain";
import { catalogueEntry } from "./builder";

/** The "Leader" ability profile on this unit's entry (or any descendant entry),
 *  if present. It is an Abilities profile named "Leader" whose Description names the
 *  units the Leader may attach to. Searching the subtree tolerates a Leader ability
 *  that sits on a sub-model rather than the top-level entry. */
function leaderProfile(catalogue: IrCatalogue, entryId: string): IrProfile | undefined {
  const root = catalogueEntry(catalogue, entryId);
  if (root === undefined) return undefined;
  const stack = [root];
  while (stack.length > 0) {
    const e = stack.pop()!;
    for (const p of e.profiles ?? []) {
      if (p.name === "Leader") return p;
    }
    stack.push(...e.children);
  }
  return undefined;
}

/** The unit's "Leader" ability Description text, or undefined if it is not a Leader. */
export function leaderAbilityText(catalogue: IrCatalogue, entryId: string): string | undefined {
  const p = leaderProfile(catalogue, entryId);
  if (p === undefined) return undefined;
  return p.characteristics.find((c) => c.name === "Description")?.value;
}

/** True when this unit entry carries a "Leader" ability profile. */
export function isLeaderUnit(catalogue: IrCatalogue, entryId: string): boolean {
  return leaderProfile(catalogue, entryId) !== undefined;
}

/** Strip BattleScribe emphasis (`^^`, `**`), a leading bullet/dash, and surrounding
 *  whitespace from one candidate name; collapse inner whitespace. */
function cleanName(s: string): string {
  return s
    .replace(/\^\^/g, "")
    .replace(/\*\*/g, "")
    .replace(/^[\s\-–—•·]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the eligible target unit names out of a "Leader" ability Description.
 *  Handles ■ bullets (incl. ALL-CAPS), `-` bold bullets, and inline comma-separated
 *  lists. `(Excluding …)` clauses are dropped before splitting. Returns [] when the
 *  description carries no attach list (e.g. keyword-only eligibility we don't model). */
export function parseAttachTargets(description: string): string[] {
  const marker = /attached to the following units?:/i.exec(description);
  if (marker === null) return [];
  const body = description
    .slice(marker.index + marker[0].length)
    .replace(/\([^)]*\)/g, " "); // drop parentheticals such as "(Excluding …)"
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of body.split(/[\n,]|■/)) {
    const name = cleanName(piece);
    if (name.length > 0 && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

import type { Roster, RosterSelection } from "@muster/domain";

/** For a Leader selection, the roster units it may attach to right now: eligible by
 *  name (case-insensitive) AND not already led by another Leader. Empty when the
 *  selection is not a Leader, is unknown, or its list resolves to no present unit. */
export function leaderTargets(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string,
): { bodyguardSelectionId: string; bodyguardName: string }[] {
  const leader = roster.selections.find((s) => s.id === leaderSelectionId);
  if (leader === undefined) return [];
  const desc = leaderAbilityText(catalogue, leader.entryId);
  if (desc === undefined) return [];
  const wanted = new Set(parseAttachTargets(desc).map((n) => n.toLowerCase()));
  if (wanted.size === 0) return [];
  const led = new Set(
    roster.selections.map((s) => s.attachedTo).filter((x): x is string => x !== undefined),
  );
  const out: { bodyguardSelectionId: string; bodyguardName: string }[] = [];
  for (const u of roster.selections) {
    if (u.id === leaderSelectionId || led.has(u.id)) continue;
    const name = catalogueEntry(catalogue, u.entryId)?.name;
    if (name !== undefined && wanted.has(name.toLowerCase())) {
      out.push({ bodyguardSelectionId: u.id, bodyguardName: name });
    }
  }
  return out;
}

/** Attach a Leader to a Bodyguard. No-op (returns the same roster) when the target is
 *  not currently an eligible, un-led target for this Leader. */
export function attachLeader(
  roster: Roster, catalogue: IrCatalogue, leaderSelectionId: string, bodyguardSelectionId: string,
): Roster {
  const ok = leaderTargets(roster, catalogue, leaderSelectionId)
    .some((t) => t.bodyguardSelectionId === bodyguardSelectionId);
  if (!ok) return roster;
  return {
    ...roster,
    selections: roster.selections.map((s) =>
      s.id === leaderSelectionId ? { ...s, attachedTo: bodyguardSelectionId } : s),
  };
}

/** Clear a Leader's attachment. No-op when it is not attached. */
export function detachLeader(roster: Roster, leaderSelectionId: string): Roster {
  const leader = roster.selections.find((s) => s.id === leaderSelectionId);
  if (leader === undefined || leader.attachedTo === undefined) return roster;
  return {
    ...roster,
    selections: roster.selections.map((s) => {
      if (s.id !== leaderSelectionId) return s;
      const { attachedTo, ...rest } = s;
      return rest;
    }),
  };
}

/** The Leaders currently attached to a given Bodyguard (v1: 0 or 1). */
export function attachedLeaders(roster: Roster, bodyguardSelectionId: string): RosterSelection[] {
  return roster.selections.filter((s) => s.attachedTo === bodyguardSelectionId);
}
