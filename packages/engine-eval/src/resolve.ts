import type { IrCost } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { nodePoints, pointsCost, type CostFn } from "./cost";
import { applyModifiers } from "./modifiers";

export const MAX_ITERATIONS = 32;

// Shared by effectiveNodePoints and effectiveCostOfType: apply a resolved cost's
// modifiers (if any) against the node/state, then scale the modified unit value by
// the node's effectiveCount. A missing cost (the entry carries none of that name)
// yields 0 — the one place both cost paths turn "no such cost" into an inert 0.
function effectiveCostValue(
  cost: IrCost | undefined,
  node: EvalNode,
  state: EvalState,
  costOf: CostFn,
): number {
  if (!cost) return 0;
  const unit = applyModifiers(cost.value, cost.modifiers, node, state, costOf);
  return unit * node.effectiveCount;
}

export function effectiveNodePoints(
  node: EvalNode,
  state: EvalState,
  costOf: CostFn,
): number {
  return effectiveCostValue(pointsCost(node.entry), node, state, costOf);
}

// Sums a NAMED cost type (e.g. "Enhancements", "Detachment Points") for a single
// node, with the SAME modifier machinery effectiveNodePoints applies to the points
// cost — a `set`/`increment`/`multiply`/… on a non-points cost was previously
// silently ignored wherever aggregate() summed it (see cost.ts's costOfType, which
// stays a raw, modifier-blind lookup for callers that intentionally want the static
// declared value, e.g. an unpicked option's preview badge). An entry without that
// cost type contributes 0.
export function effectiveCostOfType(
  node: EvalNode,
  typeName: string,
  state: EvalState,
  costOf: CostFn,
): number {
  const cost = node.entry.costs.find((c) => c.name === typeName);
  return effectiveCostValue(cost, node, state, costOf);
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
