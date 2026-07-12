import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A designer-authored validation rule (BattleScribe `field="error"` modifier):
// when the conditions pass, the selection is invalid with `message`. Emitted by
// the parser only when every condition maps (never over-enforce / falsely reject).
export const IrValidationRule = z.object({
  message: z.string(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrValidationRule = z.infer<typeof IrValidationRule>;
