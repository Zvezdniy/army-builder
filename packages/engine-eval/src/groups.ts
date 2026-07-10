import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode } from "./state";

// A group choose-N aggregates the owner's direct member children (members are
// flattened as direct children of the owning entry). Counts selections only.
export function checkGroupConstraint(
  gc: IrGroupConstraint,
  node: EvalNode,
  group: IrGroup,
): Issue | null {
  const actual = node.children.reduce(
    (sum, c) => (group.memberEntryIds.includes(c.entry.id) ? sum + c.effectiveCount : sum),
    0,
  );
  const violated = gc.type === "max" ? actual > gc.value : actual < gc.value;
  if (!violated) return null;

  const message =
    gc.type === "max"
      ? `Too many in "${group.name}": ${actual} exceeds max ${gc.value}`
      : `Not enough in "${group.name}": ${actual} below min ${gc.value}`;

  return {
    severity: "error",
    code: gc.type === "max" ? "group.max" : "group.min",
    message,
    selectionId: node.selectionId,
    entryId: node.entry.id,
    constraintId: gc.id,
  };
}
