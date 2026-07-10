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

export const ValidationResult = z.object({
  valid: z.boolean(),
  totalPoints: z.number(),
  pointsLimit: z.number(),
  issues: z.array(Issue),
});
export type ValidationResult = z.infer<typeof ValidationResult>;
