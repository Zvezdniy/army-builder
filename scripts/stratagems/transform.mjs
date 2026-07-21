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
