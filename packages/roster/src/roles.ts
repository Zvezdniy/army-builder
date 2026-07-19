import type { IrCatalogue, IrEntry } from "@muster/domain";

/** Battlefield-role buckets in army-list display order. A unit is placed in the
 *  FIRST of these it belongs to, so the meaningful role wins over incidental
 *  keywords: a Battleline Infantry unit is "Battleline"; a named character that
 *  is also Infantry is "Epic Hero". Anything with none of these → "Other". */
// Specific keywords come BEFORE the generic ones they overlap with (a Rhino is
// both Dedicated Transport and Vehicle; an aircraft is both Aircraft and Vehicle),
// so the more meaningful role wins the first-match in `battlefieldRole`.
export const ROLE_ORDER = [
  "Epic Hero",
  "Character",
  "HQ", // classic FOC roles (HQ/Troops/…) are also recognised for legacy catalogues
  "Battleline",
  "Troops",
  "Elites",
  "Infantry",
  "Mounted",
  "Beast",
  "Swarm",
  "Monster",
  "Walker",
  "Aircraft",
  "Flyer",
  "Titanic",
  "Fast Attack",
  "Heavy Support",
  "Lord of War",
  "Dedicated Transport",
  "Fortification",
  "Artillery",
  "Vehicle",
] as const;

/** The bucket shown after all known roles. */
export const OTHER_ROLE = "Other";

/** The battlefield role a unit is grouped under, resolved from its category
 *  names (via `catalogue.categoryNames`). Returns the first `ROLE_ORDER` role the
 *  entry carries, else `OTHER_ROLE` — grouping by a real role instead of the
 *  entry's incidental first category (usually a faction keyword). */
export function battlefieldRole(entry: IrEntry, catalogue: IrCatalogue): string {
  const names = new Set(entry.categories.map((id) => catalogue.categoryNames?.[id] ?? id));
  for (const role of ROLE_ORDER) if (names.has(role)) return role;
  return OTHER_ROLE;
}

/** Sort rank for a role name: its index in `ROLE_ORDER`, with `OTHER_ROLE` (and
 *  any unknown role) sorted last. */
export function roleRank(role: string): number {
  const i = (ROLE_ORDER as readonly string[]).indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}
