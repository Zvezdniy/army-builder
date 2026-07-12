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

const ANCHOR_TYPE_SCOPES = new Set(["unit", "upgrade", "model", "model-or-unit"]);

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
    // Node-relative scopes resolve to nothing without an owning node. This happens
    // only at force level (evaluate checks forceConstraints with node === null),
    // where a node-relative scope — on the constraint or on a modifier's condition
    // gate — is meaningless. Returning [] (never throwing) keeps evaluate() robust
    // against adversarial catalogues instead of aborting the whole validation.
    case "self":
      if (!node) return [];
      return subtree(node, spec.includeChildSelections);
    case "parent": {
      if (!node) return [];
      const anchor = node.parent ?? node;
      return subtree(anchor, spec.includeChildSelections);
    }
    case "root-entry": {
      if (!node) return [];
      let top = node;
      while (top.parent) top = top.parent;
      return subtree(top, spec.includeChildSelections);
    }
    case "ancestor": {
      if (!node) return [];
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

// True only when a type scope (unit/upgrade/model/model-or-unit) resolves to no
// node — the owning node has no ancestor of that type, so the scope cannot be
// anchored and the spec does not apply here. Non-type scopes are never "unanchored"
// (their empty result is legitimate, e.g. a roster-wide min on an empty roster).
export function scopeUnanchored(node: EvalNode | null, spec: AggregateSpec, state: EvalState): boolean {
  if (!ANCHOR_TYPE_SCOPES.has(spec.scope)) return false;
  return scopeNodes(node, spec, state).length === 0;
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
