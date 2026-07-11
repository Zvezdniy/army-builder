import type { IrCondition, IrConditionGroup, IrModifier } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";
import { nodePoints, type CostFn } from "./cost";
import { assertDepth } from "./limits";

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

export function evaluateConditionGroup(
  group: IrConditionGroup,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  return evaluateGroupAtDepth(group, node, state, costOf, 1);
}

function evaluateGroupAtDepth(
  group: IrConditionGroup,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn,
  depth: number,
): boolean {
  assertDepth(depth, "Condition group");
  const conditionResults = (group.conditions ?? []).map((c) =>
    evaluateCondition(c, node, state, costOf),
  );
  const groupResults = (group.conditionGroups ?? []).map((g) =>
    evaluateGroupAtDepth(g, node, state, costOf, depth + 1),
  );
  const members = [...conditionResults, ...groupResults];
  return group.type === "and" ? members.every(Boolean) : members.some(Boolean);
}

export function passesGate(
  conditions: IrCondition[] | undefined,
  conditionGroups: IrConditionGroup[] | undefined,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const conditionsOk = (conditions ?? []).every((c) => evaluateCondition(c, node, state, costOf));
  const groupsOk = (conditionGroups ?? []).every((g) => evaluateConditionGroup(g, node, state, costOf));
  return conditionsOk && groupsOk;
}

export function gatePasses(
  modifier: IrModifier,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  return passesGate(modifier.conditions, modifier.conditionGroups, node, state, costOf);
}
