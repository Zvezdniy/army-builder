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

export interface IrConditionGroup {
  type: "and" | "or";
  conditions?: IrCondition[];
  conditionGroups?: IrConditionGroup[];
}
// Input generic `unknown` for the recursive schema (same reason as IrEntry in plan 1).
export const IrConditionGroup: z.ZodType<IrConditionGroup, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    type: z.enum(["and", "or"]),
    conditions: z.array(IrCondition).optional(),
    conditionGroups: z.array(IrConditionGroup).optional(),
  }),
);
