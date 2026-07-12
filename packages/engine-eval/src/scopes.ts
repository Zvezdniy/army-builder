import type { EvalNode, EvalState } from "./state";
import { nodePoints, type CostFn } from "./cost";

// The shared shape aggregate() reads. Both IrConstraint and IrCondition satisfy it.
export interface AggregateSpec {
  id: string;
  field: "selections" | "points";
  scope:
    | "self"
    | "parent"
    | "force"
    | "roster"
    | "root-entry"
    | "ancestor"
    | "unit"
    | "upgrade"
    | "model"
    | "model-or-unit";
  targetType: "category" | "entry";
  targetId: string;
  includeChildSelections: boolean;
}

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

function nearestByType(node: EvalNode, pred: (t: string | undefined) => boolean): EvalNode | null {
  for (let n: EvalNode | null = node; n; n = n.parent) {
    if (pred(n.entry.type)) return n;
  }
  return null;
}

function scopeNodes(
  node: EvalNode | null,
  spec: AggregateSpec,
  state: EvalState,
): EvalNode[] {
  switch (spec.scope) {
    // Walking-skeleton simplification: force and roster collapse to the same set because
    // there is currently a single implicit force per roster. Once multiple forces/detachments
    // land, `force` scope must narrow to the owning force's nodes rather than the whole roster.
    case "force":
    case "roster":
      return state.all;
    case "self":
      if (!node) throw new Error(`Spec ${spec.id} (scope=self) requires an owning node`);
      return subtree(node, spec.includeChildSelections);
    case "parent": {
      if (!node) throw new Error(`Spec ${spec.id} (scope=parent) requires an owning node`);
      const anchor = node.parent ?? node;
      return subtree(anchor, spec.includeChildSelections);
    }
    case "root-entry": {
      if (!node) throw new Error(`Spec ${spec.id} (scope=root-entry) requires an owning node`);
      let top = node;
      while (top.parent) top = top.parent;
      return subtree(top, spec.includeChildSelections);
    }
    case "ancestor": {
      if (!node) throw new Error(`Spec ${spec.id} (scope=ancestor) requires an owning node`);
      const acc: EvalNode[] = [];
      for (let a = node.parent; a; a = a.parent) acc.push(a);
      return acc;
    }
    case "unit":
    case "upgrade":
    case "model":
    case "model-or-unit": {
      if (!node) return [];
      const pred =
        spec.scope === "model-or-unit"
          ? (t: string | undefined) => t === "model" || t === "unit"
          : (t: string | undefined) => t === spec.scope;
      const anchor = nearestByType(node, pred);
      return anchor ? subtree(anchor, spec.includeChildSelections) : [];
    }
  }
}

function matchesTarget(node: EvalNode, spec: AggregateSpec): boolean {
  return spec.targetType === "category"
    ? node.categories.includes(spec.targetId)
    : node.entry.id === spec.targetId;
}

export function aggregate(
  node: EvalNode | null,
  spec: AggregateSpec,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  const matched = scopeNodes(node, spec, state).filter((n) => matchesTarget(n, spec));
  if (spec.field === "selections") {
    return matched.reduce((sum, n) => sum + n.effectiveCount, 0);
  }
  return matched.reduce((sum, n) => sum + costOf(n), 0);
}
