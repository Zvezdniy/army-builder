use engine_parser::parse_bytes;

#[test]
fn parser_output_matches_golden() {
    let (ir, _diags) = parse_bytes(include_bytes!("fixtures/mini40k.cat"), false).unwrap();
    let got = serde_json::to_value(&ir).unwrap();
    let want: serde_json::Value =
        serde_json::from_slice(include_bytes!("fixtures/golden/mini40k.ir.json")).unwrap();
    assert_eq!(got, want, "parser output drifted from committed golden");
}

#[test]
fn parses_the_zip_form_identically() {
    let (from_xml, _) = parse_bytes(include_bytes!("fixtures/mini40k.cat"), false).unwrap();
    let (from_zip, _) = parse_bytes(include_bytes!("fixtures/mini40k.catz"), true).unwrap();
    assert_eq!(
        serde_json::to_value(&from_xml).unwrap(),
        serde_json::to_value(&from_zip).unwrap()
    );
}
