import { describe, it, expect, vi } from "vitest";
import { bundledDescriptor, loadRegistry, loadCatalogueFor, normalizeBase, type CatalogueDescriptor } from "./catalogueRegistry";
import mini40k from "../mini40k.ir.json";

const bundled = bundledDescriptor(mini40k, { id: "10e", name: "10th Edition" });

function fakeFetch(routes: Record<string, { ok: boolean; body: unknown }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: hit.ok, status: hit.ok ? 200 : 500, json: async () => hit.body } as Response;
  }) as typeof fetch;
}

describe("bundledDescriptor", () => {
  it("derives id and name from the parsed catalogue", () => {
    expect(bundled.name).toBe("Mini 40k");
    expect(bundled.source.kind).toBe("bundled");
  });
});

describe("loadRegistry", () => {
  const manifestUrl = "/catalogues.json";

  it("returns bundled first, then valid manifest entries", async () => {
    const f = fakeFetch({
      [manifestUrl]: {
        ok: true,
        body: { version: 1, catalogues: [{ id: "sm", name: "Space Marines", file: "catalogues/sm.ir.json" }] },
      },
    });
    const reg = await loadRegistry(bundled, f, manifestUrl);
    expect(reg.map((d) => d.name)).toEqual(["Mini 40k", "Space Marines"]);
    expect(reg[1]?.source).toEqual({ kind: "manifest", file: "catalogues/sm.ir.json" });
  });

  it("degrades to bundled-only when the manifest 404s", async () => {
    expect(await loadRegistry(bundled, fakeFetch({}), manifestUrl)).toEqual([bundled]);
  });

  it("degrades to bundled-only on malformed manifest JSON", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: { nonsense: true } } });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("degrades to bundled-only when a v2 body has no editions array", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: { version: 2, catalogues: [] } } });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("degrades to bundled-only for a genuinely unsupported version", async () => {
    const f = fakeFetch({ [manifestUrl]: { ok: true, body: { version: 3, catalogues: [] } } });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("invalidates a v2 manifest whose catalogue entry has a missing or non-string edition, rather than defaulting it to 10e", async () => {
    const editions = [{ id: "10e", name: "10th Edition" }];
    const missingEdition = fakeFetch({
      [manifestUrl]: {
        ok: true,
        body: { version: 2, editions, catalogues: [{ id: "sm", name: "Space Marines", file: "catalogues/10e/space-marines.ir.json" } /* no edition */] },
      },
    });
    expect(await loadRegistry(bundled, missingEdition, manifestUrl)).toEqual([bundled]);

    const nonStringEdition = fakeFetch({
      [manifestUrl]: {
        ok: true,
        body: { version: 2, editions, catalogues: [{ id: "sm", edition: 10, name: "Space Marines", file: "catalogues/10e/space-marines.ir.json" }] },
      },
    });
    expect(await loadRegistry(bundled, nonStringEdition, manifestUrl)).toEqual([bundled]);
  });

  it("does not let a manifest entry shadow the bundled id", async () => {
    const f = fakeFetch({
      [manifestUrl]: { ok: true, body: { version: 1, catalogues: [{ id: bundled.catalogueId, name: "Dupe", file: "x.ir.json" }] } },
    });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("degrades to bundled-only when an entry is missing a required field", async () => {
    const f = fakeFetch({
      [manifestUrl]: { ok: true, body: { version: 1, catalogues: [{ id: "sm", name: "SM" /* no file */ }] } },
    });
    expect(await loadRegistry(bundled, f, manifestUrl)).toEqual([bundled]);
  });

  it("keeps the first of two manifest entries sharing a non-bundled id", async () => {
    const f = fakeFetch({
      [manifestUrl]: { ok: true, body: { version: 1, catalogues: [
        { id: "dup", name: "First", file: "a.ir.json" },
        { id: "dup", name: "Second", file: "b.ir.json" },
      ] } },
    });
    const reg = await loadRegistry(bundled, f, manifestUrl);
    expect(reg.map((d) => d.name)).toEqual(["Mini 40k", "First"]);
  });

  it("degrades to bundled-only when fetch throws", async () => {
    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await loadRegistry(bundled, throwing, manifestUrl)).toEqual([bundled]);
  });

  it("warns on a malformed manifest but stays silent when none is present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await loadRegistry(bundled, fakeFetch({ [manifestUrl]: { ok: true, body: { nonsense: true } } }), manifestUrl);
      expect(warn).toHaveBeenCalledTimes(1); // malformed → one warning
      warn.mockClear();
      await loadRegistry(bundled, fakeFetch({}), manifestUrl); // 404 → normal, silent
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("loadRegistry — editions", () => {
  const manifestUrl = "/catalogues.json";
  const v2 = {
    version: 2,
    editions: [{ id: "10e", name: "10th Edition" }, { id: "11e", name: "11th Edition" }],
    catalogues: [
      { id: "sm", edition: "10e", name: "Space Marines", file: "catalogues/10e/space-marines.ir.json" },
      { id: "sm", edition: "11e", name: "Space Marines", file: "catalogues/11e/space-marines.ir.json" },
    ],
  };

  it("keeps same-id catalogues from different editions as distinct descriptors", async () => {
    const reg = await loadRegistry(bundled, fakeFetch({ [manifestUrl]: { ok: true, body: v2 } }), manifestUrl);
    const sm = reg.filter((d) => d.catalogueId === "sm");
    expect(sm.map((d) => d.edition)).toEqual(["10e", "11e"]);
    expect(new Set(sm.map((d) => d.id)).size).toBe(2);
    expect(sm[1]?.editionName).toBe("11th Edition");
  });

  it("reads a v1 manifest as 10th edition", async () => {
    const v1 = { version: 1, catalogues: [{ id: "sm", name: "Space Marines", file: "catalogues/sm.ir.json" }] };
    const reg = await loadRegistry(bundled, fakeFetch({ [manifestUrl]: { ok: true, body: v1 } }), manifestUrl);
    const sm = reg.find((d) => d.catalogueId === "sm");
    expect(sm?.edition).toBe("10e");
    expect(sm?.editionName).toBe("10th Edition");
  });
});

describe("normalizeBase", () => {
  it("adds a trailing slash when missing", () => {
    expect(normalizeBase("https://user.github.io/repo")).toBe("https://user.github.io/repo/");
  });
  it("leaves an existing trailing slash", () => {
    expect(normalizeBase("/")).toBe("/");
    expect(normalizeBase("/muster/")).toBe("/muster/");
  });
});

describe("loadCatalogueFor", () => {
  it("materializes a bundled descriptor", async () => {
    const cat = await loadCatalogueFor(bundled, fakeFetch({}), "/");
    expect(cat.name).toBe("Mini 40k");
  });

  it("fetches and parses a manifest descriptor relative to baseUrl", async () => {
    const desc: CatalogueDescriptor = {
      id: "10e:sm", catalogueId: "sm", name: "SM", edition: "10e", editionName: "10th Edition",
      source: { kind: "manifest", file: "catalogues/sm.ir.json" },
    };
    const f = fakeFetch({ "/catalogues/sm.ir.json": { ok: true, body: mini40k } });
    const cat = await loadCatalogueFor(desc, f, "/");
    expect(cat.name).toBe("Mini 40k");
  });

  it("throws when a manifest catalogue fetch is not ok", async () => {
    const desc: CatalogueDescriptor = {
      id: "10e:sm", catalogueId: "sm", name: "SM", edition: "10e", editionName: "10th Edition",
      source: { kind: "manifest", file: "catalogues/sm.ir.json" },
    };
    await expect(loadCatalogueFor(desc, fakeFetch({}), "/")).rejects.toBeTruthy();
  });
});
