use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ParseError {
    #[error("input exceeds size limit ({0} bytes)")]
    InputTooLarge(u64),
    #[error("XML nesting exceeds depth limit ({0})")]
    XmlTooDeep(usize),
    #[error("XML node count exceeds limit ({0})")]
    XmlTooManyNodes(u64),
    #[error("DTD/DOCTYPE is not allowed (XXE/entity-expansion guard)")]
    DtdForbidden,
    #[error("zip entry escapes archive root: {0}")]
    ZipSlip(String),
    #[error("zip exceeds uncompressed size limit")]
    ZipBombSize,
    #[error("zip entry exceeds compression ratio limit ({0}:1)")]
    ZipBombRatio(u64),
    #[error("archive must contain exactly one catalogue XML, found {0}")]
    ZipMemberCount(usize),
    #[error("malformed XML: {0}")]
    MalformedXml(String),
    #[error("unresolved reference: {0}")]
    UnresolvedRef(String),
    #[error("reference cycle through id {0}")]
    ReferenceCycle(String),
    #[error("io error: {0}")]
    Io(String),
}

/// Non-fatal note attached to a successful parse (e.g. a construct the
/// walking-skeleton mapping does not yet represent). Never used to hide a
/// correctness-affecting drop — those become ParseError.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
}
