// Produce a distributable packed IR from a tree-shaped muster-parse output.
// Run with tsx (resolves the @muster/domain TypeScript source):
//   pnpm exec tsx scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { packCatalogue, loadCatalogue } from "@muster/domain";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: tsx scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>");
  process.exit(1);
}

const tree = loadCatalogue(JSON.parse(readFileSync(inPath, "utf8")));
const packed = packCatalogue(tree);
writeFileSync(outPath, JSON.stringify(packed));

const before = statSync(inPath).size;
const after = statSync(outPath).size;
console.error(
  `packed ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB ` +
    `(${((1 - after / before) * 100).toFixed(1)}% smaller); ` +
    `pool ${packed.entryPool.length} subtrees`,
);
