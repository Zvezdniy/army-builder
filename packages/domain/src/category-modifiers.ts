import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A conditional category-membership change (BattleScribe `field="category"`
// modifier): when the conditions pass, the entry gains (`add`) or loses
// (`remove`) `categoryId`. Emitted by the parser only when every condition maps.
export const IrCategoryModifier = z.object({
  type: z.enum(["add", "remove"]),
  categoryId: z.string(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrCategoryModifier = z.infer<typeof IrCategoryModifier>;
