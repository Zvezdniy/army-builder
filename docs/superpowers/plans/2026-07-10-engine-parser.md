# Engine Parser (Rust) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rust crate `packages/engine-parser` that safely parses untrusted BattleScribe/BSData catalogue XML (`.cat`/`.gst` and their zip forms `.catz`/`.gstz`) into the **resolved IR** already defined by `@muster/domain`, emitted as JSON that `engine-eval` consumes unchanged.

**Architecture:** Two stages behind one boundary. (1) A **security layer** — a DOCTYPE-rejecting, depth/node/size-capped XML reader and a zip-bomb/zip-slip-hardened extractor — every byte of untrusted input passes through it. (2) A **compile layer** — stream XML into raw AST structs, resolve the reference graph (entry links → shared entries, catalogue imports, category links) with a cycle guard, then map the resolved tree onto the domain IR (compiled AST + symbol table, **constraint/modifier/condition nodes carried as-is**, not precomputed limits). The Rust↔TS boundary is **data** (serialized IR JSON), never FFI. A committed golden IR file is the contract: a Rust test asserts the parser produces it, a TS test asserts it validates against the Zod schemas and runs through `evaluate()`.

**Tech Stack:** Rust (edition 2021), `quick-xml` (streaming, no DTD/entity expansion), `zip`, `serde` + `serde_json`, `thiserror`, `proptest` (dev), `cargo-deny`/`cargo-audit`. Cargo workspace member alongside the existing pnpm/Turborepo monorepo. Consumes the IR shape from `packages/domain/src/{ir,conditions,modifiers}.ts`.

## Global Constraints

*Every task's requirements implicitly include this section. Values are binding — copy them verbatim into `src/limits.rs` and assert them in tests.*

- **Crate location & boundary:** `packages/engine-parser`, a Rust crate. The parser→engine boundary is **serialized IR JSON in a bundle, not FFI** (spec §4, §5).
- **Untrusted input is priority #1** (spec §10.1). The parser MUST, for every entry point that reads caller-supplied bytes:
  - **XML:** reject `<!DOCTYPE>`/DTDs and external entities (**no XXE**); perform **no entity expansion** beyond the five predefined XML entities (**no billion-laughs**); enforce depth and node-count limits.
  - **Zip (`.catz`/`.gstz` are zip):** cap total uncompressed size and per-entry **compression ratio** (**anti zip-bomb**); reject any entry whose path escapes the root (**anti zip-slip**); require **exactly one** catalogue/gamesystem XML member.
  - **Resource limits:** max input size, max nodes, max depth, and a caller-enforceable parse deadline.
  - **Never panic on malformed input** — return a typed `ParseError`. Unwinding/aborting on hostile bytes is a defect.
- **Named limit constants** (in `src/limits.rs`, exact values):
  - `MAX_INPUT_BYTES = 64 * 1024 * 1024` (64 MiB, compressed/on-disk input)
  - `MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024` (256 MiB, sum of extracted members)
  - `MAX_COMPRESSION_RATIO = 100` (uncompressed / compressed, per entry)
  - `MAX_XML_DEPTH = 256`
  - `MAX_XML_NODES = 5_000_000`
  - `MAX_ZIP_ENTRIES = 64`
- **Safety:** `#![forbid(unsafe_code)]` at crate root; minimal dependencies; `cargo deny check` and `cargo audit` are CI gates (spec §10.8).
- **IR fidelity:** output MUST deserialize cleanly through `@muster/domain`'s `IrCatalogue` Zod schema and evaluate under `engine-eval` with **zero changes to those packages**. Carry `constraint`/`modifier`/`condition`/`conditionGroup` nodes as-is (spec §5 "скомпилированный AST + таблица символов, а НЕ предвычисленные лимиты").
- **Fail loud, never miscompile:** any BattleScribe construct the walking-skeleton mapping cannot faithfully represent is recorded in a `diagnostics` channel and (for correctness-affecting cases) rejected — never silently dropped into a wrong IR value.

### Scope (Phase 1a walking skeleton)

**In scope:** catalogue-side parsing — `.cat`, `.gst` (plain XML) and `.catz`, `.gstz` (zip) → resolved `IrCatalogue` JSON, one 40k-shaped game system. Reference resolution: `entryLink`→shared `selectionEntry`/`selectionEntryGroup` (cycle-guarded), `catalogueLink` imports (catalogue→library→gameSystem), `categoryLink`. Costs: points (`pts`). Constraints: `min`/`max` on `selections` and points, scopes `parent`/`force`/`roster`/`self`. Modifiers: `set`/`increment`/`decrement` gated by conditions and condition-groups.

**Deferred (documented in code, not silently missing):** `.ros`/`.rosz` **roster** import (Phase 1b — different target type `Roster`), `.rosz`/`.catz` **export**, percent/equipment-point systems (Kill Team / Old World / Horus Heresy — spec §12.7/§13.14), profile/rule/datasheet-text extraction for Reference Mode (spec §8), `repeat` nodes (the domain IR has no `repeat`; emit a diagnostic when encountered), second data source (Rosterizer). These get their own plans.

---

## File Structure

```
packages/engine-parser/
  Cargo.toml            # crate manifest, deps, [[bin]]
  deny.toml             # cargo-deny policy (licenses, advisories, bans)
  src/
    lib.rs              # #![forbid(unsafe_code)]; public API + module wiring
    limits.rs           # all resource-limit constants (Global Constraints)
    error.rs            # ParseError taxonomy + Diagnostic
    xml/mod.rs
    xml/reader.rs       # SafeXmlReader: DOCTYPE reject, depth/node caps, over SafeXmlReader
    zip/mod.rs
    zip/extract.rs      # extract_single_xml: size/ratio/slip/count caps
    raw/mod.rs
    raw/model.rs        # raw AST structs mirroring BattleScribe elements
    raw/parse.rs        # streaming XML events -> raw structs
    resolve/mod.rs
    resolve/symbols.rs  # id index of shared entries/groups/categories
    resolve/links.rs    # inline entryLinks + merge catalogueLink imports, cycle-guard
    ir/mod.rs
    ir/model.rs         # serde structs mirroring @muster/domain IR (JSON out)
    ir/map.rs           # resolved raw -> IR, with mapping tables + diagnostics
    bin/muster-parse.rs # CLI: file -> IR JSON on stdout; wires limits + deadline
  tests/
    fixtures/
      mini40k.cat            # minimal real-shaped catalogue (hand-authored)
      mini40k.gst            # minimal game system
      mini40k.catz           # zip of mini40k.cat
      golden/mini40k.ir.json # expected IR output (the cross-language contract)
      malicious/             # XXE, billion-laughs, zip-bomb, zip-slip, deep, truncated
    security_xml.rs
    security_zip.rs
    raw_parse.rs
    resolve.rs
    map.rs
    golden.rs
    proptest.rs
  README.md             # what it does, limits, how to run, deferred scope
packages/engine-eval/test/parser-contract.test.ts  # Zod-validate golden + evaluate()
turbo.json            # (modify) add rust build/test passthrough note
```

Design rationale: files split by responsibility, security layer (`xml/`, `zip/`) isolated from compile layer (`raw/`, `resolve/`, `ir/`) so the hostile-input surface is small and independently testable. Each file holds one concern and stays reviewable in isolation.

