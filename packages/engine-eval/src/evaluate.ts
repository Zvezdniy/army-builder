import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { resolveCosts } from "./resolve";
import { checkConstraint } from "./constraints";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const { costOf, converged } = resolveCosts(state);
  const issues: Issue[] = [];

  const totalPoints = totalCost(state, costOf);
  if (totalPoints > roster.pointsLimit) {
    issues.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  if (!converged) {
    issues.push({
      severity: "warning",
      code: "modifiers.nonconvergent",
      message: "Cost modifiers did not reach a stable value; results may be approximate.",
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state, costOf);
    if (issue) issues.push(issue);
  }

  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state, costOf);
      if (issue) issues.push(issue);
    }
  }

  const valid = !issues.some((i) => i.severity === "error");
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues, dismissed: [], hasHouseRules: false };
}
