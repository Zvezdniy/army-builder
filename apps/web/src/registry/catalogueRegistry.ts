import { loadCatalogue, type IrCatalogue } from "@muster/domain";

export type CatalogueDescriptor = {
  id: string; // composite "<edition>:<catalogueId>" — opaque key, never parsed by callers
  catalogueId: string; // the raw BSData catalogue id (NOT unique across editions)
  name: string;
  edition: string; // e.g. "10e"
  editionName: string; // e.g. "10th Edition"
  source: { kind: "bundled"; data: unknown } | { kind: "manifest"; file: string };
};

export type CatalogueManifestEdition = { id: string; name: string };

/** Internal normalized shape: both manifest v1 and v2 bodies parse into this — a single
 *  v2-shaped value — so `loadRegistry` has one code path regardless of the wire version. */
export type CatalogueManifest = {
  version: 2;
  editions: CatalogueManifestEdition[];
  catalogues: { id: string; edition: string; name: string; file: string }[];
};

/** Structural validation of a fetched manifest — no schema dependency in the web app.
 *  Accepts a v1 body (every catalogue attributed to edition "10e") or a v2 body (explicit
 *  `editions` + a required string `edition` per catalogue), normalizing both into the same
 *  v2-shaped `CatalogueManifest`. Anything else — including a v2 catalogue entry missing a
 *  string `edition` — returns null (so `loadRegistry` can degrade to bundled-only); a v2
 *  catalogue's `edition` is never silently defaulted, only a genuine v1 body gets 10e. */
function parseManifest(raw: unknown): CatalogueManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { version?: unknown; editions?: unknown; catalogues?: unknown };
  if (!Array.isArray(m.catalogues)) return null;

  if (m.version === 1) {
    const catalogues: CatalogueManifest["catalogues"] = [];
    for (const c of m.catalogues) {
      if (!c || typeof c !== "object") return null;
      const { id, name, file } = c as { id?: unknown; name?: unknown; file?: unknown };
      if (typeof id !== "string" || typeof name !== "string" || typeof file !== "string") return null;
      catalogues.push({ id, edition: "10e", name, file });
    }
    return { version: 2, editions: [{ id: "10e", name: "10th Edition" }], catalogues };
  }

  if (m.version === 2) {
    if (!Array.isArray(m.editions)) return null;
    const editions: CatalogueManifestEdition[] = [];
    for (const e of m.editions) {
      if (!e || typeof e !== "object") return null;
      const { id, name } = e as { id?: unknown; name?: unknown };
      if (typeof id !== "string" || typeof name !== "string") return null;
      editions.push({ id, name });
    }
    const catalogues: CatalogueManifest["catalogues"] = [];
    for (const c of m.catalogues) {
      if (!c || typeof c !== "object") return null;
      const { id, edition, name, file } = c as { id?: unknown; edition?: unknown; name?: unknown; file?: unknown };
      if (typeof id !== "string" || typeof edition !== "string" || typeof name !== "string" || typeof file !== "string") {
        return null;
      }
      catalogues.push({ id, edition, name, file });
    }
    return { version: 2, editions, catalogues };
  }

  return null;
}

/** Normalize a catalogues base URL to a guaranteed trailing slash, so
 *  `${base}catalogues.json` and `${base}<file>` join cleanly whether the
 *  configured value is a relative Vite base ("/", "/muster/") or an absolute
 *  host ("https://user.github.io/repo"). */
export function normalizeBase(base: string): string {
  return base.replace(/\/?$/, "/");
}

/** Build the always-present bundled descriptor from an imported IR JSON, attributed to
 *  the given edition. */
export function bundledDescriptor(data: unknown, edition: { id: string; name: string }): CatalogueDescriptor {
  const cat = loadCatalogue(data);
  return {
    id: `${edition.id}:${cat.id}`,
    catalogueId: cat.id,
    name: cat.name,
    edition: edition.id,
    editionName: edition.name,
    source: { kind: "bundled", data },
  };
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
      // A manifest exists but isn't a valid v1 or v2 library (bad shape or unsupported
      // version): warn so a typo or version mismatch doesn't silently hide the whole library.
      console.warn(`Muster: ${manifestUrl} is not a valid catalogue library; ignoring it.`);
      return [bundled];
    }
    const editionNames = new Map(manifest.editions.map((e) => [e.id, e.name]));
    const seen = new Set([bundled.id]);
    const out = [bundled];
    for (const c of manifest.catalogues) {
      const id = `${c.edition}:${c.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        catalogueId: c.id,
        name: c.name,
        edition: c.edition,
        editionName: editionNames.get(c.edition) ?? c.edition,
        source: { kind: "manifest", file: c.file },
      });
    }
    return out;
  } catch {
    // Manifest unreachable (missing, network error, invalid URL in tests): the normal
    // bundled-only degrade — stay silent, unlike the malformed-manifest case above.
    return [bundled];
  }
}

/** The faction descriptors to OFFER in the picker. The bundled fixture (Mini 40k) is
 *  hidden once any real (manifest) faction exists, but kept when it is the only entry
 *  (manifest fetch failed) so the picker is never empty. Returns the input unchanged
 *  when it is undefined. */
export function offerableFactions(
  registry: CatalogueDescriptor[] | undefined,
): CatalogueDescriptor[] | undefined {
  if (!registry) return registry;
  return registry.some((d) => d.source.kind !== "bundled")
    ? registry.filter((d) => d.source.kind !== "bundled")
    : registry;
}

/** Distinct editions across descriptors, in first-appearance order. */
export function editionsOf(descriptors: CatalogueDescriptor[]): { id: string; name: string }[] {
  return descriptors.reduce<{ id: string; name: string }[]>(
    (acc, d) => (acc.some((e) => e.id === d.edition) ? acc : [...acc, { id: d.edition, name: d.editionName }]),
    [],
  );
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
