import type { IrCatalogue, IrEntry } from "@muster/domain";
import { assertDepth } from "./limits";

export type SymbolTable = Map<string, IrEntry>;

export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry, depth: number): void => {
    assertDepth(depth, "Catalogue entry");
    const existing = table.get(entry.id);
    if (existing) {
      // The parser inlines shared entries by cloning them into every referencing
      // site, so the same id legitimately reappears with a byte-identical subtree.
      // Zod normalizes key order across all IrEntry objects in a catalogue, so
      // structurally-identical clones serialize identically. First wins, and we do
      // NOT re-walk the subtree — its children are already registered under the
      // first occurrence, which also keeps traversal O(unique entries).
      if (JSON.stringify(existing) === JSON.stringify(entry)) return;
      // Two genuinely different definitions share one id: malformed input. Fail
      // loudly rather than silently pick one — preserve the never-miscompile invariant.
      throw new Error(`Duplicate entry id in catalogue: ${entry.id}`);
    }
    table.set(entry.id, entry);
    entry.children.forEach((child) => walk(child, depth + 1));
  };
  catalogue.entries.forEach((e) => walk(e, 1));
  return table;
}
