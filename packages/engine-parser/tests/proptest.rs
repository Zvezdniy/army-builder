use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2000))]

    #[test]
    fn parse_bytes_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..8192)) {
        // Any Result (Ok or Err) is acceptable; a panic fails the test.
        let _ = engine_parser::parse_bytes(&bytes, false);
        let _ = engine_parser::parse_bytes(&bytes, true);
    }

    #[test]
    fn xml_reader_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..8192)) {
        let mut r = engine_parser::xml::SafeXmlReader::from_bytes(&bytes);
        loop {
            match r.read_event() {
                Ok(Some(_)) => continue,
                _ => break,
            }
        }
    }
}
