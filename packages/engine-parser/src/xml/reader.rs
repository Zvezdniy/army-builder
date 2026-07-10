use quick_xml::events::Event;
use quick_xml::Reader;
use crate::limits::{MAX_XML_DEPTH, MAX_XML_NODES};
use crate::error::ParseError;

pub struct SafeXmlReader<'a> {
    reader: Reader<&'a [u8]>,
    buf: Vec<u8>,
    depth: usize,
    nodes: u64,
    max_depth: usize,
    max_nodes: u64,
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
        Self {
            reader,
            buf: Vec::new(),
            depth: 0,
            nodes: 0,
            max_depth: MAX_XML_DEPTH,
            max_nodes: MAX_XML_NODES,
        }
    }

    #[cfg(test)]
    pub(crate) fn from_bytes_with_caps(bytes: &'a [u8], max_depth: usize, max_nodes: u64) -> Self {
        let mut reader = Reader::from_reader(bytes);
        reader.config_mut().trim_text(false);
        Self {
            reader,
            buf: Vec::new(),
            depth: 0,
            nodes: 0,
            max_depth,
            max_nodes,
        }
    }

    /// Borrow-returning read is awkward with an internal buf; we clone the event
    /// into an owned form via `into_owned()` to keep the SafeEvent self-contained.
    pub fn read_event(&mut self) -> Result<Option<SafeEvent<'static>>, ParseError> {
        self.buf.clear();
        let ev = self
            .reader
            .read_event_into(&mut self.buf)
            .map_err(|e| ParseError::MalformedXml(e.to_string()))?;
        match &ev {
            Event::DocType(_) => return Err(ParseError::DtdForbidden),
            _ => {}
        }
        self.nodes += 1;
        if self.nodes > self.max_nodes {
            return Err(ParseError::XmlTooManyNodes(self.max_nodes));
        }
        match &ev {
            Event::Start(_) => {
                self.depth += 1;
                if self.depth > self.max_depth {
                    return Err(ParseError::XmlTooDeep(self.max_depth));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_excessive_node_count() {
        // With max_nodes cap of 2, parsing this 5-node XML should fail.
        let mut r = SafeXmlReader::from_bytes_with_caps(b"<root><a/><a/><a/><a/></root>", 256, 2);
        let result = loop {
            match r.read_event() {
                Ok(Some(_)) => {}
                Err(e) => break Err(e),
                Ok(None) => break Ok(()),
            }
        };
        assert!(matches!(result, Err(ParseError::XmlTooManyNodes(_))));
    }
}

