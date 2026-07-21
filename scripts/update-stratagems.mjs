#!/usr/bin/env node
// Refresh the local stratagem library from the Wahapedia data export: fetch the
// pipe-delimited Stratagems.csv, transform it to per-faction JSON + a manifest,
// and write them into apps/web/public/stratagems/. No GW data enters git —
// apps/web/public/ is gitignored. Only this script + its config are versioned.
//
// Edition-agnostic: Wahapedia's 11e export currently mirrors 10e byte-for-byte,
// so one shared dataset serves both editions. Point config.sourceBase at wh40k11ed
// when it carries real 11e content.
//
// Usage: node scripts/update-stratagems.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStratagemCsv, bucketStratagems, buildManifest, validateCsvBody } from "./stratagems/transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "apps/web/public");
const OUT_DIR = join(PUBLIC_DIR, "stratagems");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "scripts/stratagems.config.json"), "utf8"));
const MIN_RECORDS = 1000;

async function main() {
  const url = `${CONFIG.sourceBase}/Stratagems.csv`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url, { headers: { "User-Agent": CONFIG.userAgent } });
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const text = await res.text();
  validateCsvBody(text, { minBytes: 100_000, headerPrefix: "faction_id|name|id|type" });

  const records = parseStratagemCsv(text);
  if (records.length < MIN_RECORDS) {
    throw new Error(`only ${records.length} records — reader broke or thin data`);
  }

  const factionIds = new Set(Object.keys(CONFIG.canonicalSlug));
  const buckets = bucketStratagems(records, factionIds);
  const manifest = buildManifest(CONFIG, buckets);

  // Build every output in memory first; only write once all are ready, so a
  // parse/validate failure never leaves a half-written directory.
  const files = new Map();
  files.set(join(OUT_DIR, "_core.json"),
    JSON.stringify({ source: "Wahapedia", kind: "core", stratagems: buckets.core }, null, 2) + "\n");
  for (const [wahaId, strats] of buckets.byFaction) {
    const canonical = CONFIG.canonicalSlug[wahaId];
    files.set(join(OUT_DIR, `${canonical}.json`),
      JSON.stringify({ source: "Wahapedia", kind: "faction", wahapediaFactionId: wahaId, stratagems: strats }, null, 2) + "\n");
  }
  files.set(join(PUBLIC_DIR, "stratagems.json"), JSON.stringify(manifest, null, 2) + "\n");

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [p, content] of files) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  const droppedSummary = [...buckets.dropped].map(([f, n]) => `${f}:${n}`).join(", ") || "none";
  console.log(`Wrote ${buckets.core.length} core, ${buckets.byFaction.size} faction files, ` +
    `manifest ${manifest.factions.length} slugs. Dropped: ${droppedSummary}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
