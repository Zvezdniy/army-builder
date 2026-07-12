import type { EvalNode, EvalState } from "./state";
import { nodePoints, pointsCost, type CostFn } from "./cost";
import { applyModifiers } from "./modifiers";

export const MAX_ITERATIONS = 32;

export function effectiveNodePoints(
  node: EvalNode,
  state: EvalState,
  costOf: CostFn,
): number {
  const cost = pointsCost(node.entry);
  if (!cost) return 0;
  const unit = applyModifiers(cost.value, cost.modifiers, node, state, costOf);
  return unit * node.effectiveCount;
}

export interface CostResolution {
  costOf: CostFn;
  converged: boolean;
  iterations: number;
}

export function resolveCosts(state: EvalState): CostResolution {
  // `costMap` is reassigned each pass; `costOf` closes over the binding so it
  // always reads the latest map. A pass computes the next map from the current
  // one, so conditions see the previous iteration's effective costs.
  let costMap = new Map<EvalNode, number>();
  const costOf: CostFn = (n) => costMap.get(n) ?? nodePoints(n);

  let iterations = 0;
  let converged = false;
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const next = new Map<EvalNode, number>();
    for (const node of state.all) {
      next.set(node, effectiveNodePoints(node, state, costOf));
    }
    const stable = state.all.every((n) => next.get(n) === costMap.get(n));
    costMap = next;
    if (stable) {
      converged = true;
      break;
    }
  }
  return { costOf, converged, iterations };
}
