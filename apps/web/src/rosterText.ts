import type { Roster, RosterSelection, IrCatalogue } from "@muster/domain";
import {
  unitsByRole, modelCount, catalogueEntry, unitLoadout, selectedDetachmentNames,
  selectedDetachment, enhancementsForDetachment, detachmentRoot, battlefieldRole, OTHER_ROLE,
} from "@muster/roster";
import { buildState, resolveCosts, totalCost, type EvalNode, type CostFn } from "@muster/engine-eval";

// A top-level roster.selections entry (a unit OR an attached leader — both are
// roots of buildState's tree) sums to its own points PLUS every descendant's, using
// the SAME resolved cost function evaluate() uses. state.all is the disjoint union
// of every root's subtree, so summing this per root and adding the roots together
// reproduces totalCost(state, costOf) exactly — the sum-equals-total invariant the
// caller's test asserts.
function subtreePoints(node: EvalNode, costOf: CostFn): number {
  let sum = costOf(node);
  for (const child of node.children) sum += subtreePoints(child, costOf);
  return sum;
}

// Points come from the same buildState/resolveCosts machinery evaluate() uses, so
// the header total matches the on-screen points bar and each unit's figure is its
// own subtree's share of that same resolved cost — the per-unit figures sum back to
// the header total exactly.
function computePoints(roster: Roster, catalogue: IrCatalogue): { total: number; pointsBySelectionId: Map<string, number> } {
  const state = buildState(roster, catalogue);
  const { costOf } = resolveCosts(state);
  const total = totalCost(state, costOf);
  const pointsBySelectionId = new Map(state.roots.map((root) => [root.selectionId, subtreePoints(root, costOf)]));
  return { total, pointsBySelectionId };
}

// One line for a unit (or an attached leader), plus its wargear bullets at the
// given indent. `prefixNx` gates the "Nx " model-count prefix — the spec only
// shows it on the host unit line, not the nested leader line.
function unitLines(
  catalogue: IrCatalogue,
  sel: RosterSelection,
  points: number,
  linePrefix: string,
  bulletPrefix: string,
  prefixNx: boolean,
  suffix = "",
): string[] {
  const name = catalogueEntry(catalogue, sel.entryId)?.name ?? sel.entryId;
  const models = modelCount(catalogue, sel);
  const nx = prefixNx && models > 1 ? `${models}x ` : "";
  const lines = [`${linePrefix}${nx}${name} (${points} Points)${suffix}`];
  for (const item of unitLoadout(catalogue, sel).wargear) lines.push(`${bulletPrefix}${item}`);
  return lines;
}

// Attached leaders are separate top-level roster.selections (see @muster/roster's
// attachLeader) — group them by host id so each host unit can nest its leader(s),
// mirroring RosterList's own attachedByHost map.
function attachedByHost(roster: Roster): Map<string, RosterSelection[]> {
  const map = new Map<string, RosterSelection[]>();
  for (const sel of roster.selections) {
    if (sel.attachedTo !== undefined) {
      const list = map.get(sel.attachedTo) ?? [];
      list.push(sel);
      map.set(sel.attachedTo, list);
    }
  }
  return map;
}

// The role-grouped unit body shared by every text format: uppercase role headers,
// each unit with its points + wargear bullets, attached leaders nested beneath their
// host. Returns one string per role block (caller joins blocks with a blank line).
function roleBlocks(roster: Roster, catalogue: IrCatalogue, pointsBySelectionId: Map<string, number>): string[] {
  const byHost = attachedByHost(roster);
  const wl = (id: string): string => (roster.warlordId === id ? " [Warlord]" : "");
  const blocks: string[] = [];
  for (const group of unitsByRole(roster, catalogue)) {
    const units = group.units.filter((u) => u.attachedTo === undefined);
    if (units.length === 0) continue; // match RosterList: no non-attached units → role omitted
    const lines = [group.role.toUpperCase(), ""];
    for (const unit of units) {
      lines.push(...unitLines(catalogue, unit, pointsBySelectionId.get(unit.id) ?? 0, "", "  • ", true, wl(unit.id)));
      for (const leader of byHost.get(unit.id) ?? []) {
        lines.push(...unitLines(catalogue, leader, pointsBySelectionId.get(leader.id) ?? 0, "  ↳ ", "    • ", false, wl(leader.id)));
      }
    }
    blocks.push(lines.join("\n"));
  }
  return blocks;
}

// Every top-level unit (units + attached leaders), excluding the detachment's own
// root selection — the datasheets that make up the army.
function armyUnits(roster: Roster, catalogue: IrCatalogue): RosterSelection[] {
  const detRootId = detachmentRoot(catalogue)?.id;
  return roster.selections.filter((s) => s.entryId !== detRootId);
}

