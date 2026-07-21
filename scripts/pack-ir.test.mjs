import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// pack-ir refuses to pack a partial parse: a faction that models detachments but
// whose detachment root resolved to 0 children (the signature of a missing
// supporting library — the bug that once shipped an empty Genestealer Cults).
// These tests drive the real script as a subprocess over derived trees.

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_IR = join(HERE, "pack-ir.mjs");
const TSX = join(HERE, "..", "node_modules", ".bin", "tsx");
const GOLDEN = join(HERE, "..", "packages/engine-parser/tests/fixtures/golden/mini40k.ir.json");

// A base tree with a detachment root carrying the given children.
function treeWithDetachment(children) {
  const base = JSON.parse(readFileSync(GOLDEN, "utf8"));
  base.entries.push({ id: "e.detachment", name: "Detachment", type: "upgrade", children });
  return base;
}

function runPackIr(tree) {
  const dir = mkdtempSync(join(tmpdir(), "pack-ir-test-"));
  const inPath = join(dir, "tree.json");
  const outPath = join(dir, "out.ir.json");
  writeFileSync(inPath, JSON.stringify(tree));
  const res = spawnSync(TSX, [PACK_IR, inPath, outPath], { encoding: "utf8" });
  return { status: res.status, stderr: res.stderr ?? "", outWritten: existsSync(outPath) };
}

describe("pack-ir detachment guard", () => {
  it("packs a faction whose detachment root has children", () => {
    const res = runPackIr(treeWithDetachment([{ id: "e.det.gladius", name: "Gladius Task Force", type: "upgrade" }]));
    expect(res.status).toBe(0);
    expect(res.outWritten).toBe(true);
  });

  it("refuses to pack a detachment root with 0 children and writes no output", () => {
    const res = runPackIr(treeWithDetachment([]));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("0 children");
    expect(res.outWritten).toBe(false);
  });

  it("packs a faction that models no detachments at all (root absent)", () => {
    const res = runPackIr(JSON.parse(readFileSync(GOLDEN, "utf8")));
    expect(res.status).toBe(0);
    expect(res.outWritten).toBe(true);
  });
});
