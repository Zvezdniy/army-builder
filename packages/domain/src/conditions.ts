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
  value: z.number().finite(),
  field: z.enum(["selections", "points", "forces"]),
  // Either a keyword scope — self | parent | force | roster | root-entry | ancestor |
  // unit | upgrade | model | model-or-unit — or a foreign-id scope: the entry id of an
  // ancestor-or-self node ("count within that entry's subtree"). engine-eval resolves the
  // latter against the node's ancestor chain.
  scope: z.string(),
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
