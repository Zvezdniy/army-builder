import type { EvalNode, EvalState } from "./state";

export function nodePoints(node: EvalNode): number {
  const cost = node.entry.costs.find((c) => c.name === "points");
  return (cost?.value ?? 0) * node.effectiveCount;
}

export function totalCost(state: EvalState): number {
  return state.all.reduce((sum, node) => sum + nodePoints(node), 0);
}
