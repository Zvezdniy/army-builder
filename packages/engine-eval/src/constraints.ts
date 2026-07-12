import type { IrConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate, scopeUnanchored } from "./scopes";
import { applyModifiers } from "./modifiers";
import { nodePoints, type CostFn } from "./cost";

export function effectiveConstraintValue(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  return applyModifiers(constraint.value, constraint.modifiers, node, state, costOf);
}

export function checkConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): Issue | null {
  if (scopeUnanchored(node, constraint, state)) return null;
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  const violated = constraint.type === "max" ? actual > limit : actual < limit;
  if (!violated) return null;

  const target = `${constraint.targetType} "${constraint.targetId}"`;
  const message =
    constraint.type === "max"
      ? `Too many ${target}: ${actual} exceeds max ${limit}`
      : `Not enough ${target}: ${actual} below min ${limit}`;

  return {
    severity: "error",
    code: `constraint.${constraint.type}`,
    message,
    selectionId: node?.selectionId,
    entryId: node?.entry.id,
    constraintId: constraint.id,
  };
}
