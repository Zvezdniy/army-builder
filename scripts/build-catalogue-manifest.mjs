#!/usr/bin/env node
// Scans apps/web/public/catalogues/*.ir.json and writes apps/web/public/catalogues.json
// listing each catalogue's { id, name, file }. Run after dropping packed/tree IRs there.
// No GW data enters git — apps/web/public/ is gitignored; this only builds a local manifest.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "apps/web/public/catalogues");
const out = join(process.cwd(), "apps/web/public/catalogues.json");

if (!existsSync(dir)) {
  console.error(`No ${dir} — create it and add *.ir.json catalogues first.`);
  process.exit(1);
}

const catalogues = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".ir.json")).sort()) {
  const json = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (typeof json.id !== "string" || typeof json.name !== "string") {
    console.warn(`Skipping ${f}: missing id/name`);
    continue;
  }
  catalogues.push({ id: json.id, name: json.name, file: `catalogues/${f}` });
}

writeFileSync(out, JSON.stringify({ version: 1, catalogues }, null, 2) + "\n");
console.log(`Wrote ${out} with ${catalogues.length} catalogue(s).`);
