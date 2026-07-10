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
