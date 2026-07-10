import type { IrCatalogue, IrEntry } from "@muster/domain";

export type SymbolTable = Map<string, IrEntry>;

export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry): void => {
    if (table.has(entry.id)) {
      throw new Error(`Duplicate entry id in catalogue: ${entry.id}`);
    }
    table.set(entry.id, entry);
    entry.children.forEach(walk);
  };
  catalogue.entries.forEach(walk);
  return table;
}
