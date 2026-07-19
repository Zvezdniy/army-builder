import type { IrCost, IrEntry } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";

export type CostFn = (node: EvalNode) => number;

// BattleScribe catalogues name the points cost "pts" (real Warhammer 40k data)
// or "points" (our mini fixtures). Match either; prefer an explicit "pts" when
// both exist, because real catalogues carry a zero-valued "points" cost
// alongside the authoritative "pts" — matching "points" first would price
// every real unit at 0.
const POINTS_COST_NAMES = ["pts", "points"] as const;

export function pointsCost(entry: IrEntry): IrCost | undefined {
  for (const name of POINTS_COST_NAMES) {
    const cost = entry.costs.find((c) => c.name === name);
    if (cost) return cost;
  }
  return undefined;
}

export function nodePoints(node: EvalNode): number {
  const cost = pointsCost(node.entry);
  return (cost?.value ?? 0) * node.effectiveCount;
}

export function totalCost(state: EvalState, costOf: CostFn = nodePoints): number {
  return state.all.reduce((sum, node) => sum + costOf(node), 0);
}

// Sums a named cost type (e.g. "Enhancements") for a single node, scaled by its
// effective count. An entry that carries no cost of that name contributes 0 — a
// force-global cost-type constraint (A1) must aggregate to 0 (inert), never throw,
// for entries/catalogues that don't use that cost type (e.g. Crusade-only costs in
// a matched-play roster).
export function costOfType(node: EvalNode, typeName: string): number {
  const cost = node.entry.costs.find((c) => c.name === typeName);
  return (cost?.value ?? 0) * node.effectiveCount;
}
