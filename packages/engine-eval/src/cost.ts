import type { EvalNode, EvalState } from "./state";

export type CostFn = (node: EvalNode) => number;

export function nodePoints(node: EvalNode): number {
  const cost = node.entry.costs.find((c) => c.name === "points");
  return (cost?.value ?? 0) * node.effectiveCount;
}

export function totalCost(state: EvalState, costOf: CostFn = nodePoints): number {
  return state.all.reduce((sum, node) => sum + costOf(node), 0);
}
