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
