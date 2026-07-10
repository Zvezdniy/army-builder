#![forbid(unsafe_code)]

pub mod error;
pub mod ir;
pub mod limits;
pub mod raw;
pub mod resolve;
pub mod xml;
pub mod zip;

use std::path::Path;
use std::time::Duration;

pub use error::{Diagnostic, ParseError};
pub use ir::IrCatalogue;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Parse in-memory catalogue bytes. If `is_zip`, first extract the single XML
/// member. Enforces MAX_INPUT_BYTES before doing any work.
pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    if input.len() as u64 > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    let xml: std::borrow::Cow<[u8]> = if is_zip {
        std::borrow::Cow::Owned(crate::zip::extract_single_xml(input)?)
    } else {
        std::borrow::Cow::Borrowed(input)
    };
    let raw = crate::raw::parse_raw(&xml)?;
    let resolved = crate::resolve::resolve(raw)?;
    Ok(crate::ir::to_ir(&resolved))
}

/// Read and parse a file. Zip is detected by extension (.catz/.gstz/.rosz).
/// If `deadline` is Some, the parse runs on a worker thread and is abandoned
/// (returning ParseError::Io("parse deadline exceeded")) if it does not finish
/// in time — the pipeline's "max parse time" guard (spec §10.1).
pub fn parse_file(path: &Path, deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let meta = std::fs::metadata(path).map_err(|e| ParseError::Io(e.to_string()))?;
    if meta.len() > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    let bytes = std::fs::read(path).map_err(|e| ParseError::Io(e.to_string()))?;
    let is_zip = matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("catz") | Some("gstz") | Some("rosz") | Some("zip")
    );
    match deadline {
        None => parse_bytes(&bytes, is_zip),
        Some(d) => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(parse_bytes(&bytes, is_zip));
            });
            match rx.recv_timeout(d) {
                Ok(result) => result,
                Err(_) => Err(ParseError::Io("parse deadline exceeded".into())),
            }
        }
    }
}
