import type { IrConstraint } from "@muster/domain";

// The 11e cost type a detachment (and an enhancement) is priced in; the verbatim
// BSData name. Exported so every consumer (this correction, the web meter, …)
// names it once instead of each carrying its own copy of the literal that could
// silently drift out of sync.
export const DETACHMENT_POINTS = "Detachment Points";

// Upstream-data correction, isolated (sub-project D, task D2).
//
// BSData's 11th-edition game system (revision 4) publishes a force-wide
// "Detachment Points" cap of 2 — but the Gladius Task Force detachment alone
// costs 3 Detachment Points. As published, no 3-DP detachment could ever be
// legal, which is not the real rule. The project owner confirmed the actual
// cap is 3.
//
// This is the ONLY rules override in the engine (see the plan's Global
// Constraints: "Rules overrides live ONLY in
// packages/engine-eval/src/data-corrections.ts. No override may be scattered
// elsewhere."). It must only ever RAISE a Detachment Points cap, never lower
// one, so it can't turn a legal army illegal or hide a real upstream
// tightening — it takes the cap from the data and floors it at 3.
//
// DELETE THIS FILE (and its call site in constraints.ts) once BSData
// publishes a Detachment Points cap of 3 or higher.
export function correctedConstraintValue(constraint: IrConstraint): number {
  if (
    constraint.field !== DETACHMENT_POINTS ||
    constraint.targetType !== "force" ||
    constraint.type !== "max"
  ) {
    return constraint.value;
  }
  return Math.max(constraint.value, 3);
}
