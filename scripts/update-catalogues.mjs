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
// BSData is acquired with ONE shallow `git clone`, not ~50 individual raw fetches:
// under load raw.githubusercontent can return an empty 200 body, which silently
// yields a 0-root catalogue. A clone is atomic and complete.
//
// Usage: node scripts/update-catalogues.mjs [--config <path>]
import { readFileSync, writeFileSync, mkdtempSync, openSync, closeSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PARSER_DIR = join(ROOT, "packages/engine-parser");
const PARSER_BIN = join(PARSER_DIR, "target/release/muster-parse");
const OUT_DIR = join(ROOT, "apps/web/public/catalogues");
const MIN_ROOTS = 5; // a healthy faction has dozens of roots; fewer = likely a missing library
// The edition a pre-edition (flat) layout is attributed to. Must match the fallback in
// editionsOf() and the loose-file branch of scripts/build-catalogue-manifest.mjs.
const LEGACY_EDITION = "10e";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res;
}

// Guard against a bad acquisition (missing/truncated/HTML-error file) before it reaches
// the parser as a silent 0-root catalogue. 10e ships XML, 11e ships JSON — check the
// shape each format actually has.
function assertCatalogueFile(path, kind) { // kind: "catalogue" | "gameSystem"
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const size = statSync(path).size;
  if (size < 200) throw new Error(`${path} is ${size}B — truncated or empty`);
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`${path} is not valid JSON — ${err.message}`);
    }
    if (!parsed || typeof parsed !== "object" || !(kind in parsed)) {
      throw new Error(`${path} has no "${kind}" key — not a BattleScribe ${kind} file`);
    }
    return;
  }
  if (!text.slice(0, 4096).includes(`<${kind}`)) throw new Error(`${path} is not a <${kind}… file`);
}

// Legacy flat configs (a single repo/gameSystem + catalogues) are the pre-edition shape
// still used by ad-hoc smoke configs — treat them as a lone 10th-edition entry.
function editionsOf(config) {
  if (Array.isArray(config.editions)) return config.editions;
  return [{ id: LEGACY_EDITION, name: "10th Edition", repo: config.repo, ref: config.ref,
            gameSystem: config.gameSystem, catalogues: config.catalogues }];
}

