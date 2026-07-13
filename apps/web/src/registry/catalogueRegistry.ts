import { loadCatalogue, type IrCatalogue } from "@muster/domain";

export type CatalogueDescriptor = {
  id: string;
  name: string;
  source: { kind: "bundled"; data: unknown } | { kind: "manifest"; file: string };
};

export type CatalogueManifest = {
  version: 1;
  catalogues: { id: string; name: string; file: string }[];
};

/** Structural validation of a fetched manifest — no schema dependency in the web app.
 *  Returns the typed manifest, or null when the shape is anything but version-1 with a
 *  well-formed catalogues array (so `loadRegistry` can degrade to bundled-only). */
function parseManifest(raw: unknown): CatalogueManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { version?: unknown; catalogues?: unknown };
  if (m.version !== 1 || !Array.isArray(m.catalogues)) return null;
  const catalogues: CatalogueManifest["catalogues"] = [];
  for (const c of m.catalogues) {
    if (!c || typeof c !== "object") return null;
    const { id, name, file } = c as { id?: unknown; name?: unknown; file?: unknown };
    if (typeof id !== "string" || typeof name !== "string" || typeof file !== "string") return null;
    catalogues.push({ id, name, file });
  }
  return { version: 1, catalogues };
}

/** Build the always-present bundled descriptor from an imported IR JSON. */
export function bundledDescriptor(data: unknown): CatalogueDescriptor {
  const cat = loadCatalogue(data);
  return { id: cat.id, name: cat.name, source: { kind: "bundled", data } };
}

/** Assemble the registry: bundled first, then valid manifest entries (deduped by
 *  id, bundled wins). Any fetch/parse failure degrades to bundled-only; never throws. */
export async function loadRegistry(
  bundled: CatalogueDescriptor,
  fetchFn: typeof fetch,
  manifestUrl: string,
): Promise<CatalogueDescriptor[]> {
  try {
    const res = await fetchFn(manifestUrl);
    if (!res.ok) return [bundled]; // no manifest present — the normal bundled-only case
    const manifest = parseManifest(await res.json());
    if (!manifest) {
      // A manifest exists but is malformed: warn so a typo doesn't silently hide the library.
      console.warn(`Muster: ${manifestUrl} is malformed; ignoring the local catalogue library.`);
      return [bundled];
    }
    const seen = new Set([bundled.id]);
    const out = [bundled];
    for (const c of manifest.catalogues) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, source: { kind: "manifest", file: c.file } });
    }
    return out;
  } catch {
    // Manifest unreachable (missing, network error, invalid URL in tests): the normal
    // bundled-only degrade — stay silent, unlike the malformed-manifest case above.
    return [bundled];
  }
}

/** Lazily materialize the IrCatalogue for a descriptor through the shared load seam.
 *  Bundled descriptors need no fetch; a manifest descriptor without a `fetchFn`
 *  (no global fetch available) throws, which callers surface as a load error. */
export async function loadCatalogueFor(
  descriptor: CatalogueDescriptor,
  fetchFn: typeof fetch | undefined,
  baseUrl: string,
): Promise<IrCatalogue> {
  if (descriptor.source.kind === "bundled") return loadCatalogue(descriptor.source.data);
  if (!fetchFn) throw new Error(`Cannot load catalogue "${descriptor.name}": no fetch available`);
  const url = `${baseUrl}${descriptor.source.file}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Failed to load catalogue "${descriptor.name}" (${res.status})`);
  return loadCatalogue(await res.json());
}
