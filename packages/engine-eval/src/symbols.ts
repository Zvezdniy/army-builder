import type { IrCatalogue, IrEntry } from "@muster/domain";
import { assertDepth } from "./limits";

export type SymbolTable = Map<string, IrEntry>;

export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry, depth: number): void => {
    assertDepth(depth, "Catalogue entry");
    if (table.has(entry.id)) {
      throw new Error(`Duplicate entry id in catalogue: ${entry.id}`);
    }
    table.set(entry.id, entry);
    entry.children.forEach((child) => walk(child, depth + 1));
  };
  catalogue.entries.forEach((e) => walk(e, 1));
  return table;
}
