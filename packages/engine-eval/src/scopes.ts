import type { IrConstraint } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { nodePoints } from "./cost";

function subtree(node: EvalNode, includeChildren: boolean): EvalNode[] {
  if (!includeChildren) return [node];
  const acc: EvalNode[] = [];
  const walk = (n: EvalNode): void => {
    acc.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return acc;
}

// The candidate node set a constraint sees, before target filtering.
function scopeNodes(
  node: EvalNode | null,
  constraint: IrConstraint,
  state: EvalState,
): EvalNode[] {
  switch (constraint.scope) {
    // Walking-skeleton simplification: force and roster collapse to the same set because
    // there is currently a single implicit force per roster. Once multiple forces/detachments
    // land (see the deferred modifier plan), `force` scope must narrow to the owning force's
    // nodes rather than the whole roster.
    case "force":
    case "roster":
      return state.all;
    case "self":
      if (!node) throw new Error(`Constraint ${constraint.id} (scope=self) requires an owning node`);
      return subtree(node, constraint.includeChildSelections);
    case "parent": {
      if (!node) throw new Error(`Constraint ${constraint.id} (scope=parent) requires an owning node`);
      const anchor = node.parent ?? node;
      return subtree(anchor, constraint.includeChildSelections);
    }
  }
}

function matchesTarget(node: EvalNode, constraint: IrConstraint): boolean {
  return constraint.targetType === "category"
    ? node.categories.includes(constraint.targetId)
    : node.entry.id === constraint.targetId;
}

export function aggregate(
  node: EvalNode | null,
  constraint: IrConstraint,
  state: EvalState,
): number {
  const matched = scopeNodes(node, constraint, state).filter((n) =>
    matchesTarget(n, constraint),
  );
  if (constraint.field === "selections") {
    return matched.reduce((sum, n) => sum + n.effectiveCount, 0);
  }
  return matched.reduce((sum, n) => sum + nodePoints(n), 0);
}
