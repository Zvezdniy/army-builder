import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";

// A group choose-N aggregates the owner's direct member children (self scope) or,
// for a roster-scope limit, every selected member across the whole roster.
export function checkGroupConstraint(
  gc: IrGroupConstraint,
  node: EvalNode,
  group: IrGroup,
  state: EvalState,
): Issue | null {
  const isRoster = gc.scope === "roster";
  const actual = isRoster
    ? state.all.reduce(
        (sum, n) => (group.memberEntryIds.includes(n.entry.id) ? sum + n.effectiveCount : sum),
        0,
      )
    : node.children.reduce(
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
    selectionId: isRoster ? undefined : node.selectionId,
    entryId: isRoster ? undefined : node.entry.id,
    constraintId: gc.id,
  };
}
