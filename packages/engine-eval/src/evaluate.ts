import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { resolveCosts } from "./resolve";
import { checkConstraint } from "./constraints";
import { checkGroupConstraint } from "./groups";
import { nodeHiddenByState } from "./visibility";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const { costOf, converged } = resolveCosts(state);
  const raw: Issue[] = [];

  const totalPoints = totalCost(state, costOf);
  if (totalPoints > roster.pointsLimit) {
    raw.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
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
    const issue = checkConstraint(constraint, null, state, costOf);
    if (issue) raw.push(issue);
  }
  const seenRosterGroup = new Set<string>();
  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state, costOf);
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
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues: active, dismissed, hasHouseRules };
}
