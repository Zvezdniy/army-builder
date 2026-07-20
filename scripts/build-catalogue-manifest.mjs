#!/usr/bin/env node
// Scans apps/web/public/catalogues/<edition>/*.ir.json (and any loose *.ir.json directly
// under catalogues/, attributed to edition 10e) and writes apps/web/public/catalogues.json
// (manifest v2) listing each catalogue's { id, edition, name, file }. Run after dropping
// packed/tree IRs there. No GW data enters git — apps/web/public/ is gitignored; this only
// builds a local manifest.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "apps/web/public/catalogues");
const out = join(process.cwd(), "apps/web/public/catalogues.json");

if (!existsSync(dir)) {
  console.error(`No ${dir} — create it and add *.ir.json catalogues first.`);
  process.exit(1);
}

// Edition display names come from the pipeline config when it is present; an edition
// directory with no config entry still ships, labelled by its id.
const configPath = join(process.cwd(), "scripts/catalogues.config.json");
const editionNames = new Map();
if (existsSync(configPath)) {
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  for (const e of cfg.editions ?? []) editionNames.set(e.id, e.name);
}

function collect(dir, edition, prefix) { // prefix: path recorded in the manifest
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ir.json")).sort()) {
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch (err) {
      // A truncated/corrupt file must not abort manifest generation for the other
      // (potentially dozens of) good catalogues at the tail of a long pipeline run.
      console.warn(`Skipping ${f}: ${err.message}`);
      continue;
    }
    if (typeof json.id !== "string" || typeof json.name !== "string") {
      console.warn(`Skipping ${f}: missing id/name`);
      continue;
    }
    out.push({ id: json.id, edition, name: json.name, file: `${prefix}${f}` });
  }
  return out;
}

const catalogues = [];
// Sorted so the manifest is reproducible: readdir order is filesystem-dependent.
const top = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
for (const entry of top) {
  if (entry.isDirectory()) {
    catalogues.push(...collect(join(dir, entry.name), entry.name, `catalogues/${entry.name}/`));
  } else if (entry.isFile() && entry.name.endsWith(".ir.json")) {
    // A stale flat output directory (pre-edition layout) degrades to edition 10e
    // instead of vanishing.
    let json;
    try {
      json = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
    } catch (err) {
      console.warn(`Skipping ${entry.name}: ${err.message}`);
      continue;
    }
    if (typeof json.id !== "string" || typeof json.name !== "string") {
      console.warn(`Skipping ${entry.name}: missing id/name`);
      continue;
    }
    catalogues.push({ id: json.id, edition: "10e", name: json.name, file: `catalogues/${entry.name}` });
  }
}

const editions = [...new Set(catalogues.map((c) => c.edition))].sort()
  .map((id) => ({ id, name: editionNames.get(id) ?? id }));
writeFileSync(out, JSON.stringify({ version: 2, editions, catalogues }, null, 2) + "\n");
console.log(`Wrote ${out} with ${catalogues.length} catalogue(s) across ${editions.length} edition(s).`);