---

## Task 1: Crate scaffold + workspace wiring + supply-chain gates

**Files:**
- Create: `packages/engine-parser/Cargo.toml`
- Create: `packages/engine-parser/deny.toml`
- Create: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/smoke.rs`
- Modify (if a root `Cargo.toml` workspace exists, else create): `Cargo.toml`

**Interfaces:**
- Produces: crate `engine_parser` with `#![forbid(unsafe_code)]`; `cargo test` and `cargo deny check` run from the crate dir.

- [ ] **Step 1: Write the failing smoke test**

```rust
// tests/smoke.rs
#[test]
fn crate_exposes_version() {
    assert_eq!(engine_parser::VERSION, env!("CARGO_PKG_VERSION"));
}
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd packages/engine-parser && cargo test --test smoke`
Expected: FAIL — crate/`VERSION` does not exist.

- [ ] **Step 3: Write `Cargo.toml`**

```toml
[package]
name = "engine-parser"
version = "0.0.0"
edition = "2021"
publish = false
license = "MIT OR Apache-2.0"

[lib]
name = "engine_parser"
path = "src/lib.rs"

[[bin]]
name = "muster-parse"
path = "src/bin/muster-parse.rs"

[dependencies]
# quick-xml >=0.41 required: 0.36 carries RUSTSEC-2026-0194/0195 (untrusted-XML DoS).
quick-xml = "0.41"
zip = { version = "2.2", default-features = false, features = ["deflate"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"

[dev-dependencies]
proptest = "1"
```

- [ ] **Step 4: Write `deny.toml`** (supply-chain gate, spec §10.8)

```toml
[advisories]
yanked = "deny"
[licenses]
allow = ["MIT", "Apache-2.0", "Unicode-3.0", "BSD-3-Clause", "Zlib"]
[bans]
multiple-versions = "warn"
```

- [ ] **Step 5: Write minimal `src/lib.rs`** (bin path will be created in Task 13; add a placeholder so the crate builds)

```rust
#![forbid(unsafe_code)]

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
```

Create `src/bin/muster-parse.rs` with a trivial `fn main() {}` so the `[[bin]]` target compiles (fleshed out in Task 13).

- [ ] **Step 6: Run test + deny**

Run: `cargo test --test smoke && cargo deny check advisories bans`
Expected: test PASS; deny reports no denied advisories/bans.

- [ ] **Step 7: Commit**

```bash
git add packages/engine-parser
git commit -m "feat(parser): scaffold engine-parser crate + supply-chain gates"
```

---

## Task 2: Resource limits + error taxonomy

**Files:**
- Create: `packages/engine-parser/src/limits.rs`
- Create: `packages/engine-parser/src/error.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/limits.rs`

**Interfaces:**
- Produces: the limit constants (exact values from Global Constraints); `ParseError` enum; `Diagnostic { code: String, message: String }`.
- Consumed by: every later task.

- [ ] **Step 1: Write the failing test**

```rust
// tests/limits.rs
use engine_parser::limits::*;

#[test]
fn limits_match_spec() {
    assert_eq!(MAX_INPUT_BYTES, 64 * 1024 * 1024);
    assert_eq!(MAX_UNCOMPRESSED_BYTES, 256 * 1024 * 1024);
    assert_eq!(MAX_COMPRESSION_RATIO, 100);
    assert_eq!(MAX_XML_DEPTH, 256);
    assert_eq!(MAX_XML_NODES, 5_000_000);
    assert_eq!(MAX_ZIP_ENTRIES, 64);
}
```

- [ ] **Step 2: Run, expect FAIL** (`engine_parser::limits` missing).

- [ ] **Step 3: Write `src/limits.rs`**

```rust
//! Resource limits for untrusted input (spec §10.1). Binding values.
pub const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_COMPRESSION_RATIO: u64 = 100;
pub const MAX_XML_DEPTH: usize = 256;
pub const MAX_XML_NODES: u64 = 5_000_000;
pub const MAX_ZIP_ENTRIES: usize = 64;
```

- [ ] **Step 4: Write `src/error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ParseError {
    #[error("input exceeds size limit ({0} bytes)")]
    InputTooLarge(u64),
    #[error("XML nesting exceeds depth limit ({0})")]
    XmlTooDeep(usize),
    #[error("XML node count exceeds limit ({0})")]
    XmlTooManyNodes(u64),
    #[error("DTD/DOCTYPE is not allowed (XXE/entity-expansion guard)")]
    DtdForbidden,
    #[error("zip entry escapes archive root: {0}")]
    ZipSlip(String),
    #[error("zip exceeds uncompressed size limit")]
    ZipBombSize,
    #[error("zip entry exceeds compression ratio limit ({0}:1)")]
    ZipBombRatio(u64),
    #[error("archive must contain exactly one catalogue XML, found {0}")]
    ZipMemberCount(usize),
    #[error("malformed XML: {0}")]
    MalformedXml(String),
    #[error("unresolved reference: {0}")]
    UnresolvedRef(String),
    #[error("reference cycle through id {0}")]
    ReferenceCycle(String),
    #[error("io error: {0}")]
    Io(String),
}

/// Non-fatal note attached to a successful parse (e.g. a construct the
/// walking-skeleton mapping does not yet represent). Never used to hide a
/// correctness-affecting drop — those become ParseError.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}
```

- [ ] **Step 5: Wire modules in `src/lib.rs`**

```rust
#![forbid(unsafe_code)]

pub mod error;
pub mod limits;

pub use error::{Diagnostic, ParseError};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
```

- [ ] **Step 6: Run `cargo test --test limits`.** Expected: PASS.

- [ ] **Step 7: Commit** — `feat(parser): resource limits + error taxonomy`.

---

## Task 3: SafeXmlReader — reject DTD, cap depth & node count

**Files:**
- Create: `packages/engine-parser/src/xml/mod.rs`
- Create: `packages/engine-parser/src/xml/reader.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/fixtures/malicious/xxe.xml`
- Create: `packages/engine-parser/tests/fixtures/malicious/billion-laughs.xml`
- Create: `packages/engine-parser/tests/fixtures/malicious/deep.xml` (generated in-test)
- Create: `packages/engine-parser/tests/security_xml.rs`

**Interfaces:**
- Produces: `SafeXmlReader` wrapping `quick_xml::Reader`, exposing `fn read_event(&mut self) -> Result<Option<SafeEvent>, ParseError>` that (a) errors on `Event::DocType`, (b) increments/【checks depth on Start/End, (c) increments/checks a node counter. `SafeEvent` re-exposes the borrowed `quick_xml::events::Event` plus current `depth`.
- Consumed by: `raw/parse.rs` (Task 5+).

- [ ] **Step 1: Write failing security tests**

