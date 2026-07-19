import { z } from "zod";
import { IrModifier } from "./modifiers";
import { VisibilityModifier } from "./visibility";
import { IrValidationRule } from "./validation-rules";
import { IrCategoryModifier } from "./category-modifiers";

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
  // "selections" (count), "points", or a cost-type name (e.g. "Enhancements") —
  // sums that named cost across the constraint's scope. Widened from a two-value
  // enum because a force-global constraint (targetType "force") can target any
  // cost type the catalogue defines, not just points; an unrecognized/absent name
  // aggregates to 0 (inert), never throws.
  field: z.string(),
  scope: z.enum(["self", "parent", "force", "roster", "root-entry", "ancestor", "unit", "upgrade", "model", "model-or-unit"]),
  // "force": matches every node in the roster (no category/entry filter) — used
  // for whole-force rules like 11e's "max 2 Enhancements".
  targetType: z.enum(["category", "entry", "force"]),
  targetId: z.string(),
  includeChildSelections: z.boolean().default(false),
  modifiers: z.array(IrModifier).optional(),
});
export type IrConstraint = z.infer<typeof IrConstraint>;

export const IrGroupConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
  scope: z.enum(["self", "roster"]).default("self"),
  modifiers: z.array(IrModifier).optional(),
});
export type IrGroupConstraint = z.infer<typeof IrGroupConstraint>;

export const IrGroup = z.object({
  id: z.string(),
  name: z.string(),
  defaultMemberEntryId: z.string().optional(),
  // Direct entry members of this group only — used for UI grouping, default
  // seeding, and per-member editing.
  memberEntryIds: z.array(z.string()).default([]),
  // Transitive closure of member entry ids across this group AND all nested
  // sub-groups (⊇ memberEntryIds). This is the set a group's `selections`
  // constraint counts: BattleScribe aggregates a group limit over the group's
  // whole subtree, so an outer group whose real members live in sub-groups
  // (e.g. "Enhancements: max 3 per army", its options nested per-detachment)
  // must count those descendants, not just its (often empty) direct members.
  // Optional (not defaulted like memberEntryIds) because it is a backward-
  // compatible addition: pre-descendant packed IR omits it, and the engine
  // then falls back to memberEntryIds. The parser always emits it.
  descendantEntryIds: z.array(z.string()).optional(),
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
  // Ability grouping ("Core", "Faction", …): collapsed abilities render as one
  // compact line per group; ungrouped abilities render as name + description.
  group: z.string().optional(),
});
export type IrProfile = z.infer<typeof IrProfile>;

// Recursive type declared explicitly so the Zod lazy schema can annotate itself.
export interface IrEntry {
  id: string;
  name: string;
  type?: "unit" | "upgrade" | "model";
  costs: IrCost[];
  categories: string[];
  constraints: IrConstraint[];
  children: IrEntry[];
  groups?: IrGroup[];
  profiles?: IrProfile[];
  hidden?: boolean;
  visibilityModifiers?: VisibilityModifier[];
  validationRules?: IrValidationRule[];
  categoryModifiers?: IrCategoryModifier[];
}
// Use `unknown` for the input generic because `.default([])` makes those fields optional in input,
// not matching the strict required-field interface. Output type stays `IrEntry`.
export const IrEntry: z.ZodType<IrEntry, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["unit", "upgrade", "model"]).optional(),
    costs: z.array(IrCost).default([]),
    categories: z.array(z.string()).default([]),
    constraints: z.array(IrConstraint).default([]),
    children: z.array(IrEntry).default([]),
    groups: z.array(IrGroup).default([]),
    profiles: z.array(IrProfile).default([]),
    hidden: z.boolean().default(false),
    visibilityModifiers: z.array(VisibilityModifier).default([]),
    validationRules: z.array(IrValidationRule).default([]),
    categoryModifiers: z.array(IrCategoryModifier).default([]),
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
