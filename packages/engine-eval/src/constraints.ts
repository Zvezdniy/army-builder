import type { IrConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";

export function checkConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
): Issue | null {
  const actual = aggregate(node, constraint, state);
  const violated =
    constraint.type === "max"
      ? actual > constraint.value
      : actual < constraint.value;
  if (!violated) return null;

  const target = `${constraint.targetType} "${constraint.targetId}"`;
  const message =
    constraint.type === "max"
      ? `Too many ${target}: ${actual} exceeds max ${constraint.value}`
      : `Not enough ${target}: ${actual} below min ${constraint.value}`;

  return {
    severity: "error",
    code: `constraint.${constraint.type}`,
    message,
    selectionId: node?.selectionId,
    entryId: node?.entry.id,
    constraintId: constraint.id,
  };
}