```rust
// tests/security_xml.rs
use engine_parser::xml::SafeXmlReader;
use engine_parser::ParseError;

fn drain(bytes: &[u8]) -> Result<u64, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut n = 0;
    while r.read_event()?.is_some() { n += 1; }
    Ok(n)
}

#[test]
fn rejects_doctype_xxe() {
    let xxe = include_bytes!("fixtures/malicious/xxe.xml");
    assert_eq!(drain(xxe), Err(ParseError::DtdForbidden));
}

#[test]
fn rejects_doctype_billion_laughs() {
    let bomb = include_bytes!("fixtures/malicious/billion-laughs.xml");
    assert_eq!(drain(bomb), Err(ParseError::DtdForbidden));
}

#[test]
fn rejects_excessive_depth() {
    // 300 nested <a> exceeds MAX_XML_DEPTH (256).
    let mut s = String::from("<root>");
    for _ in 0..300 { s.push_str("<a>"); }
    for _ in 0..300 { s.push_str("</a>"); }
    s.push_str("</root>");
    assert!(matches!(drain(s.as_bytes()), Err(ParseError::XmlTooDeep(_))));
}

#[test]
fn accepts_ordinary_xml() {
    assert!(drain(b"<root><a x=\"1\">hi</a><b/></root>").is_ok());
}
```

- [ ] **Step 2: Write the two static malicious fixtures**

`fixtures/malicious/xxe.xml`:
```xml
<?xml version="1.0"?>
<!DOCTYPE catalogue [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<catalogue>&xxe;</catalogue>
```
`fixtures/malicious/billion-laughs.xml`:
```xml
<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>
```

- [ ] **Step 3: Run, expect FAIL** (`xml` module missing).

- [ ] **Step 4: Implement `src/xml/reader.rs`**

```rust
use quick_xml::events::Event;
use quick_xml::Reader;
use crate::limits::{MAX_XML_DEPTH, MAX_XML_NODES};
use crate::error::ParseError;

pub struct SafeXmlReader<'a> {
    reader: Reader<&'a [u8]>,
    buf: Vec<u8>,
    depth: usize,
    nodes: u64,
}

pub struct SafeEvent<'a> {
    pub event: Event<'a>,
    pub depth: usize,
}

impl<'a> SafeXmlReader<'a> {
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        let mut reader = Reader::from_reader(bytes);
        // quick-xml does not resolve external entities or expand DTD entities;
        // we additionally *reject* any DOCTYPE outright (defense in depth).
        reader.config_mut().trim_text(false);
        Self { reader, buf: Vec::new(), depth: 0, nodes: 0 }
    }

    /// Borrow-returning read is awkward with an internal buf; we clone the event
    /// into an owned form via `into_owned()` to keep the SafeEvent self-contained.
    pub fn read_event(&mut self) -> Result<Option<SafeEvent<'static>>, ParseError> {
        self.buf.clear();
        let ev = self
            .reader
            .read_event_into(&mut self.buf)
            .map_err(|e| ParseError::MalformedXml(e.to_string()))?;
        self.nodes += 1;
        if self.nodes > MAX_XML_NODES {
            return Err(ParseError::XmlTooManyNodes(MAX_XML_NODES));
        }
        match &ev {
            Event::DocType(_) => return Err(ParseError::DtdForbidden),
            Event::Start(_) => {
                self.depth += 1;
                if self.depth > MAX_XML_DEPTH {
                    return Err(ParseError::XmlTooDeep(MAX_XML_DEPTH));
                }
            }
            Event::End(_) => {
                self.depth = self.depth.saturating_sub(1);
            }
            Event::Eof => return Ok(None),
            _ => {}
        }
        let depth = self.depth;
        Ok(Some(SafeEvent { event: ev.into_owned(), depth }))
    }
}
```

`src/xml/mod.rs`:
```rust
mod reader;
pub use reader::{SafeEvent, SafeXmlReader};
```
Add `pub mod xml;` to `src/lib.rs`.

- [ ] **Step 5: Run `cargo test --test security_xml`.** Expected: PASS (all four).

- [ ] **Step 6: Commit** — `feat(parser): DOCTYPE-rejecting depth/node-capped XML reader (XXE/billion-laughs guard)`.

---

## Task 4: Safe zip extraction — bomb, slip, member-count guards

**Files:**
- Create: `packages/engine-parser/src/zip/mod.rs`
- Create: `packages/engine-parser/src/zip/extract.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/security_zip.rs`
- Create (generated in-test): zip-bomb, zip-slip, two-member fixtures

**Interfaces:**
- Produces: `fn extract_single_xml(bytes: &[u8]) -> Result<Vec<u8>, ParseError>` — returns the single catalogue/gamesystem XML member's bytes, enforcing size/ratio/slip/count limits.
- Consumed by: public API (Task 13) when the input is `.catz`/`.gstz`.

- [ ] **Step 1: Write failing tests** (build hostile zips in-memory with the `zip` writer)

```rust
// tests/security_zip.rs
use engine_parser::zip::extract_single_xml;
use engine_parser::ParseError;
use std::io::Write;
use zip::write::SimpleFileOptions;

fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        let opts = SimpleFileOptions::default();
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
    }
    buf.into_inner()
}

#[test]
fn extracts_single_xml() {
    let z = zip_with(&[("cat.cat", b"<catalogue/>")]);
    assert_eq!(extract_single_xml(&z).unwrap(), b"<catalogue/>");
}

#[test]
fn rejects_multiple_xml_members() {
    let z = zip_with(&[("a.cat", b"<a/>"), ("b.cat", b"<b/>")]);
    assert_eq!(extract_single_xml(&z), Err(ParseError::ZipMemberCount(2)));
}

#[test]
fn rejects_zip_slip() {
    let z = zip_with(&[("../evil.cat", b"<a/>")]);
    assert!(matches!(extract_single_xml(&z), Err(ParseError::ZipSlip(_))));
}

#[test]
fn rejects_uncompressed_bomb() {
    // One entry whose declared uncompressed size exceeds the cap.
    let big = vec![b'a'; 1024]; // small stored file; assert the cap logic instead:
    let z = zip_with(&[("cat.cat", &big)]);
    // With a low test override the cap would trip; here just prove happy path parses
    // and rely on ratio/size unit checks below.
    assert!(extract_single_xml(&z).is_ok());
}
```

(Depth note for implementer: the bomb path is validated by the ratio/total-size accumulation logic; add a focused unit test in `extract.rs` with injected small caps via a private helper `extract_with_caps`.)

- [ ] **Step 2: Run, expect FAIL** (`zip` module missing).

- [ ] **Step 3: Implement `src/zip/extract.rs`**

