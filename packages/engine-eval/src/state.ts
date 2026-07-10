import type { Roster, RosterSelection, IrEntry } from "@muster/domain";
import type { SymbolTable } from "./symbols";
import { assertDepth } from "./limits";

export interface EvalNode {
  selectionId: string;
  entry: IrEntry;
  count: number;
  multiplier: number;
  effectiveCount: number;
  categories: string[];
  parent: EvalNode | null;
  children: EvalNode[];
}

export interface EvalState {
  roots: EvalNode[];
  all: EvalNode[];
}

export function buildState(roster: Roster, symbols: SymbolTable): EvalState {
  const all: EvalNode[] = [];

  const build = (
    selection: RosterSelection,
    parent: EvalNode | null,
    parentMultiplier: number,
    depth: number,
  ): EvalNode => {
    assertDepth(depth, "Roster selection");
    const entry = symbols.get(selection.entryId);
    if (!entry) {
      throw new Error(`Unknown entryId in roster: ${selection.entryId}`);
    }
    const node: EvalNode = {
      selectionId: selection.id,
      entry,
      count: selection.count,
      multiplier: parentMultiplier,
      effectiveCount: selection.count * parentMultiplier,
      categories: entry.categories,
      parent,
      children: [],
    };
    all.push(node);
    node.children = selection.selections.map((child) =>
      build(child, node, node.effectiveCount, depth + 1),
    );
    return node;
  };

  const roots = roster.selections.map((s) => build(s, null, 1, 1));
  return { roots, all };
}
