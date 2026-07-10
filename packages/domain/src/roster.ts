import { z } from "zod";

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
    count: z.number().int().positive(),
    selections: z.array(RosterSelection).default([]),
  }),
);

export const Roster = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  catalogueId: z.string(),
  catalogueRevision: z.number(),
  pointsLimit: z.number(),
  selections: z.array(RosterSelection).default([]),
});
export type Roster = z.infer<typeof Roster>;
