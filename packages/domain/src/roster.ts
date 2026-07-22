import { z } from "zod";

// Upper bound on a single selection's count. Generous for any real game (a unit
// rarely exceeds a few dozen models) yet small enough that even deeply nested
// multipliers stay well inside Number.MAX_SAFE_INTEGER — an untrusted roster
// cannot drive effectiveCount arithmetic into Infinity/precision loss.
export const MAX_SELECTION_COUNT = 1_000_000;

export interface RosterSelection {
  id: string;
  entryId: string;
  count: number;
  selections: RosterSelection[];
  attachedTo?: string;
}
// Input generic is `unknown` for the same reason as IrEntry: the
// `.default([])` on `selections` makes it optional in the input type.
export const RosterSelection: z.ZodType<RosterSelection, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    entryId: z.string(),
    count: z.number().int().positive().max(MAX_SELECTION_COUNT),
    selections: z.array(RosterSelection).default([]),
    attachedTo: z.string().optional(),
  }),
);

export const RosterOverride = z.object({
  constraintId: z.string(),
  selectionId: z.string().optional(),
  source: z.enum(["user", "system"]),
  reason: z.string().optional(),
});
export type RosterOverride = z.infer<typeof RosterOverride>;

export const Roster = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  catalogueId: z.string(),
  catalogueRevision: z.number().finite(),
  pointsLimit: z.number().finite(),
  selections: z.array(RosterSelection).default([]),
  overrides: z.array(RosterOverride).optional(),
  // The selection id of the unit designated Warlord (a top-level character). Optional
  // and player-set; cleared automatically when that unit is removed. Absent on rosters
  // saved before this field existed — treated as "no warlord chosen".
  warlordId: z.string().optional(),
});
export type Roster = z.infer<typeof Roster>;

/** File format for a single exported roster. `schema` is a version gate the
 *  importer checks before trusting the payload. `edition` is required because
 *  10e/11e catalogue ids collide — it is not on `Roster`. */
export const ROSTER_ENVELOPE_SCHEMA = "muster-roster/v1";
export const RosterEnvelope = z.object({
  schema: z.literal(ROSTER_ENVELOPE_SCHEMA),
  edition: z.string(),
  catalogueId: z.string(),
  roster: Roster,
});
export type RosterEnvelope = z.infer<typeof RosterEnvelope>;

/** One saved roster plus denormalized display fields, so the library list
 *  renders without loading each catalogue. `id === roster.id`. */
export const LibraryEntry = z.object({
  id: z.string(),
  name: z.string(),
  edition: z.string(),
  catalogueId: z.string(),
  catalogueName: z.string(),
  points: z.number().finite(),
  updatedAt: z.number().finite(),
  roster: Roster,
});
export type LibraryEntry = z.infer<typeof LibraryEntry>;

/** The whole persisted library. `activeId` is the last-edited entry restored
 *  on app open. */
export const LIBRARY_VERSION = 1;
export const RosterLibrary = z.object({
  version: z.literal(LIBRARY_VERSION),
  activeId: z.string().nullable(),
  entries: z.array(LibraryEntry).default([]),
});
export type RosterLibrary = z.infer<typeof RosterLibrary>;
