#!/usr/bin/env node
// Refresh the local catalogue library from BSData: download the configured game
// system + faction catalogues, parse each with the Rust parser, pack, and write
// packed IR + a manifest into apps/web/public/catalogues/. This is the pipeline
// GitHub Actions runs on a schedule; it also works locally.
//
// No GW data enters git — apps/web/public/ is gitignored. Only this script, its
// config, and the workflow are versioned. Split factions (thin .cat + a separate
// "- Library.cat") are handled by passing the library as a supporting parse input;
// catalogueLink resolution (P0-c) is NOT required.
//
// Usage: node scripts/update-catalogues.mjs [--config <path>]
import { readFileSync, writeFileSync, mkdtempSync, openSync, closeSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARSER_DIR = join(ROOT, "packages/engine-parser");
const PARSER_BIN = join(PARSER_DIR, "target/release/muster-parse");
const OUT_DIR = join(ROOT, "apps/web/public/catalogues");
const MIN_ROOTS = 5; // a healthy faction has dozens of roots; fewer = likely a missing library

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res;
}

async function download(repo, ref, name, dest) {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const configPath = arg("--config", join(ROOT, "scripts/catalogues.config.json"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const { repo, ref, gameSystem, catalogues } = config;

  const tmp = mkdtempSync(join(tmpdir(), "muster-cat-"));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Building parser (cargo build --release)...`);
  run("cargo", ["build", "--release", "--bin", "muster-parse"], { cwd: PARSER_DIR });

  console.log(`Downloading game system ${gameSystem}...`);
  const gstPath = join(tmp, "gamesystem.gst");
  await download(repo, ref, gameSystem, gstPath);

  let built = 0;
  for (const cat of catalogues) {
    console.log(`\n[${cat.slug}] ${cat.name}`);
    const primaryPath = join(tmp, `${cat.slug}-primary.cat`);
    await download(repo, ref, cat.primary, primaryPath);
    const libPaths = [];
    for (const [i, lib] of (cat.libraries ?? []).entries()) {
      const p = join(tmp, `${cat.slug}-lib${i}.cat`);
      await download(repo, ref, lib, p);
      libPaths.push(p);
    }

    // Parse: primary + supporting libraries + game system. Tree IR is large, so
    // redirect stdout to a file rather than buffering it in the orchestrator.
    const treePath = join(tmp, `${cat.slug}.tree.json`);
    const fd = openSync(treePath, "w");
    let parse;
    try {
      // Capture the parser's stderr (thousands of per-entry diagnostics) instead of
      // inheriting it, and surface only the one-line summary below.
      parse = spawnSync(PARSER_BIN, [primaryPath, ...libPaths, gstPath], {
        stdio: ["ignore", fd, "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } finally {
      closeSync(fd);
    }
    if (parse.status !== 0) { console.warn(`  parse failed (exit ${parse.status}) — skipping`); continue; }
    const diagLine = String(parse.stderr).split("\n").reverse().find((l) => l.startsWith("diagnostics:"));
    if (diagLine) console.log(`  parser ${diagLine.trim()}`);

    // Pack in a separate high-heap child (the tree can be ~200MB).
    const outPath = join(OUT_DIR, `${cat.slug}.ir.json`);
    run("pnpm", ["exec", "tsx", join(ROOT, "scripts/pack-ir.mjs"), treePath, outPath], {
      cwd: ROOT,
      env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim() },
    });

    const packed = JSON.parse(readFileSync(outPath, "utf8"));
    const roots = packed.entries?.length ?? 0;
    if (roots < MIN_ROOTS) {
      console.warn(`  only ${roots} roots — likely a missing library in the config; keeping anyway`);
    } else {
      console.log(`  ${roots} roots`);
    }
    built++;
  }

  console.log(`\nBuilding manifest...`);
  run("node", [join(ROOT, "scripts/build-catalogue-manifest.mjs")], { cwd: ROOT });
  console.log(`Done — refreshed ${built}/${catalogues.length} catalogue(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
