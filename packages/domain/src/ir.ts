import { z } from "zod";
import { IrModifier } from "./modifiers";

export const IrCost = z.object({
  name: z.string(),
  value: z.number().finite(),
  modifiers: z.array(IrModifier).optional(),
});
export type IrCost = z.infer<typeof IrCost>;

export const IrConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
  field: z.enum(["selections", "points"]),
  scope: z.enum(["self", "parent", "force", "roster"]),
  targetType: z.enum(["category", "entry"]),
  targetId: z.string(),
  includeChildSelections: z.boolean().default(false),
  modifiers: z.array(IrModifier).optional(),
});
export type IrConstraint = z.infer<typeof IrConstraint>;

export const IrGroupConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
});
export type IrGroupConstraint = z.infer<typeof IrGroupConstraint>;

export const IrGroup = z.object({
  id: z.string(),
  name: z.string(),
  defaultMemberEntryId: z.string().optional(),
  memberEntryIds: z.array(z.string()).default([]),
  constraints: z.array(IrGroupConstraint).default([]),
});
export type IrGroup = z.infer<typeof IrGroup>;

export const IrCharacteristic = z.object({ name: z.string(), value: z.string() });
export type IrCharacteristic = z.infer<typeof IrCharacteristic>;

export const IrProfile = z.object({
  name: z.string(),
  typeName: z.string(),
  characteristics: z.array(IrCharacteristic).default([]),
  keywords: z.array(z.string()).optional(),
});
export type IrProfile = z.infer<typeof IrProfile>;

// Recursive type declared explicitly so the Zod lazy schema can annotate itself.
export interface IrEntry {
  id: string;
  name: string;
  costs: IrCost[];
  categories: string[];
  constraints: IrConstraint[];
  children: IrEntry[];
  groups?: IrGroup[];
  profiles?: IrProfile[];
}
// Use `unknown` for the input generic because `.default([])` makes those fields optional in input,
// not matching the strict required-field interface. Output type stays `IrEntry`.
export const IrEntry: z.ZodType<IrEntry, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    costs: z.array(IrCost).default([]),
    categories: z.array(z.string()).default([]),
    constraints: z.array(IrConstraint).default([]),
    children: z.array(IrEntry).default([]),
    groups: z.array(IrGroup).default([]),
    profiles: z.array(IrProfile).default([]),
  }),
);

export const IrCatalogue = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  revision: z.number().finite(),
  entries: z.array(IrEntry),
  forceConstraints: z.array(IrConstraint).default([]),
  categoryNames: z.record(z.string()).default({}),
  ruleTexts: z.record(z.string()).optional(),
});
export type IrCatalogue = z.infer<typeof IrCatalogue>;
