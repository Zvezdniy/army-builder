import type { EvalNode, EvalState } from "./state";
import { passesGate } from "./conditions";

// The effective category set of a node = its static categories plus any
// conditionally-added categories (gate passes) minus any conditionally-removed
// ones. Gates are evaluated on the real node against the current state.
export function effectiveCategories(node: EvalNode, state: EvalState): string[] {
  const set = new Set(node.entry.categories);
  for (const cm of node.entry.categoryModifiers ?? []) {
    if (!passesGate(cm.conditions, cm.conditionGroups, node, state)) continue;
    if (cm.type === "add") set.add(cm.categoryId);
    else set.delete(cm.categoryId);
  }
  return [...set];
}

// Resolve every node's effective membership into node.categories. Two-phase
// (compute all, then assign) so each gate reads static membership uniformly and
// the result is independent of node order. Assigns a NEW array — entry.categories
// (shared across inlined duplicates) is never mutated.
export function resolveCategories(state: EvalState): void {
  const computed = state.all.map((n) => effectiveCategories(n, state));
  state.all.forEach((n, i) => {
    n.categories = computed[i]!;
  });
}
