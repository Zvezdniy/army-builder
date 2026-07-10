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