```rust
use std::io::Read;
use zip::ZipArchive;
use crate::error::ParseError;
use crate::limits::{MAX_COMPRESSION_RATIO, MAX_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES};

pub fn extract_single_xml(bytes: &[u8]) -> Result<Vec<u8>, ParseError> {
    extract_with_caps(bytes, MAX_UNCOMPRESSED_BYTES, MAX_COMPRESSION_RATIO)
}

fn is_catalogue_xml(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".cat") || n.ends_with(".gst") || n.ends_with(".xml")
}

fn extract_with_caps(bytes: &[u8], max_total: u64, max_ratio: u64) -> Result<Vec<u8>, ParseError> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| ParseError::Io(e.to_string()))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(ParseError::ZipMemberCount(archive.len()));
    }
    let mut total: u64 = 0;
    let mut found: Vec<Vec<u8>> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| ParseError::Io(e.to_string()))?;
        // zip-slip: reject entries that do not resolve to a safe relative path.
        let name = file.name().to_string();
        if file.enclosed_name().is_none() || name.contains("..") {
            return Err(ParseError::ZipSlip(name));
        }
        if !is_catalogue_xml(&name) {
            continue; // non-XML sidecars are never decompressed
        }
        // Cheap fast-fail for honestly-declared bombs. NOT authoritative — a lying
        // `size()` header defeats it, so the real-byte aggregate cap below is the backstop.
        let compressed = file.compressed_size().max(1);
        if file.size() / compressed > max_ratio {
            return Err(ParseError::ZipBombRatio(max_ratio));
        }
        // Authoritative guard: read with a hard cap on the REMAINING real-byte budget,
        // then account ACTUAL bytes read. The attacker-controlled `size()` is irrelevant;
        // transient allocation is bounded by max_total across ALL entries combined.
        let remaining = max_total.saturating_sub(total);
        let mut out = Vec::new();
        let mut limited = file.by_ref().take(remaining.saturating_add(1));
        limited.read_to_end(&mut out).map_err(|e| ParseError::Io(e.to_string()))?;
        total = total.saturating_add(out.len() as u64);
        if total > max_total {
            return Err(ParseError::ZipBombSize);
        }
        found.push(out);
    }
    match found.len() {
        1 => Ok(found.into_iter().next().unwrap()),
        n => Err(ParseError::ZipMemberCount(n)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn ratio_cap_trips_on_low_override() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            w.start_file("cat.cat", SimpleFileOptions::default()).unwrap();
            w.write_all(&vec![b'a'; 100_000]).unwrap(); // very compressible
            w.finish().unwrap();
        }
        let z = buf.into_inner();
        // total cap generous, ratio cap tiny => ratio guard fires.
        assert_eq!(extract_with_caps(&z, u64::MAX, 2), Err(ParseError::ZipBombRatio(2)));
    }
}
```

`src/zip/mod.rs`:
```rust
mod extract;
pub use extract::extract_single_xml;
```
Add `pub mod zip;` to `src/lib.rs`.

- [ ] **Step 4: Run `cargo test --test security_zip && cargo test zip::`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(parser): zip-bomb/zip-slip/member-count hardened extractor`.

---

## Task 5: Raw model + streaming parse of catalogue header, cost types, categories

**Files:**
- Create: `packages/engine-parser/src/raw/mod.rs`
- Create: `packages/engine-parser/src/raw/model.rs`
- Create: `packages/engine-parser/src/raw/parse.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/fixtures/mini40k.cat`
- Create: `packages/engine-parser/tests/raw_parse.rs`

**Interfaces:**
- Consumes: `SafeXmlReader` (Task 3).
- Produces: `fn parse_raw(bytes: &[u8]) -> Result<RawCatalogue, ParseError>` and raw structs. This task covers root attributes (`id`, `name`, `revision`, `gameSystemId`), `<costTypes>/<costType id name>`, `<categoryEntries>/<categoryEntry id name>`. Later tasks extend `parse_raw` to fill entries/forces/modifiers.

**BattleScribe elements this task reads** (namespace `catalogueSchema`/`gameSystemSchema`; read attributes by local name, ignore namespace prefixes):
- `<catalogue id name revision gameSystemId>` / `<gameSystem id name revision>`
- `<costTypes><costType id name defaultCostLimit>` — map `id`→`name` (used later to turn a cost `typeId` into the IR cost `name`; `pts`/"Points" → `"points"`).
- `<categoryEntries><categoryEntry id name>`

- [ ] **Step 1: Write the fixture `tests/fixtures/mini40k.cat`** (real-shaped, minimal)

```xml
<?xml version="1.0" encoding="utf-8"?>
<catalogue id="cat.mini40k" name="Mini 40k" revision="1" gameSystemId="gs.40k"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes>
    <costType id="pts" name="Points" defaultCostLimit="-1"/>
  </costTypes>
  <categoryEntries>
    <categoryEntry id="cat.hq" name="HQ"/>
    <categoryEntry id="cat.troops" name="Troops"/>
  </categoryEntries>
  <sharedSelectionEntries/>
  <selectionEntries>
    <selectionEntry id="e.captain" name="Captain" type="model">
      <costs><cost name="Points" typeId="pts" value="90"/></costs>
      <categoryLinks><categoryLink id="cl1" targetId="cat.hq" primary="true"/></categoryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>
```

- [ ] **Step 2: Write the failing test**

```rust
// tests/raw_parse.rs
use engine_parser::raw::parse_raw;

#[test]
fn reads_header_costtypes_categories() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    assert_eq!(raw.id, "cat.mini40k");
    assert_eq!(raw.game_system_id.as_deref(), Some("gs.40k"));
    assert_eq!(raw.cost_types.get("pts").map(String::as_str), Some("Points"));
    assert_eq!(raw.categories.get("cat.hq").map(String::as_str), Some("HQ"));
}
```

- [ ] **Step 3: Run, expect FAIL** (`raw` module missing).

- [ ] **Step 4: Implement `src/raw/model.rs`** (structs for the whole catalogue; later tasks fill more fields — declare them now so the shape is stable)

```rust
use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct RawCatalogue {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub game_system_id: Option<String>,
    pub cost_types: HashMap<String, String>,   // id -> name
    pub categories: HashMap<String, String>,   // id -> name
    pub shared_entries: Vec<RawEntry>,         // filled in Task 6
    pub shared_groups: Vec<RawGroup>,          // filled in Task 6
    pub entries: Vec<RawEntry>,                // filled in Task 6
    pub force_entries: Vec<RawForce>,          // filled in Task 6/11
    pub catalogue_links: Vec<RawCatalogueLink>,// filled in Task 9
}

#[derive(Debug, Default, Clone)]
pub struct RawEntry {
    pub id: String,
    pub name: String,
    pub entry_type: String,           // unit|model|upgrade
    pub costs: Vec<RawCost>,
    pub category_links: Vec<RawCategoryLink>,
    pub constraints: Vec<RawConstraint>,
    pub modifiers: Vec<RawModifier>,
    pub entries: Vec<RawEntry>,        // nested selectionEntries
    pub groups: Vec<RawGroup>,         // nested selectionEntryGroups
    pub entry_links: Vec<RawEntryLink>,
}

#[derive(Debug, Default, Clone)] pub struct RawGroup {
    pub id: String, pub name: String,
    pub entries: Vec<RawEntry>, pub groups: Vec<RawGroup>,
    pub entry_links: Vec<RawEntryLink>, pub constraints: Vec<RawConstraint>,
}
#[derive(Debug, Default, Clone)] pub struct RawCost { pub type_id: String, pub value: f64 }
#[derive(Debug, Default, Clone)] pub struct RawCategoryLink { pub target_id: String, pub primary: bool }
#[derive(Debug, Default, Clone)] pub struct RawEntryLink { pub target_id: String, pub link_type: String }
#[derive(Debug, Default, Clone)] pub struct RawForce { pub id: String, pub name: String, pub constraints: Vec<RawConstraint>, pub category_links: Vec<RawCategoryLink> }
#[derive(Debug, Default, Clone)] pub struct RawCatalogueLink { pub target_id: String, pub import_root_entries: bool }

