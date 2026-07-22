import type { Roster, RosterSelection, IrCatalogue } from "@muster/domain";
import { unitsByRole, modelCount, catalogueEntry, unitLoadout, selectedDetachmentNames } from "@muster/roster";
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
): string[] {
  const name = catalogueEntry(catalogue, sel.entryId)?.name ?? sel.entryId;
  const models = modelCount(catalogue, sel);
  const nx = prefixNx && models > 1 ? `${models}x ` : "";
  const lines = [`${linePrefix}${nx}${name} (${points} Points)`];
  for (const item of unitLoadout(catalogue, sel).wargear) lines.push(`${bulletPrefix}${item}`);
  return lines;
}

/** Render the roster as a readable plain-text block (see apps/web COPY-list spec) —
 *  pure: no DOM, no clipboard. Points come from the same buildState/resolveCosts
 *  machinery evaluate() uses, so the header total matches the on-screen points bar;
 *  each top-level unit's points are its own subtree's share of that same resolved
 *  cost, so the per-unit figures sum back to the header total exactly. */
export function rosterToText(roster: Roster, catalogue: IrCatalogue, opts: { pointsLimit: number }): string {
  const state = buildState(roster, catalogue);
  const { costOf } = resolveCosts(state);
  const total = totalCost(state, costOf);
  const pointsBySelectionId = new Map(state.roots.map((root) => [root.selectionId, subtreePoints(root, costOf)]));

  const header = [`${roster.name} (${total} Points)`, catalogue.name];
  const detachments = selectedDetachmentNames(roster, catalogue);
  if (detachments.length > 0) header.push(detachments.join(", "));

  // Attached leaders are separate top-level roster.selections (see @muster/roster's
  // attachLeader) — group them by host id so each host unit can nest its leader(s),
  // mirroring RosterList's own attachedByHost map.
  const attachedByHost = new Map<string, RosterSelection[]>();
  for (const sel of roster.selections) {
    if (sel.attachedTo !== undefined) {
      const list = attachedByHost.get(sel.attachedTo) ?? [];
      list.push(sel);
      attachedByHost.set(sel.attachedTo, list);
    }
  }

  const roleBlocks: string[] = [];
  for (const group of unitsByRole(roster, catalogue)) {
    const units = group.units.filter((u) => u.attachedTo === undefined);
    if (units.length === 0) continue; // match RosterList: no non-attached units → role omitted
    const lines = [group.role.toUpperCase(), ""];
    for (const unit of units) {
      lines.push(...unitLines(catalogue, unit, pointsBySelectionId.get(unit.id) ?? 0, "", "  • ", true));
      for (const leader of attachedByHost.get(unit.id) ?? []) {
        lines.push(...unitLines(catalogue, leader, pointsBySelectionId.get(leader.id) ?? 0, "  ↳ ", "    • ", false));
      }
    }
    roleBlocks.push(lines.join("\n"));
  }

  const footer = [`Total: ${total}/${opts.pointsLimit} Points`, "Exported from Muster"];
  return [header.join("\n"), ...roleBlocks, footer.join("\n")].join("\n\n");
}
