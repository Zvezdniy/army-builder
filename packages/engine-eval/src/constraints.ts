import type { IrConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate, scopeUnanchored } from "./scopes";
import { applyModifiers } from "./modifiers";
import { nodePoints, type CostFn } from "./cost";
import type { TargetNamer } from "./names";
import { correctedConstraintValue } from "./data-corrections";

// The single point where a force constraint's base value is read, before any
// per-selection modifier adjustments (unlocks, increments, …). Both
// checkConstraint and describeConstraint go through here, so
// correctedConstraintValue's upstream-data floor (see data-corrections.ts)
// applies everywhere a constraint's bound is computed, without a second call
// site to keep in sync.
export function effectiveConstraintValue(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  return applyModifiers(correctedConstraintValue(constraint), constraint.modifiers, node, state, costOf);
}

// Like checkConstraint, but reports a constraint's state whether or not it is
// violated — for building a positive pass/fail legality checklist. Returns null
// under the same inapplicability conditions checkConstraint short-circuits on
// (a force-level node-relative scope, or a scope with no anchor); otherwise
// always returns { actual, limit, satisfied }.
export function describeConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): { actual: number; limit: number; satisfied: boolean } | null {
  if (node === null && constraint.scope !== "force" && constraint.scope !== "roster") return null;
  if (scopeUnanchored(node, constraint, state)) return null;
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  // A negative max is BattleScribe's "no limit" sentinel → always satisfied (see
  // checkConstraint). A negative min is trivially met (counts are >= 0).
  const satisfied = constraint.type === "max" ? limit < 0 || actual <= limit : actual >= limit;
  return { actual, limit, satisfied };
}

export function checkConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
  nameOf?: TargetNamer,
): Issue | null {
  // Force-level checks (node === null) can only evaluate node-independent scopes.
  // A node-relative scope (self/parent/root-entry/ancestor/unit/…) has no owning
  // node to anchor to and would make scopeNodes throw and abort evaluate(); such a
  // constraint does not apply at force level — skip it.
  if (node === null && constraint.scope !== "force" && constraint.scope !== "roster") return null;
  if (scopeUnanchored(node, constraint, state)) return null;
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  // A negative max is BattleScribe's "no limit" sentinel (e.g. a modifier setting
  // the cap to -1 to lift it). Treat it as unbounded rather than flagging every
  // selection as "exceeds max -1". A negative min is trivially met (counts >= 0).
  const violated = constraint.type === "max" ? limit >= 0 && actual > limit : actual < limit;
  if (!violated) return null;

  // A force-target constraint (targetType: "force") sums over the whole force
  // with no category/entry filter — its targetId is just the forceEntry's raw
  // GUID, which is meaningless to a user (e.g. `force "bb9d-299a-ed60-2d8a"`).
  // Its `field` is the actual human-facing subject (a cost-type name like
  // "Enhancements", or "selections" for a plain army-wide selection count), so
  // use that as the label instead. Category/entry targets keep the id-derived
  // `${targetType} "${name}"` form below.
  let target: string;
  if (constraint.targetType === "force") {
    target = constraint.field === "selections" ? "army selections" : constraint.field;
  } else {
    // Prefer a resolved human name; without a resolver fall back to the raw id.
    const name = nameOf ? nameOf(constraint.targetType, constraint.targetId) : constraint.targetId;
    target = `${constraint.targetType} "${name}"`;
  }
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