// The Warlord line the WTC header needs. Prefer the player's explicit pick
// (roster.warlordId); when unset, derive a best-effort one — the first Epic Hero,
// else the first Character/HQ, in roster order. The exported text is editable, so a
// rare wrong guess is trivially corrected; undefined means no character at all.
function warlordName(roster: Roster, catalogue: IrCatalogue): string | undefined {
  if (roster.warlordId !== undefined) {
    const picked = roster.selections.find((s) => s.id === roster.warlordId);
    if (picked) return catalogueEntry(catalogue, picked.entryId)?.name;
  }
  const roleOf = (sel: RosterSelection): string => {
    const entry = catalogueEntry(catalogue, sel.entryId);
    return entry ? battlefieldRole(entry, catalogue) : OTHER_ROLE;
  };
  const units = armyUnits(roster, catalogue);
  for (const role of ["Epic Hero", "Character", "HQ"]) {
    const hit = units.find((s) => roleOf(s) === role);
    if (hit) return catalogueEntry(catalogue, hit.entryId)?.name;
  }
  return undefined;
}

// One "+ ENHANCEMENT: <name> (on <host>)" line per enhancement actually taken in the
// roster: a selection whose entry is one of the current detachment's enhancements,
// attributed to the top-level unit it sits under.
function enhancementLines(roster: Roster, catalogue: IrCatalogue): string[] {
  const detId = selectedDetachment(roster, catalogue);
  if (detId === undefined) return [];
  const enhIds = new Set(enhancementsForDetachment(catalogue, detId).map((e) => e.id));
  if (enhIds.size === 0) return [];
  const lines: string[] = [];
  for (const unit of armyUnits(roster, catalogue)) {
    const host = catalogueEntry(catalogue, unit.entryId)?.name ?? unit.entryId;
    const walk = (sel: RosterSelection): void => {
      for (const child of sel.selections) {
        if (enhIds.has(child.entryId)) {
          const nm = catalogueEntry(catalogue, child.entryId)?.name ?? child.entryId;
          lines.push(`+ ENHANCEMENT: ${nm} (on ${host})`);
        }
        walk(child);
      }
    };
    walk(unit);
  }
  return lines;
}

function footer(total: number, pointsLimit: number): string {
  return [`Total: ${total}/${pointsLimit} Points`, "Exported from Muster"].join("\n");
}

/** Render the roster as a readable plain-text block (units by role, points, wargear
 *  bullets, nested leaders) — pure: no DOM, no clipboard. Points come from the same
 *  buildState/resolveCosts machinery evaluate() uses, so the header total matches the
 *  on-screen points bar and per-unit figures sum back to it exactly. */
export function rosterToText(roster: Roster, catalogue: IrCatalogue, opts: { pointsLimit: number }): string {
  const { total, pointsBySelectionId } = computePoints(roster, catalogue);
  const header = [`${roster.name} (${total} Points)`, catalogue.name];
  const detachments = selectedDetachmentNames(roster, catalogue);
  if (detachments.length > 0) header.push(detachments.join(", "));
  return [header.join("\n"), ...roleBlocks(roster, catalogue, pointsBySelectionId), footer(total, opts.pointsLimit)].join("\n\n");
}

/** Render the roster in a tournament (WTC-style) layout: a "+ …" summary header
 *  block — faction, detachment, total points, warlord, enhancements, unit count —
 *  above the same role-grouped body as {@link rosterToText}. */
export function rosterToTournamentText(roster: Roster, catalogue: IrCatalogue, opts: { pointsLimit: number }): string {
  const { total, pointsBySelectionId } = computePoints(roster, catalogue);
  const detachments = selectedDetachmentNames(roster, catalogue);
  const bar = "+".repeat(50);
  const summary = [
    bar,
    `+ FACTION: ${catalogue.name}`,
    ...(detachments.length > 0 ? [`+ DETACHMENT: ${detachments.join(", ")}`] : []),
    `+ TOTAL ARMY POINTS: ${total}pts`,
    `+ WARLORD: ${warlordName(roster, catalogue) ?? "—"}`,
    ...enhancementLines(roster, catalogue),
    `+ NUMBER OF UNITS: ${armyUnits(roster, catalogue).length}`,
    bar,
  ].join("\n");
  return [
    `${roster.name} (${total} Points)`,
    summary,
    ...roleBlocks(roster, catalogue, pointsBySelectionId),
    footer(total, opts.pointsLimit),
  ].join("\n\n");
}
