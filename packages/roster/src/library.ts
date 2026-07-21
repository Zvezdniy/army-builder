import {
  RosterLibrary, RosterEnvelope, ROSTER_ENVELOPE_SCHEMA, LIBRARY_VERSION,
  LibraryEntry,
  type Roster, type LibraryEntry as LibraryEntryType,
} from "@muster/domain";

/** Non-roster fields needed to build a library entry (the app knows these from
 *  the active catalogue descriptor). */
export type EntryMeta = { edition: string; catalogueId: string; catalogueName: string };

export function emptyLibrary(): RosterLibrary {
  return { version: LIBRARY_VERSION, activeId: null, entries: [] };
}

function toEntry(roster: Roster, meta: EntryMeta, now: number): LibraryEntryType {
  return {
    id: roster.id, name: roster.name, edition: meta.edition,
    catalogueId: meta.catalogueId, catalogueName: meta.catalogueName,
    points: roster.pointsLimit, updatedAt: now, roster,
  };
}

/** Insert-or-replace the entry whose id === roster.id and make it active. This
 *  is the auto-save primitive. */
export function upsertActive(lib: RosterLibrary, roster: Roster, meta: EntryMeta, now: number): RosterLibrary {
  const entry = toEntry(roster, meta, now);
  const rest = lib.entries.filter((e) => e.id !== roster.id);
  return { ...lib, activeId: roster.id, entries: [...rest, entry] };
}

/** Refresh an EXISTING entry's content from an edited roster (name/points/roster +
 *  updatedAt), leaving edition/catalogueId/catalogueName and activeId untouched.
 *  No-op (returns the same library) if roster.id is not already tracked — so autosave
 *  can never insert or re-activate a roster the library doesn't own (a throwaway
 *  default after a failed restore, or one the user just deleted). */
export function updateEntry(lib: RosterLibrary, roster: Roster, now: number): RosterLibrary {
  if (!lib.entries.some((e) => e.id === roster.id)) return lib;
  return {
    ...lib,
    entries: lib.entries.map((e) =>
      e.id === roster.id ? { ...e, name: roster.name, points: roster.pointsLimit, updatedAt: now, roster } : e),
  };
}

export function renameEntry(lib: RosterLibrary, id: string, name: string, now: number): RosterLibrary {
  return {
    ...lib,
    entries: lib.entries.map((e) =>
      e.id === id ? { ...e, name, updatedAt: now, roster: { ...e.roster, name } } : e),
  };
}

export function duplicateEntry(lib: RosterLibrary, id: string, newId: string, now: number): RosterLibrary {
  const src = lib.entries.find((e) => e.id === id);
  if (!src) return lib;
  const roster: Roster = structuredClone({ ...src.roster, id: newId, name: `${src.roster.name} (copy)` });
  const copy: LibraryEntryType = { ...src, id: newId, name: roster.name, updatedAt: now, roster };
  return { ...lib, activeId: newId, entries: [...lib.entries, copy] };
}

export function deleteEntry(lib: RosterLibrary, id: string): RosterLibrary {
  return {
    ...lib,
    activeId: lib.activeId === id ? null : lib.activeId,
    entries: lib.entries.filter((e) => e.id !== id),
  };
}

export function setActive(lib: RosterLibrary, id: string): RosterLibrary {
  return { ...lib, activeId: id };
}

export function activeEntry(lib: RosterLibrary): LibraryEntryType | undefined {
  return lib.activeId === null ? undefined : lib.entries.find((e) => e.id === lib.activeId);
}

/** Zod-validate a stored blob; drop entries that fail validation so one corrupt
 *  roster never bricks the library, and return an empty library for a wholly
 *  invalid blob. */
export function parseLibrary(raw: unknown): RosterLibrary {
  const outer = RosterLibrary.safeParse(raw);
  if (outer.success) return outer.data;
  if (raw && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)) {
    const entries = ((raw as { entries: unknown[] }).entries)
      .map((e) => LibraryEntry.safeParse(e))
      .filter((r) => r.success)
      .map((r) => (r as { data: LibraryEntryType }).data);
    const activeIdRaw = (raw as { activeId?: unknown }).activeId;
    const activeId = typeof activeIdRaw === "string" && entries.some((e) => e.id === activeIdRaw) ? activeIdRaw : null;
    return { version: LIBRARY_VERSION, activeId, entries };
  }
  return emptyLibrary();
}

export function toEnvelope(roster: Roster, edition: string, catalogueId: string): RosterEnvelope {
  return { schema: ROSTER_ENVELOPE_SCHEMA, edition, catalogueId, roster };
}

export function fromEnvelope(raw: unknown): { roster: Roster; edition: string; catalogueId: string } {
  const env = RosterEnvelope.parse(raw); // throws on wrong schema / shape
  return { roster: env.roster, edition: env.edition, catalogueId: env.catalogueId };
}