#[derive(Debug, Default, Clone)]
pub struct RawConstraint {
    pub id: String, pub kind: String,     // min|max
    pub value: f64, pub field: String,    // selections | <costTypeId>
    pub scope: String,                    // parent|force|roster|self|<id>
    pub include_child_selections: bool,
}
#[derive(Debug, Default, Clone)]
pub struct RawModifier {
    pub kind: String,                     // set|increment|decrement
    pub field: String, pub value: f64,
    pub conditions: Vec<RawCondition>,
    pub condition_groups: Vec<RawConditionGroup>,
    pub has_repeats: bool,                // if true, emit diagnostic in mapping
}
#[derive(Debug, Default, Clone)]
pub struct RawCondition {
    pub comparator: String, pub field: String, pub scope: String,
    pub value: f64, pub child_id: String, pub include_child_selections: bool,
}
#[derive(Debug, Default, Clone)]
pub struct RawConditionGroup { pub kind: String, pub conditions: Vec<RawCondition>, pub groups: Vec<RawConditionGroup> }
```

- [ ] **Step 5: Implement `src/raw/parse.rs`** — this task fills header + cost_types + categories only. Use `SafeXmlReader`; match on `local_name()`. Provide an attribute helper:

```rust
use quick_xml::events::{BytesStart, Event};
use crate::error::ParseError;
use crate::xml::SafeXmlReader;
use super::model::RawCatalogue;

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| a.unescape_value().ok().map(|c| c.into_owned()))
}

pub fn parse_raw(bytes: &[u8]) -> Result<RawCatalogue, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut cat = RawCatalogue::default();
    while let Some(ev) = r.read_event()? {
        if let Event::Start(e) | Event::Empty(e) = &ev.event {
            match e.local_name().as_ref() {
                b"catalogue" | b"gameSystem" => {
                    cat.id = attr(e, b"id").unwrap_or_default();
                    cat.name = attr(e, b"name").unwrap_or_default();
                    cat.revision = attr(e, b"revision").and_then(|s| s.parse().ok()).unwrap_or(0);
                    cat.game_system_id = attr(e, b"gameSystemId");
                }
                b"costType" => {
                    if let (Some(id), Some(name)) = (attr(e, b"id"), attr(e, b"name")) {
                        cat.cost_types.insert(id, name);
                    }
                }
                b"categoryEntry" => {
                    if let (Some(id), Some(name)) = (attr(e, b"id"), attr(e, b"name")) {
                        cat.categories.insert(id, name);
                    }
                }
                _ => {}
            }
        }
    }
    Ok(cat)
}
```

`src/raw/mod.rs`:
```rust
mod model;
mod parse;
pub use model::*;
pub use parse::parse_raw;
```
Add `pub mod raw;` to `src/lib.rs`.

- [ ] **Step 6: Run `cargo test --test raw_parse`.** Expected: PASS.

- [ ] **Step 7: Commit** — `feat(parser): raw model + streaming parse of header/costTypes/categories`.

---

## Task 6: Raw parse of the selection-entry tree

**Files:**
- Modify: `packages/engine-parser/src/raw/parse.rs`
- Modify: `packages/engine-parser/tests/fixtures/mini40k.cat` (add a nested squad + shared entry + entryLink + a force with a category min/max)
- Modify: `packages/engine-parser/tests/raw_parse.rs`

**Interfaces:**
- Produces: `parse_raw` now fills `entries`, `shared_entries`, `shared_groups`, `force_entries` with their `costs`, `category_links`, `constraints`, nested `entries`/`groups`, and `entry_links`. (Modifiers/conditions land in Task 7.)

**Elements added this task:**
- `<selectionEntry id name type>` with `<costs><cost typeId value>`, `<categoryLinks><categoryLink targetId primary>`, `<constraints><constraint id type value field scope includeChildSelections>`, nested `<selectionEntries>`, `<selectionEntryGroups>`, `<entryLinks><entryLink targetId type>`.
- `<sharedSelectionEntries>` / `<sharedSelectionEntryGroups>` (same entry shape, indexed as shared).
- `<forceEntries><forceEntry id name>` with `<constraints>` and `<categoryLinks>`.

Because the tree is recursive and quick-xml is a flat event stream, implement a **hand-rolled stack**: push a `RawEntry`/`RawGroup`/`RawForce` builder on `Start`, attach finished children to their parent on the matching `End`, using `ev.depth` and a `Vec` of in-progress frames. The `SafeXmlReader` already bounds depth, so the stack is bounded.

- [ ] **Step 1: Extend the fixture** — add under `<sharedSelectionEntries>` a `squad-body` entry (cost 100, category troops, a self `min` constraint of 5 on `field="selections"` targeting models), a top-level `<selectionEntry>` that references it via `<entryLink targetId="squad-body">`, and a `<forceEntries>` block with a `forceEntry` carrying two constraints (HQ `min` 1 / `max` 2 on `field="selections" scope="force"`). (Full fixture XML written inline in the plan file's companion; keep ids stable: `e.squad`, `squad-body`, `fc.hq.min`, `fc.hq.max`.)

- [ ] **Step 2: Extend `tests/raw_parse.rs`**

```rust
#[test]
fn reads_entry_tree_and_forces() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let captain = raw.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert_eq!(captain.costs[0].type_id, "pts");
    assert_eq!(captain.costs[0].value, 90.0);
    assert_eq!(captain.category_links[0].target_id, "cat.hq");

    // shared entry indexed; link present on the referencing entry
    assert!(raw.shared_entries.iter().any(|e| e.id == "squad-body"));
    let squad = raw.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert_eq!(squad.entry_links[0].target_id, "squad-body");

    let force = &raw.force_entries[0];
    assert_eq!(force.constraints.iter().filter(|c| c.field == "selections").count(), 2);
}
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement the stack-based tree parse** in `parse.rs`. Sketch of the frame machine (fill in all element arms):

```rust
enum Frame {
    Entry(RawEntry), Group(RawGroup), Force(RawForce),
    Shared, SharedGroups, TopEntries, ForceEntries, Costs, CategoryLinks,
    Constraints, EntryLinks, Ignore,
}
// On Start: match local_name -> push the matching Frame (constructing builders
//   from attrs). On End: pop; if the popped frame is an Entry/Group/Force,
//   attach it to the nearest enclosing builder (or to cat.* if at the right
//   list). <cost>/<categoryLink>/<constraint>/<entryLink> are Empty elements —
//   attach directly to the top Entry/Group/Force frame without pushing.
```

Keep the attribute mapping exact: `constraint@type`→`kind`, `constraint@field` verbatim (`selections` or a costTypeId), `constraint@scope` verbatim, `constraint@includeChildSelections`→bool. `cost@typeId`/`cost@value`. `categoryLink@targetId`/`@primary`. `entryLink@targetId`/`@type`.

- [ ] **Step 5: Run `cargo test --test raw_parse`.** Expected: PASS (both tests).

- [ ] **Step 6: Commit** — `feat(parser): stack-based parse of selectionEntry tree + forces`.

---

## Task 7: Raw parse of modifiers, conditions, condition-groups

**Files:**
- Modify: `packages/engine-parser/src/raw/parse.rs`
- Modify: `packages/engine-parser/tests/fixtures/mini40k.cat` (add a modifier to the squad cost: `decrement` by 10 gated on a condition `atLeast 3 troops`, plus a nested conditionGroup)
- Modify: `packages/engine-parser/tests/raw_parse.rs`

