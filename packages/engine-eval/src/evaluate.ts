import type { Roster, IrCatalogue, ValidationResult, Issue, LegalityCheck } from "@muster/domain";
import { buildState } from "./state";
import { resolveCategories } from "./categories";
import { totalCost } from "./cost";
import { resolveCosts } from "./resolve";
import { checkConstraint, describeConstraint } from "./constraints";
import { checkGroupConstraint } from "./groups";
import { targetNamer } from "./names";
import { nodeHiddenByState } from "./visibility";
import { validationIssues } from "./validation";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const state = buildState(roster, catalogue);
  resolveCategories(state);
  const { costOf, converged } = resolveCosts(state);
  const nameOf = targetNamer(catalogue);
  const raw: Issue[] = [];

  const totalPoints = totalCost(state, costOf);
  if (totalPoints > roster.pointsLimit) {
    raw.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  // Positive enumeration of army-level rules for the legality checklist: the
  // points limit, then one entry per applicable force-level constraint. This is
  // additive reporting — it never feeds `valid` (that stays driven by `issues`).
  // Built from raw rule state here; reconciled against house-rule overrides once
  // the issue split is known (see `reconciledChecks` below).
  const checks: LegalityCheck[] = [
    {
      id: "points",
      kind: "points",
      label: "Points",
      actual: totalPoints,
      limit: roster.pointsLimit,
      satisfied: totalPoints <= roster.pointsLimit,
    },
  ];
  for (const constraint of catalogue.forceConstraints) {
    const described = describeConstraint(constraint, null, state, costOf);
    if (!described) continue;
    const target = `${constraint.targetType} "${nameOf(constraint.targetType, constraint.targetId)}"`;
    const label =
      constraint.type === "min"
        ? `At least ${described.limit} ${target}`
        : `At most ${described.limit} ${target}`;
    checks.push({
      id: constraint.id,
      kind: "force",
      label,
      actual: described.actual,
      limit: described.limit,
      satisfied: described.satisfied,
      constraintType: constraint.type,
    });
  }

  // When the cost fixed-point did not converge (oscillating modifiers), totalPoints and
  // valid are a deterministic-but-arbitrary snapshot of the final iteration; the warning
  // below signals consumers to treat them as approximate.
  if (!converged) {
    raw.push({
      severity: "warning",
      code: "modifiers.nonconvergent",
      message: "Cost modifiers did not reach a stable value; results may be approximate.",
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state, costOf, nameOf);
    if (issue) raw.push(issue);
  }
  const seenRosterGroup = new Set<string>();
  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state, costOf, nameOf);
      if (issue) raw.push(issue);
    }
    for (const group of node.entry.groups ?? []) {
      for (const gc of group.constraints) {
        if (gc.scope === "roster") {
          // A shared group is inlined at N placements; a roster-wide limit is one
          // army rule, so evaluate it once. The member set is part of the key so
          // that two placements which somehow carry the same group+constraint id
          // with DIVERGENT members are both evaluated rather than one silently
          // dropped (mirrors symbols.ts's refusal to collapse divergent ids).
          const key = `${group.id}:${gc.id}:${[...group.memberEntryIds].sort().join(",")}`;
          if (seenRosterGroup.has(key)) continue;
          seenRosterGroup.add(key);
        }
        const issue = checkGroupConstraint(gc, node, group, state);
        if (issue) raw.push(issue);
      }
    }
    if (nodeHiddenByState(node, state)) {
      raw.push({
        severity: "warning",
        code: "selection.hidden",
        selectionId: node.selectionId,
        entryId: node.entry.id,
        message: `${node.entry.name} is not available in the current army configuration`,
      });
    }
    raw.push(...validationIssues(node, state));
  }

  const overrides = roster.overrides ?? [];
  const matchingOverride = (issue: Issue) =>
    issue.constraintId === undefined
      ? undefined
      : overrides.find(
          (o) =>
            o.constraintId === issue.constraintId &&
            (o.selectionId === undefined || o.selectionId === issue.selectionId),
        );

  const dismissed: Issue[] = [];
  const active: Issue[] = [];
  for (const issue of raw) {
    if (matchingOverride(issue)) dismissed.push(issue);
    else active.push(issue);
  }

  const hasHouseRules = dismissed.some((d) => matchingOverride(d)?.source === "user");
  const valid = !active.some((i) => i.severity === "error");

  // Reconcile the checklist with house-rule overrides: a failing force check whose
  // paired violation was dismissed is marked `dismissed` (house-ruled) rather than a
  // hard failure, so the checklist never shows a red ✗ while the verdict is LEGAL.
  // Invariant restored: a force check is a hard failure (satisfied=false, not dismissed)
  // iff its constraint has an active issue in `active`.
  const dismissedConstraintIds = new Set(
    dismissed.map((d) => d.constraintId).filter((id): id is string => id !== undefined),
  );
  const reconciledChecks = checks.map((c) =>
    c.kind === "force" && !c.satisfied && dismissedConstraintIds.has(c.id)
      ? { ...c, dismissed: true }
      : c,
  );

  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues: active, dismissed, hasHouseRules, checks: reconciledChecks };
}
