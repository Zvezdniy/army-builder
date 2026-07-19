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

/// Input format, detected by file extension. `Xml`/`XmlZip` drive the existing
/// 10e XML pipeline byte-for-byte unchanged; `Json` routes to the 11e JSON reader.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Xml,
    XmlZip,
    Json,
}

/// Read a file into owned bytes with a size cap; format detected by extension.
fn read_input(path: &Path) -> Result<(Vec<u8>, Format), ParseError> {
    let meta = std::fs::metadata(path).map_err(|e| ParseError::Io(e.to_string()))?;
    if meta.len() > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    let bytes = std::fs::read(path).map_err(|e| ParseError::Io(e.to_string()))?;
    let fmt = match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("catz") | Some("gstz") | Some("rosz") | Some("zip") => Format::XmlZip,
        Some("json") => Format::Json,
        _ => Format::Xml,
    };
    Ok((bytes, fmt))
}

/// Parse in-memory bytes of a known format into a RawCatalogue (resolve+map not
/// yet applied). XML/XmlZip route through the existing roxmltree pipeline
/// byte-for-byte unchanged; Json routes to the 11e JSON reader.
fn raw_of(bytes: &[u8], fmt: Format, diags: &mut Vec<Diagnostic>) -> Result<crate::raw::RawCatalogue, ParseError> {
    match fmt {
        Format::Json => crate::raw::parse_raw_json(bytes, diags),
        Format::Xml | Format::XmlZip => {
            let xml = to_xml(bytes, fmt == Format::XmlZip)?;
            crate::raw::parse_raw(&xml)
        }
    }
}

/// Parse in-memory catalogue bytes. If `is_zip`, first extract the single XML
/// member. Enforces MAX_INPUT_BYTES before doing any work.
pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let fmt = if is_zip { Format::XmlZip } else { Format::Xml };
    parse_bytes_fmt(input, fmt)
}

/// Same as `parse_bytes` but takes an already-detected `Format` (used by the
/// `.json` dispatch path as well as the legacy `is_zip` bool wrapper above).
fn parse_bytes_fmt(input: &[u8], fmt: Format) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(input)?;
    let mut diags = Vec::new();
    let raw = raw_of(input, fmt, &mut diags)?;
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
    let p_fmt = if primary.1 { Format::XmlZip } else { Format::Xml };
    let sup_fmt: Vec<(&[u8], Format)> = supporting
        .iter()
        .map(|&(bytes, is_zip)| (bytes, if is_zip { Format::XmlZip } else { Format::Xml }))
        .collect();
    parse_system_fmt((primary.0, p_fmt), &sup_fmt)
}

/// Same as `parse_system` but takes already-detected `Format`s (used by the
/// `.json` dispatch path as well as the legacy `is_zip` bool wrapper above).
fn parse_system_fmt(
    primary: (&[u8], Format),
    supporting: &[(&[u8], Format)],
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(primary.0)?;
    let mut diags = Vec::new();
    let mut cat = raw_of(primary.0, primary.1, &mut diags)?;

    for &(s_bytes, s_fmt) in supporting {
        check_size(s_bytes)?;
        let s_cat = raw_of(s_bytes, s_fmt, &mut diags)?;
        crate::raw::merge_supporting(&mut cat, s_cat, &mut diags);
    }

    let resolved = crate::resolve::resolve_with_diags(cat, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

/// Read and parse a file. Zip is detected by extension (.catz/.gstz/.rosz);
/// `.json` routes to the 11e JSON reader.
/// If `deadline` is Some, the parse runs on a worker thread and is abandoned
/// (returning ParseError::Io("parse deadline exceeded")) if it does not finish
/// in time — the pipeline's "max parse time" guard (spec §10.1).
pub fn parse_file(path: &Path, deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let (bytes, fmt) = read_input(path)?;
    match deadline {
        None => parse_bytes_fmt(&bytes, fmt),
        Some(d) => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(parse_bytes_fmt(&bytes, fmt));
            });
            match rx.recv_timeout(d) {
                Ok(result) => result,
                Err(_) => Err(ParseError::Io("parse deadline exceeded".into())),
            }
        }
    }
}

/// File-path variant of `parse_system` for the CLI: format detected by
/// extension (`.json` routes to the 11e JSON reader), optional parse deadline
/// (same worker-thread guard as `parse_file`).
pub fn parse_system_files(
    primary: &Path,
    supporting: &[&Path],
    deadline: Option<Duration>,
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let primary_owned = read_input(primary)?;
    let mut supporting_owned: Vec<(Vec<u8>, Format)> = Vec::with_capacity(supporting.len());
    for p in supporting {
        supporting_owned.push(read_input(p)?);
    }

    let run = move || {
        let sup_refs: Vec<(&[u8], Format)> =
            supporting_owned.iter().map(|(b, f)| (b.as_slice(), *f)).collect();
        parse_system_fmt((primary_owned.0.as_slice(), primary_owned.1), &sup_refs)
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