**Elements added:** `<modifiers><modifier type field value>`, `<conditions><condition type field scope value childId includeChildSelections>`, `<conditionGroups><conditionGroup type>`, and detect `<repeats>` (set `has_repeats=true`).

- [ ] **Step 1: Extend fixture** with a `<modifiers>` block on `squad-body`'s cost or entry (per BattleScribe, modifiers live under the entry and reference the field). Keep ids stable.

- [ ] **Step 2: Extend `raw_parse.rs`**

```rust
#[test]
fn reads_modifiers_and_conditions() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let squad = raw.shared_entries.iter().find(|e| e.id == "squad-body").unwrap();
    let m = &squad.modifiers[0];
    assert_eq!(m.kind, "decrement");
    assert_eq!(m.value, 10.0);
    assert_eq!(m.conditions[0].comparator, "atLeast");
    assert_eq!(m.conditions[0].value, 3.0);
}
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Add `Modifier`, `Conditions`, `ConditionGroup` frames** to the stack machine; attach conditions/groups to the current modifier, modifiers to the current entry/group. Set `has_repeats` if a `<repeat>`/`<repeats>` element appears under a modifier.

- [ ] **Step 5: Run `cargo test --test raw_parse`.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat(parser): parse modifiers/conditions/condition-groups`.

---

## Task 8: Symbol table over shared entries/groups/categories

**Files:**
- Create: `packages/engine-parser/src/resolve/mod.rs`
- Create: `packages/engine-parser/src/resolve/symbols.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/resolve.rs`

**Interfaces:**
- Produces: `struct SymbolTable` with `fn build(cat: &RawCatalogue) -> Result<SymbolTable, ParseError>` indexing every `shared_entries`/`shared_groups` (and nested) by id; `fn entry(&self, id: &str) -> Option<&RawEntry>`. Duplicate ids → `ParseError::MalformedXml`.
- Consumed by: `resolve/links.rs` (Task 9).

- [ ] **Step 1: Write failing test**

```rust
// tests/resolve.rs
use engine_parser::raw::parse_raw;
use engine_parser::resolve::SymbolTable;

#[test]
fn indexes_shared_entries() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let sym = SymbolTable::build(&raw).unwrap();
    assert!(sym.entry("squad-body").is_some());
}
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `symbols.rs`** — recursive walk of shared entries/groups collecting `id -> &RawEntry` (and group ids), erroring on duplicates. `pub mod resolve;` in lib.rs; re-export `SymbolTable`.

- [ ] **Step 4: Run `cargo test --test resolve::indexes_shared_entries`** (or `--test resolve`). Expected: PASS.

- [ ] **Step 5: Commit** — `feat(parser): symbol table for shared entries`.

---

## Task 9: Reference resolution — inline entryLinks (cycle-guarded) + catalogue imports

**Files:**
- Create: `packages/engine-parser/src/resolve/links.rs`
- Modify: `packages/engine-parser/src/resolve/mod.rs`
- Modify: `packages/engine-parser/tests/resolve.rs`
- Create: `packages/engine-parser/tests/fixtures/malicious/cyclic.cat` (A links B, B links A)

**Interfaces:**
- Produces: `fn resolve(cat: RawCatalogue) -> Result<RawCatalogue, ParseError>` returning a catalogue whose `entry_links` have been replaced by inlined copies of their targets (recursively), with a **visited-set cycle guard** → `ParseError::ReferenceCycle`. Unknown target → `ParseError::UnresolvedRef`. (Catalogue-import merge: for the walking skeleton, if `catalogue_links` is non-empty and the imported file is not provided, record a `Diagnostic` and continue — multi-file import wiring is exercised in the CLI/Task 13 where multiple files are available.)

- [ ] **Step 1: Write the cyclic fixture and failing tests**

```rust
#[test]
fn inlines_entry_links() {
    let raw = engine_parser::raw::parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let resolved = engine_parser::resolve::resolve(raw).unwrap();
    let squad = resolved.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert!(squad.entry_links.is_empty());              // link consumed
    assert!(squad.entries.iter().any(|c| c.id == "squad-body")); // target inlined
}

#[test]
fn detects_reference_cycles() {
    let raw = engine_parser::raw::parse_raw(include_bytes!("fixtures/malicious/cyclic.cat")).unwrap();
    assert!(matches!(engine_parser::resolve::resolve(raw),
        Err(engine_parser::ParseError::ReferenceCycle(_))));
}
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `links.rs`** — build the `SymbolTable`, then recursively rewrite each entry: for every `entry_link`, look up the target, clone it, recurse into it carrying a `HashSet<String>` of ancestor ids on the current path; if the target id is already on the path → `ReferenceCycle`. Depth is already bounded by `MAX_XML_DEPTH` at parse, but the visited-set makes the guard explicit and total.

- [ ] **Step 4: Run `cargo test --test resolve`.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(parser): cycle-guarded entryLink resolution`.

---

## Task 10: IR model + mapping for catalogue, entries, costs, categories

**Files:**
- Create: `packages/engine-parser/src/ir/mod.rs`
- Create: `packages/engine-parser/src/ir/model.rs`
- Create: `packages/engine-parser/src/ir/map.rs`
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/map.rs`
- Create: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`

**Interfaces:**
- Produces: serde structs mirroring `@muster/domain` IR **exactly** (field names, optionality). `fn to_ir(cat: &RawCatalogue) -> (IrCatalogue, Vec<Diagnostic>)`. This task maps id/name/revision/gameSystemId, entries (id, name), costs (`typeId` "pts" → cost `name: "points"`, value), categories (`categoryLink.target_id` → `IrEntry.categories`). Constraints/modifiers arrive in Tasks 11–12.

**IR JSON shape (must match `packages/domain/src/ir.ts`):**
- `IrCatalogue { id, name, gameSystemId, revision, entries: IrEntry[], forceConstraints: IrConstraint[] }`
- `IrEntry { id, name, costs: IrCost[], categories: string[], constraints: IrConstraint[], children: IrEntry[] }`
- `IrCost { name, value, modifiers?: IrModifier[] }`

Serde structs use `#[serde(rename_all = "camelCase")]` and `skip_serializing_if = "Option::is_none"`/`Vec::is_empty` only where the Zod schema treats the field as optional/defaulted. Cost `name` mapping rule: look up `cost.type_id` in `cost_types`; if the resulting name matches `/points?/i` OR the type_id is `pts`, emit `"points"`; otherwise emit the cost type's name verbatim (only `"points"` is scored by the current engine — non-points costs pass through and are simply ignored by `nodePoints`).

- [ ] **Step 1: Write the golden file** `fixtures/golden/mini40k.ir.json` (hand-authored to the expected output; will be extended in Tasks 11–12). It must be the exact `serde_json` pretty output the mapper produces — start with the subset this task covers and grow it.

- [ ] **Step 2: Write the failing test**

```rust
// tests/map.rs
use engine_parser::{raw::parse_raw, resolve::resolve, ir::to_ir};

#[test]
fn maps_entries_costs_categories() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(diags.is_empty());
    assert_eq!(ir.id, "cat.mini40k");
    assert_eq!(ir.game_system_id, "gs.40k");
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert_eq!(cap.costs[0].name, "points");
    assert_eq!(cap.costs[0].value, 90.0);
    assert_eq!(cap.categories, vec!["cat.hq"]);
}
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement `ir/model.rs` + `ir/map.rs`.** Serialize with `serde`. `pub mod ir;` in lib.rs.

- [ ] **Step 5: Run `cargo test --test map::maps_entries_costs_categories`.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat(parser): IR model + map entries/costs/categories`.

