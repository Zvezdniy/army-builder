import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A `set hidden = <set>` gate: hidden becomes `set` when the conditions pass.
// Emitted by the parser only when every condition maps (never over-hide).
export const VisibilityModifier = z.object({
  set: z.boolean(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type VisibilityModifier = z.infer<typeof VisibilityModifier>;
