import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A numeric characteristic (statline/weapon-profile stat) modifier, captured
// faithfully on the OWNING entry with an UNRESOLVED target spec — the parser
// does not walk the tree to find the profile(s) this changes; engine-eval
// resolves `targetScope`/`targetEntryId`/`recursive`/`profileType` lazily
// against the live roster (see docs/superpowers/specs/
// 2026-07-20-11e-display-characteristic-modifiers-design.md §1/§3).
//
// Only `set`/`increment`/`decrement` are represented — the only kinds that
// need real numeric semantics on a characteristic (see the design doc's
// findings). `append`/`replace`/`floor`/`ceil` on characteristics are not
// captured by this channel and stay dropped (`modifier.value_type_unsupported`
// / `modifier.target_unmapped`), unchanged from before this type existed.
export const IrCharacteristicModifier = z.object({
  // Characteristic name (e.g. "Sv", "T", "M", "S", "A") — decoded from the
  // BattleScribe characteristicType id via the catalogue/gamesystem
  // profileTypes→characteristicTypes map.
  characteristic: z.string(),
  // The profile typeName the target profile must have ("Unit" | "Melee
  // Weapons" | "Ranged Weapons" | ...) — parsed from the `affects` path.
  profileType: z.string(),
  kind: z.enum(["set", "increment", "decrement"]),
  // Characteristics are display strings in the IR ("2+", "10\"", "1"), so the
  // modifier's value is captured as the same kind of string, not a number.
  value: z.string(),
  // Reuses IrCondition's scope vocabulary: self | parent | force | roster |
  // root-entry | ancestor | unit | upgrade | model | model-or-unit, or a
  // foreign-id scope.
  targetScope: z.string(),
  // Optional: restrict the resolved subtree to one specific descendant entry
  // id (parsed out of the `affects` path when present).
  targetEntryId: z.string().optional(),
  // Whether the target is the anchor's whole subtree (true) or its direct
  // children only (false) — only meaningful when the `affects` path reaches
  // into descendant entries at all; see the parser's affects-path parsing.
  recursive: z.boolean(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrCharacteristicModifier = z.infer<typeof IrCharacteristicModifier>;