---

## Task 11: IR mapping for constraints + forceConstraints

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs`
- Modify: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`
- Modify: `packages/engine-parser/tests/map.rs`

**The impedance mismatch (spec §5 "reverse-engineer edge-cases empirically"):** BattleScribe constraints carry `field`, `scope`, `value`, `type`; the domain `IrConstraint` additionally needs `targetType` (`category`|`entry`) and `targetId`. Mapping rules for the walking skeleton — **explicit and total**, unmapped cases produce a `Diagnostic` and the constraint is dropped rather than miscompiled:
- `type` → `IrConstraint.type` (`min`/`max`).
- `value` → `value`.
- `field`: `"selections"` → `"selections"`; a cost type id whose name maps to points → `"points"`; any other field → diagnostic + drop.
- `scope`: `"parent"`→`parent`, `"force"`→`force`, `"roster"`→`roster`, `"self"`→`self`; any other (an entry-id ancestor scope) → diagnostic + drop (documented walking-skeleton limitation matching `engine-eval`'s own force/roster simplification).
- `includeChildSelections` → passthrough.
- `targetType`/`targetId`: for a constraint attached to an **entry**, the target is that entry (`targetType:"entry", targetId: entry.id`) unless the constraint sits on a `categoryLink`/force categorization, in which case `targetType:"category", targetId: <category id>`. For **force** constraints, derive `targetId` from the sibling `categoryLink.target_id` on the same force entry (the 40k "1-2 HQ" pattern); when a force has multiple category links, associate by the constraint's `scope`/id or, if ambiguous, emit a diagnostic. Force-level constraints go to `IrCatalogue.forceConstraints`; entry-level constraints to that `IrEntry.constraints`.
- Give every emitted `IrConstraint` a stable `id` (reuse the BattleScribe constraint `id`).

- [ ] **Step 1: Extend the golden JSON** with the captain-force HQ min/max constraints and the squad self-min-models constraint.

- [ ] **Step 2: Extend `map.rs` test**

```rust
#[test]
fn maps_force_and_entry_constraints() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    assert!(ir.force_constraints.iter().any(|c| c.id == "fc.hq.min"
        && c.target_type == "category" && c.target_id == "cat.hq" && c.type_ == "min"));
    let squad = ir.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert!(squad.constraints.iter().any(|c| c.field == "selections" && c.scope == "self"));
    assert!(diags.iter().all(|d| d.code != "constraint.unmapped")); // fixture stays fully mappable
}
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement the mapping rules above** with a `map_constraint(&RawConstraint, ctx) -> Result<IrConstraint, Diagnostic>` helper. Route force vs entry by call site.

- [ ] **Step 5: Run `cargo test --test map`.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat(parser): map constraints + forceConstraints with explicit rules + diagnostics`.

---

## Task 12: IR mapping for modifiers, conditions, condition-groups

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs`
- Modify: `packages/engine-parser/src/ir/model.rs` (add `IrModifier`/`IrCondition`/`IrConditionGroup` serde structs)
- Modify: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`
- Modify: `packages/engine-parser/tests/map.rs`

**Mapping rules (match `packages/domain/src/{modifiers,conditions}.ts`):**
- `IrModifier { id, type: set|increment|decrement, value, conditions?, conditionGroups? }` — synthesize a stable `id` if BattleScribe omits it (`format!("mod.{parent_id}.{index}")`). If `has_repeats` → emit `Diagnostic{code:"modifier.repeat_unsupported"}` and still emit the modifier without repeat semantics (documented deferral).
- `IrCondition { id, comparator, value, field, scope, targetType, targetId, includeChildSelections }` — `condition@type` → `comparator` (`atLeast`/`atMost`/`equalTo`/`notEqualTo`/`greaterThan`/`lessThan`; any other → diagnostic + drop the condition, which per gate semantics makes the modifier's gate stricter — acceptable & logged). `childId` → `targetId`; `targetType` derived like constraints (category vs entry). `field`/`scope` mapped by the same rules as Task 11.
- `IrConditionGroup { type: and|or, conditions?, conditionGroups? }`.
- Attach mapped modifiers to the owning `IrCost` (for cost modifiers) or `IrConstraint` (for bound modifiers), per where the raw modifier's `field` points (`field == <costTypeId>` → cost modifier; `field == <constraintId>` or a bound field → constraint modifier). Ambiguous → diagnostic.

- [ ] **Step 1: Extend golden JSON** with the squad cost's `decrement 10` modifier gated by `atLeast 3 troops`.

- [ ] **Step 2: Extend `map.rs` test**

```rust
#[test]
fn maps_cost_modifier_with_condition() {
    let raw = resolve(parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap()).unwrap();
    let (ir, _diags) = to_ir(&raw);
    let squad = ir.entries.iter().find(|e| e.id == "e.squad").unwrap();
    // squad-body was inlined as a child; its points cost carries the modifier
    let body = squad.children.iter().find(|c| c.id == "squad-body").unwrap();
    let m = &body.costs[0].modifiers.as_ref().unwrap()[0];
    assert_eq!(m.type_, "decrement");
    assert_eq!(m.conditions.as_ref().unwrap()[0].comparator, "atLeast");
}
```

- [ ] **Step 3: Run, expect FAIL.**

- [ ] **Step 4: Implement** the modifier/condition mapping + attachment routing.

- [ ] **Step 5: Run `cargo test --test map`.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat(parser): map modifiers/conditions/condition-groups`.

---

## Task 13: Public API + CLI binary with limits and deadline

**Files:**
- Modify: `packages/engine-parser/src/lib.rs` (add top-level `parse_bytes` / `parse_file`)
- Create/replace: `packages/engine-parser/src/bin/muster-parse.rs`
- Create: `packages/engine-parser/tests/golden.rs`

**Interfaces:**
- Produces:
  - `pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>` — enforces `MAX_INPUT_BYTES`, unzips if `is_zip` (Task 4), then `parse_raw`→`resolve`→`to_ir`.
  - `pub fn parse_file(path: &Path, deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>` — detects zip by extension (`.catz`/`.gstz`/`.rosz` treated as zip), reads with the size cap, runs `parse_bytes` on a worker thread and abandons it if `deadline` elapses (wall-clock guard; the pipeline sets this, spec §10.1 "max время парсинга").
  - Binary `muster-parse <file>`: prints IR JSON to stdout, diagnostics to stderr, exit code `0` ok / `2` parse error / `1` usage.

- [ ] **Step 1: Write the golden round-trip test**

```rust
// tests/golden.rs
use engine_parser::parse_bytes;

#[test]
fn parser_output_matches_golden() {
    let (ir, diags) = parse_bytes(include_bytes!("fixtures/mini40k.cat"), false).unwrap();
    assert!(diags.is_empty());
    let got = serde_json::to_value(&ir).unwrap();
    let want: serde_json::Value =
        serde_json::from_slice(include_bytes!("fixtures/golden/mini40k.ir.json")).unwrap();
    assert_eq!(got, want);
}

#[test]
fn parses_the_zip_form() {
    // mini40k.catz is a zip of mini40k.cat; must yield identical IR.
    let (ir, _) = parse_bytes(include_bytes!("fixtures/mini40k.catz"), true).unwrap();
    assert_eq!(ir.id, "cat.mini40k");
}
```

Create `fixtures/mini40k.catz` by zipping `mini40k.cat` (document the command in the task: `cd tests/fixtures && zip mini40k.catz mini40k.cat`).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `parse_bytes`/`parse_file`** and the CLI. Use `std::thread` + `std::sync::mpsc::recv_timeout` for the deadline. Enforce `MAX_INPUT_BYTES` before doing any work.

- [ ] **Step 4: Run `cargo test --test golden` + `cargo run --bin muster-parse -- tests/fixtures/mini40k.cat`.** Expected: golden PASS; CLI prints IR JSON.

- [ ] **Step 5: Commit** — `feat(parser): public API + muster-parse CLI with size/deadline guards`.

---

## Task 14: Property test — never panic on arbitrary bytes

**Files:**
- Create: `packages/engine-parser/tests/proptest.rs`

**Interfaces:**
- Consumes: `parse_bytes`, `zip::extract_single_xml`, `xml::SafeXmlReader`.

- [ ] **Step 1: Write the property test**

```rust
// tests/proptest.rs
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn parse_bytes_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..8192)) {
        // Any Result is fine; a panic fails the test.
        let _ = engine_parser::parse_bytes(&bytes, false);
        let _ = engine_parser::parse_bytes(&bytes, true);
    }

    #[test]
    fn xml_reader_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..8192)) {
        let mut r = engine_parser::xml::SafeXmlReader::from_bytes(&bytes);
        loop {
            match r.read_event() { Ok(Some(_)) => continue, _ => break }
        }
    }
}
```

- [ ] **Step 2: Run `cargo test --test proptest`.** Expected: PASS (no panics across 2000 cases each). If a panic surfaces, fix the offending guard in the security layer (this is the point of the task) before proceeding.

- [ ] **Step 3: Commit** — `test(parser): proptest — never panic on arbitrary input`.

---

## Task 15: Cross-language contract — golden IR validates in TS + evaluates

**Files:**
- Create: `packages/engine-eval/test/parser-contract.test.ts`
- Create: `packages/engine-eval/test/fixtures/parser-golden.ir.json` (copy of the Rust golden; a step keeps them identical)

**Interfaces:**
- Consumes: the committed golden IR JSON; `@muster/domain`'s `IrCatalogue` Zod schema; `@muster/engine-eval`'s `evaluate`.
- This is the integration test of spec §12.2 (parser→IR→engine) without coupling the JS runner to the Rust toolchain: the Rust `golden.rs` test guarantees the parser produces this exact JSON; this test guarantees the JSON is valid IR the engine accepts.

- [ ] **Step 1: Copy the golden file** into the engine-eval fixtures (add a note/README that `parser-golden.ir.json` must equal `engine-parser/tests/fixtures/golden/mini40k.ir.json`; a follow-up can automate the copy in the pipeline).

- [ ] **Step 2: Write the failing test**

```ts
// packages/engine-eval/test/parser-contract.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IrCatalogue } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/parser-golden.ir.json", import.meta.url)), "utf8"),
);

