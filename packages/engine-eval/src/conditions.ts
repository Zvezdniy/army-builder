import type { IrCondition } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";
import { nodePoints, type CostFn } from "./cost";

export function evaluateCondition(
  condition: IrCondition,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const actual = aggregate(node, condition, state, costOf);
  switch (condition.comparator) {
    case "atLeast":
      return actual >= condition.value;
    case "atMost":
      return actual <= condition.value;
    case "equalTo":
      return actual === condition.value;
    case "notEqualTo":
      return actual !== condition.value;
    case "greaterThan":
      return actual > condition.value;
    case "lessThan":
      return actual < condition.value;
  }
}
