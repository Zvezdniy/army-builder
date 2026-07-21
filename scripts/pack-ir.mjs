// Produce a distributable packed IR from a tree-shaped muster-parse output.
// Run with tsx (resolves the @muster/domain TypeScript source):
//   pnpm exec tsx scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { packCatalogue, loadCatalogue } from "@muster/domain";
import { detachmentRoot } from "@muster/roster";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: tsx scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>");
  process.exit(1);
}

const tree = loadCatalogue(JSON.parse(readFileSync(inPath, "utf8")));

// Reject a partial parse the MIN_ROOTS guard in update-catalogues.mjs can't see: a
// faction that models detachments but whose detachment root resolved to 0 children.
// That is the signature of a missing supporting library (the detachment group lives in
// a "- Library" catalogue not passed to the parser — the bug that silently shipped an
// empty Genestealer Cults). Exiting non-zero makes the orchestrator skip the faction and
// keep its last-good file, rather than overwrite it with a detachment-less catalogue.
const root = detachmentRoot(tree);
if (root && (root.children?.length ?? 0) === 0) {
  console.error(
    `detachment root "${root.name}" has 0 children — partial parse (missing supporting library?). ` +
      `Refusing to pack ${inPath}.`,
  );
  process.exit(1);
}

const packed = packCatalogue(tree);
writeFileSync(outPath, JSON.stringify(packed));

const before = statSync(inPath).size;
const after = statSync(outPath).size;
console.error(
  `packed ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB ` +
    `(${((1 - after / before) * 100).toFixed(1)}% smaller); ` +
    `pool ${packed.entryPool.length} subtrees`,
);