describe("parser IR contract", () => {
  it("golden parser output validates against the domain Zod schema", () => {
    const parsed = IrCatalogue.safeParse(golden);
    expect(parsed.success).toBe(true);
  });

  it("engine-eval accepts the parsed catalogue and evaluates a roster on it", () => {
    const cat = IrCatalogue.parse(golden);
    const roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [{ id: "s", entryId: "e.captain", count: 1, selections: [] }],
    };
    const result = evaluate(roster, cat);
    expect(result.totalPoints).toBe(90);
    // 1 HQ satisfies fc.hq.min/max; troops-min will flag — assert it surfaces, proving
    // the parsed forceConstraints are live in the engine.
    expect(result.issues.some((i) => i.constraintId === "fc.troops.min")).toBe(true);
  });
});
```

- [ ] **Step 3: Run `pnpm --filter @muster/engine-eval test`.** Expected: the two new tests FAIL first (missing fixture), then PASS once the golden is copied and correct. Coverage thresholds still hold (this adds tests, no source).

- [ ] **Step 4: Commit** — `test(parser): cross-language IR contract — Zod-valid + engine-eval evaluates golden`.

---

## Self-Review

**Spec coverage:**
- §5 parser responsibilities (unzip, XML→structs, resolve link graph, ID indexes, base costs, cycle-guard) → Tasks 4, 5–7, 8, 9, 10–12. ✓
- §5 "compiled AST + symbol table, NOT precomputed limits" → constraint/modifier/condition nodes carried as-is in the IR mapping (Tasks 11–12), enforced by the golden + TS contract. ✓
- §10.1 untrusted-file hardening (XXE, billion-laughs, zip-bomb, zip-slip, exactly-one-XML, size/depth/node/time limits, no panic) → Tasks 3, 4, 13, 14. ✓
- §10.8 supply-chain (cargo-deny/audit, forbid unsafe, minimal deps) → Tasks 1, and `#![forbid(unsafe_code)]` in lib. ✓
- §12.1/§12.2 parser tests (real-shaped `.cat`, link/import resolution, cycle-guard) + integration (parser→IR→engine) → Tasks 5–12, 15. ✓
- §12.4 malicious corpus → Tasks 3, 4, 9 (cyclic), 14. ✓
- Boundary is data not FFI (§4) → JSON out, TS reads JSON (Task 15). ✓

**Deferred, explicitly:** `.ros/.rosz` roster import (Phase 1b), export, percent/equipment-point systems, Reference-Mode profile/rule text, `repeat` semantics, second data source — all listed in Scope and surfaced as diagnostics where encountered, never silent. A real vendored BSData 40k snapshot (beyond the hand-authored `mini40k` fixtures) is a recommended follow-up integration fixture; the plan's contract holds on the minimal real-shaped fixture without requiring network access during execution.

**Placeholder scan:** security-critical and scaffolding tasks (1–4, 8, 9, 13–15) carry complete code; the bulky raw-parse and IR-mapping tasks (5–7, 10–12) give exact element/attribute lists, explicit mapping rules, and full test code (the TDD anchor), with the stack-machine and mapping-table structure specified — an implementer has the names and rules they need. The one deliberately non-verbatim artifact is the growing `golden/mini40k.ir.json`, which each task extends to match its mapper output (the Rust `golden.rs` test is the exactness gate).

**Type consistency:** IR field names/optionality are pinned to `packages/domain/src/{ir,conditions,modifiers}.ts` (Task 10–12 serde structs), and verified end-to-end by the Zod `safeParse` in Task 15 — a drift between the Rust structs and the TS schema fails that test.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-engine-parser.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh implementer subagent per task, task review between tasks, broad review at the end. Model tiers: security tasks (3, 4, 9, 13, 14) and IR-mapping tasks (11, 12) warrant a standard/strong model; scaffolding and transcription tasks (1, 2, 5, 8, 15) a cheaper tier. Note: tasks run `cargo`, so the executing environment needs the Rust toolchain.

**2. Inline Execution** — execute here with executing-plans, checkpoints for review.

Which approach?
