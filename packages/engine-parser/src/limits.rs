//! Resource limits for untrusted input (spec §10.1). Binding values.
pub const MAX_INPUT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_COMPRESSION_RATIO: u64 = 100;
pub const MAX_XML_DEPTH: usize = 256;
pub const MAX_XML_NODES: u64 = 5_000_000;
pub const MAX_ZIP_ENTRIES: usize = 64;

/// Cap on entries produced by reference resolution. entryLink inlining can
/// amplify a small file into an exponentially large tree via acyclic diamonds
/// (a billion-laughs analogue); this bounds it.
pub const MAX_RESOLVED_NODES: u64 = 5_000_000;
/// Cap on entryLink-traversal recursion depth, independent of MAX_XML_DEPTH
/// (which only bounds the raw parsed tree). Prevents native stack overflow on a
/// long linear link chain.
pub const MAX_RESOLVE_DEPTH: usize = 256;
