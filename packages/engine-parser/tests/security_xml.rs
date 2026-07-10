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
