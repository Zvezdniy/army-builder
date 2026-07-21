import { z } from "zod";

// One stratagem, matching the S-A pipeline's output shape exactly.
export const Stratagem = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  cpCost: z.number().finite(),
  turn: z.string(),
  phase: z.string(),
  detachment: z.string(),
  detachmentId: z.string(),
  legend: z.string(),
  description: z.string(),
});
export type Stratagem = z.infer<typeof Stratagem>;

// A per-faction or the core stratagem file.
export const StratagemFile = z.object({
  source: z.string(),
  kind: z.enum(["core", "faction"]),
  wahapediaFactionId: z.string().optional(),
  stratagems: z.array(Stratagem),
});
export type StratagemFile = z.infer<typeof StratagemFile>;

// The manifest listing the core file + one entry per catalogue slug.
export const StratagemManifest = z.object({
  version: z.number().finite(),
  source: z.string(),
  attribution: z.string(),
  core: z.object({ file: z.string(), count: z.number().finite() }),
  factions: z.array(z.object({
    slug: z.string(),
    wahapediaFactionId: z.string(),
    file: z.string(),
    count: z.number().finite(),
  })),
});
export type StratagemManifest = z.infer<typeof StratagemManifest>;

/** Parse-or-throw a stratagem file (core or faction), like `loadCatalogue`. */
export function loadStratagemFile(raw: unknown): StratagemFile {
  return StratagemFile.parse(raw);
}

/** Parse-or-throw the stratagem manifest. */
export function loadStratagemManifest(raw: unknown): StratagemManifest {
  return StratagemManifest.parse(raw);
}

/** The stratagem file serving a faction slug, or undefined if the slug is absent
 *  from the manifest (caller then treats the faction as core-only). */
export function stratagemFileForSlug(manifest: StratagemManifest, slug: string): string | undefined {
  return manifest.factions.find((f) => f.slug === slug)?.file;
}

// Detachment names differ only in case/punctuation across BSData and Wahapedia; match
// on a normalised form (lowercase, non-alphanumerics collapsed to single spaces).
function normalizeDetachmentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The stratagems relevant to a roster: Core (always) plus one group per selected
 * detachment. Each group holds the faction file's stratagems whose `detachment`
 * matches the (normalised) detachment name; an unmatched name — or an undefined
 * faction file — yields an empty group, never an error. The original detachment
 * name is preserved in the output for display, and input order is kept.
 */
export function selectStratagems(
  core: StratagemFile,
  faction: StratagemFile | undefined,
  detachmentNames: string[],
): { core: Stratagem[]; byDetachment: { detachment: string; stratagems: Stratagem[] }[] } {
  const byDetachment = detachmentNames.map((detachment) => {
    const key = normalizeDetachmentName(detachment);
    const stratagems = faction
      ? faction.stratagems.filter((s) => normalizeDetachmentName(s.detachment) === key)
      : [];
    return { detachment, stratagems };
  });
  return { core: core.stratagems, byDetachment };
}
