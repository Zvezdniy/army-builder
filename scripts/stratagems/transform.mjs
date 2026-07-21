// Pure, network-free transforms for the Wahapedia stratagem export. Unit-tested
// via scripts/stratagems/transform.test.mjs (no coverage gate — see scripts/vitest.config.ts).

// Wahapedia CSV: pipe-delimited, no quoting, a trailing empty field after the
// last column, and descriptions that CAN contain literal newlines. Reassemble a
// record by accumulating physical lines until its '|' count reaches the header's.
export function parseStratagemCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split("\n");
  const header = lines[0].replace(/\r$/, "");
  const names = header.split("|").slice(0, -1); // drop the trailing empty field name
  const pipeCount = (header.match(/\|/g) || []).length;

  const records = [];
  let buf = "";
  for (let i = 1; i < lines.length; i++) {
    buf = buf === "" ? lines[i] : buf + "\n" + lines[i];
    if ((buf.match(/\|/g) || []).length >= pipeCount) {
      records.push(buf);
      buf = "";
    }
  }
  if (buf.trim() !== "") records.push(buf);

  return records.map((r) => {
    const parts = r.replace(/\r$/, "").split("|");
    const obj = {};
    names.forEach((n, idx) => { obj[n] = parts[idx] ?? ""; });
    return obj;
  });
}

// "1st Company Task Force – Battle Tactic Stratagem" → "Battle Tactic".
// The owner (detachment or "Core") is before the en-dash; the category is the
// segment after it, minus the trailing "Stratagem". A bare "… – Stratagem" → "".
export function deriveCategory(type) {
  if (!type) return "";
  const seg = type.split("–").pop().trim();
  return seg.replace(/\s*Stratagem\s*$/i, "").trim();
}

export function coerceCp(s) {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function recordToStratagem(rec) {
  return {
    id: rec.id,
    name: rec.name,
    category: deriveCategory(rec.type),
    cpCost: coerceCp(rec.cp_cost),
    turn: rec.turn,
    phase: rec.phase,
    detachment: rec.detachment,
    detachmentId: rec.detachment_id,
    legend: rec.legend,
    description: rec.description,
  };
}

// The owner label before the en-dash ("Core", "Boarding Actions", a detachment name).
function typePrefix(type) {
  return (type || "").split("–")[0].trim();
}

// A universal Core stratagem: no faction AND owner exactly "Core". This excludes
// empty-faction game-mode rows (Boarding Actions, Challenger) and the "Core
// Stratagem" artefact rows.
export function isCore(rec) {
  return rec.faction_id === "" && typePrefix(rec.type) === "Core";
}

export function bucketStratagems(records, factionIds) {
  const core = [];
  const byFaction = new Map();
  const dropped = new Map();
  const bump = (key) => dropped.set(key, (dropped.get(key) ?? 0) + 1);
  for (const rec of records) {
    if (isCore(rec)) { core.push(recordToStratagem(rec)); continue; }
    if (rec.faction_id === "") { bump(typePrefix(rec.type) || "(blank)"); continue; }
    if (!factionIds.has(rec.faction_id)) { bump(rec.faction_id); continue; }
    if (!byFaction.has(rec.faction_id)) byFaction.set(rec.faction_id, []);
    byFaction.get(rec.faction_id).push(recordToStratagem(rec));
  }
  return { core, byFaction, dropped };
}

export function buildManifest(config, buckets) {
  const factions = Object.entries(config.factionMap).map(([slug, wahaId]) => {
    const canonical = config.canonicalSlug[wahaId];
    return {
      slug,
      wahapediaFactionId: wahaId,
      file: `stratagems/${canonical}.json`,
      count: buckets.byFaction.get(wahaId)?.length ?? 0,
    };
  });
  return {
    version: 1,
    source: "Wahapedia",
    attribution: config.attribution,
    core: { file: "stratagems/_core.json", count: buckets.core.length },
    factions,
  };
}
