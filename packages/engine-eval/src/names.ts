import type { IrCatalogue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";

/** Resolve a constraint's target (a category or entry GUID) to a human name. */
export type TargetNamer = (targetType: string, targetId: string) => string;

/**
 * Build a namer that turns a constraint's `targetId` into a readable name:
 * category targets via the catalogue's `categoryNames`, entry targets via the
 * entry index. Falls back to the raw id when no name is known (e.g. a category
 * defined in another file), so a message is never worse than before.
 */
export function targetNamer(catalogue: IrCatalogue): TargetNamer {
  const symbols = buildSymbolTable(catalogue);
  // categoryNames is `{}` on any Zod-parsed catalogue, but guard the access so a
  // hand-built or partial catalogue (no categoryNames) degrades to the raw id
  // rather than throwing inside evaluate().
  return (targetType, targetId) =>
    targetType === "category"
      ? catalogue.categoryNames?.[targetId] ?? targetId
      : symbols.get(targetId)?.name ?? targetId;
}
