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

/// Reject inputs over the byte cap before doing any work.
fn check_size(input: &[u8]) -> Result<(), ParseError> {
    if input.len() as u64 > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    Ok(())
}

/// Get the XML bytes for one input, extracting the single zip member if needed.
fn to_xml(input: &[u8], is_zip: bool) -> Result<std::borrow::Cow<'_, [u8]>, ParseError> {
    if is_zip {
        Ok(std::borrow::Cow::Owned(crate::zip::extract_single_xml(input)?))
    } else {
        Ok(std::borrow::Cow::Borrowed(input))
    }
}

/// Read a file into owned bytes with a size cap; zip detected by extension.
fn read_input(path: &Path) -> Result<(Vec<u8>, bool), ParseError> {
    let meta = std::fs::metadata(path).map_err(|e| ParseError::Io(e.to_string()))?;
    if meta.len() > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    let bytes = std::fs::read(path).map_err(|e| ParseError::Io(e.to_string()))?;
    let is_zip = matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("catz") | Some("gstz") | Some("rosz") | Some("zip")
    );
    Ok((bytes, is_zip))
}

/// Parse in-memory catalogue bytes. If `is_zip`, first extract the single XML
/// member. Enforces MAX_INPUT_BYTES before doing any work.
pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(input)?;
    let xml = to_xml(input, is_zip)?;
    let raw = crate::raw::parse_raw(&xml)?;
    let mut diags = Vec::new();
    let resolved = crate::resolve::resolve_with_diags(raw, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

/// Assemble a primary catalogue (`.cat`) with its supporting files (`.gst`) into
/// one evaluable IrCatalogue. Each supporting file is merged into the primary's
/// symbol pool and maps before the single-file resolve runs. In P0-b `supporting`
/// is exactly one `.gst`; the slice shape is future-proofing for P0-c libraries.
pub fn parse_system(
    primary: (&[u8], bool),
    supporting: &[(&[u8], bool)],
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let (p_bytes, p_zip) = primary;
    check_size(p_bytes)?;
    let p_xml = to_xml(p_bytes, p_zip)?;
    let mut cat = crate::raw::parse_raw(&p_xml)?;

    let mut diags = Vec::new();
    for &(s_bytes, s_zip) in supporting {
        check_size(s_bytes)?;
        let s_xml = to_xml(s_bytes, s_zip)?;
        let s_cat = crate::raw::parse_raw(&s_xml)?;
        crate::raw::merge_supporting(&mut cat, s_cat, &mut diags);
    }

    let resolved = crate::resolve::resolve_with_diags(cat, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

/// Read and parse a file. Zip is detected by extension (.catz/.gstz/.rosz).
/// If `deadline` is Some, the parse runs on a worker thread and is abandoned
/// (returning ParseError::Io("parse deadline exceeded")) if it does not finish
/// in time — the pipeline's "max parse time" guard (spec §10.1).
pub fn parse_file(path: &Path, deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let (bytes, is_zip) = read_input(path)?;
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

/// File-path variant of `parse_system` for the CLI: zip detected by extension,
/// optional parse deadline (same worker-thread guard as `parse_file`).
pub fn parse_system_files(
    primary: &Path,
    supporting: &[&Path],
    deadline: Option<Duration>,
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let primary_owned = read_input(primary)?;
    let mut supporting_owned: Vec<(Vec<u8>, bool)> = Vec::with_capacity(supporting.len());
    for p in supporting {
        supporting_owned.push(read_input(p)?);
    }

    let run = move || {
        let sup_refs: Vec<(&[u8], bool)> =
            supporting_owned.iter().map(|(b, z)| (b.as_slice(), *z)).collect();
        parse_system((primary_owned.0.as_slice(), primary_owned.1), &sup_refs)
    };

    match deadline {
        None => run(),
        Some(d) => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(run());
            });
            match rx.recv_timeout(d) {
                Ok(result) => result,
                Err(_) => Err(ParseError::Io("parse deadline exceeded".into())),
            }
        }
    }
}
