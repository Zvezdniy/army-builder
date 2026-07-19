import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { applyModifiers } from "./modifiers";

// A group choose-N aggregates the owner's direct member children (self scope) or,
// for a roster-scope limit, every selected member across the whole roster. The
// limit itself may carry modifiers (set/increment/decrement) gated by conditions
// evaluated against the owner node.
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
  const limit = applyModifiers(gc.value, gc.modifiers, node, state);
  // BattleScribe's convention: a negative max is "no limit" (commonly a modifier
  // setting the cap to -1 to lift it, e.g. relics/enhancements unlimited under a
  // Crusade gate). A negative min is always met (counts are >= 0), so only max
  // needs guarding here.
  const violated = gc.type === "max" ? limit >= 0 && actual > limit : actual < limit;
  if (!violated) return null;

  const message =
    gc.type === "max"
      ? `Too many in "${group.name}": ${actual} exceeds max ${limit}`
      : `Not enough in "${group.name}": ${actual} below min ${limit}`;

  return {
    severity: "error",
    code: gc.type === "max" ? "group.max" : "group.min",
    message,
    selectionId: isRoster ? undefined : node.selectionId,
    entryId: isRoster ? undefined : node.entry.id,
    constraintId: gc.id,
  };
}
