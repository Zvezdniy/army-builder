use engine_parser::raw::parse_raw;
use engine_parser::resolve::resolve;
use engine_parser::resolve::SymbolTable;

#[test]
fn indexes_shared_entries() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let sym = SymbolTable::build(&raw).unwrap();
    assert!(sym.entry("squad-body").is_some());
    // nested child of the shared entry is also indexed
    assert!(sym.entry("squad-body.model").is_some());
}

#[test]
fn inlines_entry_links() {
    let raw = parse_raw(include_bytes!("fixtures/mini40k.cat")).unwrap();
    let resolved = resolve(raw).unwrap();
    let squad = resolved.entries.iter().find(|e| e.id == "e.squad").unwrap();
    assert!(squad.entry_links.is_empty()); // link consumed
    assert!(squad.entries.iter().any(|c| c.id == "squad-body")); // target inlined as a child
}

#[test]
fn detects_reference_cycles() {
    let raw = parse_raw(include_bytes!("fixtures/malicious/cyclic.cat")).unwrap();
    assert!(matches!(
        resolve(raw),
        Err(engine_parser::ParseError::ReferenceCycle(_))
    ));
}
