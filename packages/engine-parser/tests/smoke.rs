#[test]
fn crate_exposes_version() {
    assert_eq!(engine_parser::VERSION, env!("CARGO_PKG_VERSION"));
}
