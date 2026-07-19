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

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  return res;
}

// Guard against a bad acquisition (missing/truncated/HTML-error file) before it
// reaches the parser as a silent 0-root catalogue. Checks the file exists, has
// plausible size, and opens with the expected BattleScribe root tag.
function assertCatalogueFile(path, rootTag) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const size = statSync(path).size;
  if (size < 200) throw new Error(`${path} is ${size}B — truncated or empty`);
  const head = readFileSync(path, "utf8").slice(0, 4096);
  if (!head.includes(rootTag)) throw new Error(`${path} is not a ${rootTag}… file`);
}

function main() {
  const configPath = arg("--config", join(ROOT, "scripts/catalogues.config.json"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const { repo, ref, gameSystem, catalogues } = config;

  const tmp = mkdtempSync(join(tmpdir(), "muster-cat-"));
  mkdirSync(OUT_DIR, { recursive: true });

  let built = 0;
  try {
    console.log(`Building parser (cargo build --release)...`);
    run("cargo", ["build", "--release", "--bin", "muster-parse"], { cwd: PARSER_DIR });

    const srcDir = join(tmp, "bsdata");
    console.log(`Cloning ${repo}@${ref}...`);
    run("git", ["clone", "--depth", "1", "--branch", ref, "--single-branch", `https://github.com/${repo}.git`, srcDir]);

    const gstPath = join(srcDir, gameSystem);
    assertCatalogueFile(gstPath, "<gameSystem");

    for (const cat of catalogues) {
      console.log(`\n[${cat.slug}] ${cat.name}`);
      const outPath = join(OUT_DIR, `${cat.slug}.ir.json`);
      try {
        const primaryPath = join(srcDir, cat.primary);
        assertCatalogueFile(primaryPath, "<catalogue");
        const libPaths = (cat.libraries ?? []).map((lib) => {
          const p = join(srcDir, lib);
          assertCatalogueFile(p, "<catalogue");
          return p;
        });

        // Parse: primary + supporting libraries + game system. Both the (large) tree
        // on stdout and the (thousands of) diagnostics on stderr go to files — piping
        // stderr through the orchestrator proved unreliable under CI's node (the
        // summary line silently went missing), which hid why a faction parsed empty.
        console.log(`  inputs: primary ${statSync(primaryPath).size}B` +
          (libPaths.length ? `, libs [${libPaths.map((p) => statSync(p).size).join(", ")}]B` : ""));
        const treePath = join(tmp, `${cat.slug}.tree.json`);
        const errPath = join(tmp, `${cat.slug}.stderr.txt`);
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
        // path and place it into OUT_DIR only after it validates, so a failed/thin run
        // never overwrites a previously-good catalogue.
        const tmpOut = join(tmp, `${cat.slug}.ir.json`);
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
    for (const f of readdirSync(OUT_DIR)) {
      if (f.endsWith(".ir.json") && !configSlugs.has(f.replace(/\.ir\.json$/, ""))) {
        rmSync(join(OUT_DIR, f));
      }
    }

    console.log(`\nBuilding manifest...`);
    run("node", [join(ROOT, "scripts/build-catalogue-manifest.mjs")], { cwd: ROOT });
    console.log(`Done — refreshed ${built}/${catalogues.length} catalogue(s).`);
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
