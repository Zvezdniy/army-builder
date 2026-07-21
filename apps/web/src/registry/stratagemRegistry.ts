import { loadStratagemManifest, loadStratagemFile, stratagemFileForSlug } from "@muster/domain";
import type { StratagemManifest, StratagemFile } from "@muster/domain";
import type { CatalogueDescriptor } from "./catalogueRegistry";

/** The active faction slug for a descriptor, from its manifest file path
 *  ("catalogues/10e/space-marines.ir.json" → "space-marines"); undefined for a
 *  bundled fixture or imported IR (no slug → no faction stratagems). */
export function slugForDescriptor(descriptor: CatalogueDescriptor): string | undefined {
  if (descriptor.source.kind !== "manifest") return undefined;
  const base = descriptor.source.file.split("/").pop();
  return base ? base.replace(/\.ir\.json$/, "") : undefined;
}

/** Fetch + validate the stratagem manifest; undefined on any failure (no fetch,
 *  missing, non-OK, bad JSON). */
export async function loadStratagemLibrary(
  fetchFn: typeof fetch | undefined, base: string,
): Promise<StratagemManifest | undefined> {
  if (!fetchFn) return undefined;
  try {
    const res = await fetchFn(`${base}stratagems.json`);
    if (!res.ok) return undefined;
    return loadStratagemManifest(await res.json());
  } catch {
    return undefined;
  }
}

async function fetchFile(fetchFn: typeof fetch, base: string, file: string): Promise<StratagemFile | undefined> {
  try {
    const res = await fetchFn(`${base}${file}`);
    if (!res.ok) return undefined;
    return loadStratagemFile(await res.json());
  } catch {
    return undefined;
  }
}

/** Fetch the core file + the faction's file (if the slug resolves), validated.
 *  { core, faction? }; undefined if the core file can't load; faction omitted
 *  (core-only) if the slug is absent or its file fails. Never throws. */
export async function loadStratagemsFor(
  fetchFn: typeof fetch | undefined, base: string,
  manifest: StratagemManifest, slug: string | undefined,
): Promise<{ core: StratagemFile; faction?: StratagemFile } | undefined> {
  if (!fetchFn) return undefined;
  const core = await fetchFile(fetchFn, base, manifest.core.file);
  if (!core) return undefined;
  const factionFile = slug ? stratagemFileForSlug(manifest, slug) : undefined;
  const faction = factionFile ? await fetchFile(fetchFn, base, factionFile) : undefined;
  return faction ? { core, faction } : { core };
}