// Builds one edition's factions into apps/web/public/catalogues/<edition.id>/. Returns
// the number successfully built for this edition (out of edition.catalogues.length).
function buildEdition(edition, tmp) {
  const { id, repo, ref, gameSystem, catalogues } = edition;
  const editionOutDir = join(OUT_DIR, id);
  mkdirSync(editionOutDir, { recursive: true });

  let built = 0;
  const srcDir = join(tmp, `bsdata-${id}`);
  console.log(`Cloning ${repo}@${ref}...`);
  run("git", ["clone", "--depth", "1", "--branch", ref, "--single-branch", `https://github.com/${repo}.git`, srcDir]);

  const gstPath = join(srcDir, gameSystem);
  assertCatalogueFile(gstPath, "gameSystem");

  for (const cat of catalogues) {
    console.log(`\n[${id}/${cat.slug}] ${cat.name}`);
    const outPath = join(editionOutDir, `${cat.slug}.ir.json`);
    try {
      const primaryPath = join(srcDir, cat.primary);
      assertCatalogueFile(primaryPath, "catalogue");
      const libPaths = (cat.libraries ?? []).map((lib) => {
        const p = join(srcDir, lib);
        assertCatalogueFile(p, "catalogue");
        return p;
      });

      // Parse: primary + supporting libraries + game system. Both the (large) tree
      // on stdout and the (thousands of) diagnostics on stderr go to files — piping
      // stderr through the orchestrator proved unreliable under CI's node (the
      // summary line silently went missing), which hid why a faction parsed empty.
      console.log(`  inputs: primary ${statSync(primaryPath).size}B` +
        (libPaths.length ? `, libs [${libPaths.map((p) => statSync(p).size).join(", ")}]B` : ""));
      const treePath = join(tmp, `${id}-${cat.slug}.tree.json`);
      const errPath = join(tmp, `${id}-${cat.slug}.stderr.txt`);
      const fdOut = openSync(treePath, "w");
      const fdErr = openSync(errPath, "w");
      let parse;
      try {
        parse = spawnSync(PARSER_BIN, [primaryPath, ...libPaths, gstPath], { stdio: ["ignore", fdOut, fdErr] });
      } finally {
        closeSync(fdOut);
        closeSync(fdErr);
      }
      const stderr = readFileSync(errPath, "utf8");
      rmSync(errPath, { force: true });
      const diagLine = stderr.split("\n").reverse().find((l) => l.startsWith("diagnostics:"));
      console.log(`  parser exit=${parse.status} — ${diagLine ? diagLine.trim() : "no diagnostics line"}`);
      if (parse.status !== 0) {
        const errLine = stderr.split("\n").reverse().find((l) => l.startsWith("parse error:"));
        throw new Error(`parser exited ${parse.status}${errLine ? ` — ${errLine.trim()}` : ""}`);
      }

      // Pack in a separate high-heap child (the tree can be ~200MB). Write to a temp
      // path and place it into editionOutDir only after it validates, so a failed/thin
      // run never overwrites a previously-good catalogue.
      const tmpOut = join(tmp, `${id}-${cat.slug}.ir.json`);
      run("pnpm", ["exec", "tsx", join(ROOT, "scripts/pack-ir.mjs"), treePath, tmpOut], {
        cwd: ROOT,
        env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim() },
      });

      const packed = JSON.parse(readFileSync(tmpOut, "utf8"));
      const roots = packed.entries?.length ?? 0;
      if (roots < MIN_ROOTS) throw new Error(`only ${roots} roots — thin parse (missing library, or roots not surfaced)`);
      copyFileSync(tmpOut, outPath);
      console.log(`  ${roots} roots`);
      built++;
      // Release this faction's large intermediates immediately so a 35-faction
      // run doesn't accumulate gigabytes in one temp dir before the final cleanup.
      rmSync(treePath, { force: true });
      rmSync(tmpOut, { force: true });
    } catch (err) {
      // One faction's upstream rename / OOM / thin parse must not abort the whole
      // refresh: warn and continue. Output is placed only on success (above), so a
      // previously-good catalogue is left intact. (The clone and parser build are
      // shared prerequisites and remain hard failures.)
      console.warn(`  skipped ${cat.slug}: ${err.message}`);
    }
  }

  // Drop packed files for factions no longer in the config (renamed/removed), so the
  // manifest never lists a stale faction. Failed-this-run factions keep their last
  // good file and stay listed.
  const configSlugs = new Set(catalogues.map((c) => c.slug));
  for (const f of readdirSync(editionOutDir)) {
    if (f.endsWith(".ir.json") && !configSlugs.has(f.replace(/\.ir\.json$/, ""))) {
      rmSync(join(editionOutDir, f));
    }
  }

  return built;
}

function main() {
  const configPath = arg("--config", join(ROOT, "scripts/catalogues.config.json"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const editions = editionsOf(config);

  const tmp = mkdtempSync(join(tmpdir(), "muster-cat-"));
  mkdirSync(OUT_DIR, { recursive: true });

  let built = 0;
  let total = 0;
  const builtEditions = new Set();
  try {
    console.log(`Building parser (cargo build --release)...`);
    run("cargo", ["build", "--release", "--bin", "muster-parse"], { cwd: PARSER_DIR });

    for (const edition of editions) {
      try {
        console.log(`\n=== Edition ${edition.id} (${edition.name}) ===`);
        // Kept inside the try: an edition whose config entry is missing/malformed
        // `catalogues` must be warned-and-skipped like any other edition failure,
        // not throw a TypeError that aborts every other edition's build.
        total += edition.catalogues?.length ?? 0;
        const n = buildEdition(edition, tmp);
        built += n;
        if (n > 0) builtEditions.add(edition.id);
      } catch (err) {
        // One edition's upstream outage (bad clone, missing/renamed gameSystem file)
        // must not lose the other edition's factions.
        console.warn(`skipped edition ${edition.id}: ${err.message}`);
      }
    }

    // Sweep loose *.ir.json left directly under OUT_DIR by the pre-edition layout.
    // Gated on the edition those files are ATTRIBUTED to (the manifest builder reads
    // loose files as LEGACY_EDITION) having actually built this run: a partial run in
    // which that edition's clone fails but another succeeds must not delete the only
    // copy of its library. Edition subdirectories are never touched here —
    // buildEdition() already sweeps stale files within its own dir.
    if (builtEditions.has(LEGACY_EDITION)) {
      for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".ir.json")) {
          rmSync(join(OUT_DIR, entry.name));
          console.log(`Removed stale pre-edition file ${entry.name} (superseded by apps/web/public/catalogues/<edition>/).`);
        }
      }
    }

    console.log(`\nBuilding manifest...`);
    run("node", [join(ROOT, "scripts/build-catalogue-manifest.mjs")], { cwd: ROOT });
    console.log(`Done — refreshed ${built}/${total} catalogue(s) across ${editions.length} edition(s).`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
