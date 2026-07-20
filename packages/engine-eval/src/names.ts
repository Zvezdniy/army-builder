import type { IrCatalogue, IrConstraint } from "@muster/domain";
import { buildSymbolTable } from "./symbols";

/** Resolve a constraint's target (a category or entry GUID) to a human name. */
export type TargetNamer = (targetType: "category" | "entry" | "force", targetId: string) => string;

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

/**
 * The human-facing subject of a constraint, for both the violation message and
 * the legality checklist label — one place, so the two can never drift.
 *
 * A force-target constraint sums over the whole force with no category/entry
 * filter, and its `targetId` is the forceEntry's raw GUID: every force
 * constraint in a catalogue shares it, so `force "bb9d-299a-ed60-2d8a"` names
 * nothing and makes the Detachment Points and Enhancements rows identical. The
 * subject actually being counted is `field` — a cost-type name ("Enhancements",
 * "Detachment Points") or "selections" for a plain army-wide count.
 */
export function constraintTargetLabel(
  constraint: Pick<IrConstraint, "targetType" | "targetId" | "field">,
  nameOf?: TargetNamer,
): string {
  if (constraint.targetType === "force") {
    return constraint.field === "selections" ? "army selections" : constraint.field;
  }
  // Prefer a resolved human name; without a resolver fall back to the raw id.
  const name = nameOf ? nameOf(constraint.targetType, constraint.targetId) : constraint.targetId;
  return `${constraint.targetType} "${name}"`;
}
