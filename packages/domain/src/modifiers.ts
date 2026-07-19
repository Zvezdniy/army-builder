import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

export const IrModifier = z.object({
  id: z.string(),
  type: z.enum(["set", "increment", "decrement", "divide", "multiply"]),
  value: z.number().finite(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrModifier = z.infer<typeof IrModifier>;
