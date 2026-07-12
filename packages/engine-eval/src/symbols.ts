import type { IrCatalogue, IrEntry } from "@muster/domain";
import { assertDepth } from "./limits";

export type SymbolTable = Map<string, IrEntry>;

// A flat id -> entry index over the catalogue tree. The parser inlines shared
// entries by cloning them into every referencing site, so the same id legitimately
// reappears — and, since per-placement modifiers now make those clones diverge, the
// clones are NOT byte-identical. This index is deliberately tolerant: first
// occurrence wins on any collision and its subtree is walked once (keeping traversal
// O(unique ids)); it never throws. It is used as buildState's fallback resolver and
// for iterating the catalogue's unique entries (hiddenEntryIds). Correct per-placement
// resolution is the caller's job (buildState walks the tree by parent context).
export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry, depth: number): void => {
    assertDepth(depth, "Catalogue entry");
    if (table.has(entry.id)) return; // first wins; do not re-walk the subtree
    table.set(entry.id, entry);
    entry.children.forEach((child) => walk(child, depth + 1));
  };
  catalogue.entries.forEach((e) => walk(e, 1));
  return table;
}
