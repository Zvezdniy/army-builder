import { z } from "zod";

export const Issue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  selectionId: z.string().optional(),
  entryId: z.string().optional(),
  constraintId: z.string().optional(),
});
export type Issue = z.infer<typeof Issue>;

// A positive enumeration of an army-level legality rule and whether the current
// roster satisfies it. Unlike Issue (emitted only on violation), a check is
// present whether the rule passes or fails, so the UI can render a full
// pass/fail checklist. "points" is the single points-limit rule; "force" is one
// per applicable force-level constraint.
export const LegalityCheck = z.object({
  id: z.string(),
  kind: z.enum(["points", "force"]),
  label: z.string(),
  actual: z.number(),
  limit: z.number(),
  satisfied: z.boolean(),
  constraintType: z.enum(["min", "max"]).optional(),
});
export type LegalityCheck = z.infer<typeof LegalityCheck>;

export const ValidationResult = z.object({
  valid: z.boolean(),
  totalPoints: z.number(),
  pointsLimit: z.number(),
  issues: z.array(Issue),
  dismissed: z.array(Issue).default([]),
  hasHouseRules: z.boolean().default(false),
  checks: z.array(LegalityCheck).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResult>;
