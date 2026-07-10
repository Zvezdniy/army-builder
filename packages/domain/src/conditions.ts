import { z } from "zod";

export const IrCondition = z.object({
  id: z.string(),
  comparator: z.enum([
    "atLeast",
    "atMost",
    "equalTo",
    "notEqualTo",
    "greaterThan",
    "lessThan",
  ]),
  value: z.number(),
  field: z.enum(["selections", "points"]),
  scope: z.enum(["self", "parent", "force", "roster"]),
  targetType: z.enum(["category", "entry"]),
  targetId: z.string(),
  includeChildSelections: z.boolean().default(false),
});
export type IrCondition = z.infer<typeof IrCondition>;
