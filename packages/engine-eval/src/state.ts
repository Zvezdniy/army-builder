import type { Roster, RosterSelection, IrEntry, IrCatalogue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
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

// Resolve each roster selection against the catalogue TREE: a child resolves
// among its parent's children (root selections among catalogue.entries), so the
// per-placement inlined instance (with its own modifiers) is used. The tolerant
// flat index is a fallback for a selection not found under its parent (e.g. a
// roster built against a slightly different catalogue); an id in neither is unknown.
export function buildState(roster: Roster, catalogue: IrCatalogue): EvalState {
  const flat = buildSymbolTable(catalogue);
  const all: EvalNode[] = [];

  const resolve = (parentEntry: IrEntry | null, entryId: string): IrEntry => {
    const siblings = parentEntry ? parentEntry.children : catalogue.entries;
    // NOTE: Per-placement clones under DISTINCT parents resolve correctly (each parent's own child).
    // If two divergent same-id entries are SIBLINGS under the SAME parent, find() returns the first;
    // the roster selection carries only entryId and cannot disambiguate them → the second is unaddressable
    // by construction. This is an accepted format limitation (before per-placement, such a catalogue would crash).
    const local = siblings.find((e) => e.id === entryId);
    if (local) return local;
    const fallback = flat.get(entryId);
    if (fallback) return fallback;
    throw new Error(`Unknown entryId in roster: ${entryId}`);
  };

  const build = (
    selection: RosterSelection,
    parent: EvalNode | null,
    parentMultiplier: number,
    depth: number,
  ): EvalNode => {
    assertDepth(depth, "Roster selection");
    const entry = resolve(parent ? parent.entry : null, selection.entryId);
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
