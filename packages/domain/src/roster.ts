import { z } from "zod";

// Upper bound on a single selection's count. Generous for any real game (a unit
// rarely exceeds a few dozen models) yet small enough that even deeply nested
// multipliers stay well inside Number.MAX_SAFE_INTEGER — an untrusted roster
// cannot drive effectiveCount arithmetic into Infinity/precision loss.
export const MAX_SELECTION_COUNT = 1_000_000;

export interface RosterSelection {
  id: string;
  entryId: string;
  count: number;
  selections: RosterSelection[];
}
// Input generic is `unknown` for the same reason as IrEntry: the
// `.default([])` on `selections` makes it optional in the input type.
export const RosterSelection: z.ZodType<RosterSelection, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    entryId: z.string(),
    count: z.number().int().positive().max(MAX_SELECTION_COUNT),
    selections: z.array(RosterSelection).default([]),
  }),
);

export const RosterOverride = z.object({
  constraintId: z.string(),
  selectionId: z.string().optional(),
  source: z.enum(["user", "system"]),
  reason: z.string().optional(),
});
export type RosterOverride = z.infer<typeof RosterOverride>;

export const Roster = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  catalogueId: z.string(),
  catalogueRevision: z.number().finite(),
  pointsLimit: z.number().finite(),
  selections: z.array(RosterSelection).default([]),
  overrides: z.array(RosterOverride).optional(),
});
export type Roster = z.infer<typeof Roster>;
