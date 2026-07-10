use engine_parser::raw::parse_raw;
use engine_parser::resolve::SymbolTable;

#[test]
fn indexes_shared_entries() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let sym = SymbolTable::build(&raw).unwrap();
    assert!(sym.entry("squad-body").is_some());
    // nested child of the shared entry is also indexed
    assert!(sym.entry("squad-body.model").is_some());
}
