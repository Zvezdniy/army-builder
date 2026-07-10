import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { checkConstraint } from "./constraints";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const issues: Issue[] = [];

  const totalPoints = totalCost(state);
  if (totalPoints > roster.pointsLimit) {
    issues.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state);
    if (issue) issues.push(issue);
  }

  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state);
      if (issue) issues.push(issue);
    }
  }

  const valid = !issues.some((i) => i.severity === "error");
  // Stopgap: ValidationResult (Task 4) now requires these; Task 11/12 compute them
  // properly (override/house-rules layer). Kept as defaults so the package typechecks.
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues, dismissed: [], hasHouseRules: false };
}
