use crate::error::ParseError;
use crate::limits::{MAX_COMPRESSION_RATIO, MAX_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES};
use std::io::Read;
use ::zip::ZipArchive;

pub fn extract_single_xml(bytes: &[u8]) -> Result<Vec<u8>, ParseError> {
    extract_with_caps(bytes, MAX_UNCOMPRESSED_BYTES, MAX_COMPRESSION_RATIO)
}

fn is_catalogue_xml(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".cat") || n.ends_with(".gst") || n.ends_with(".xml")
}

fn extract_with_caps(bytes: &[u8], max_total: u64, max_ratio: u64) -> Result<Vec<u8>, ParseError> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|e| ParseError::Io(e.to_string()))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(ParseError::ZipMemberCount(archive.len()));
    }
    let mut total: u64 = 0;
    let mut found: Vec<Vec<u8>> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| ParseError::Io(e.to_string()))?;
        // zip-slip: reject entries that do not resolve to a safe relative path.
        let name = file.name().to_string();
        if file.enclosed_name().is_none() || name.contains("..") {
            return Err(ParseError::ZipSlip(name));
        }
        if !is_catalogue_xml(&name) {
            continue; // non-XML sidecars are never decompressed
        }
        // Cheap fast-fail for honestly-declared bombs. NOT authoritative: a lying
        // header defeats it, so the real-byte aggregate cap below is the backstop.
        let compressed = file.compressed_size().max(1);
        if file.size() / compressed > max_ratio {
            return Err(ParseError::ZipBombRatio(max_ratio));
        }
        // Authoritative guard: read with a hard cap on the REMAINING real-byte
        // budget, then account ACTUAL bytes read. A lying `size()` is irrelevant.
        let remaining = max_total.saturating_sub(total);
        let mut out = Vec::new();
        let mut limited = file.by_ref().take(remaining.saturating_add(1));
        limited.read_to_end(&mut out).map_err(|e| ParseError::Io(e.to_string()))?;
        total = total.saturating_add(out.len() as u64);
        if total > max_total {
            return Err(ParseError::ZipBombSize);
        }
        found.push(out);
    }
    match found.len() {
        1 => Ok(found.into_iter().next().unwrap()),
        n => Err(ParseError::ZipMemberCount(n)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::zip::write::SimpleFileOptions;
    use std::io::Write;

    #[test]
    fn ratio_cap_trips_on_low_override() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = ::zip::ZipWriter::new(&mut buf);
            w.start_file("cat.cat", SimpleFileOptions::default()).unwrap();
            w.write_all(&vec![b'a'; 100_000]).unwrap(); // very compressible
            w.finish().unwrap();
        }
        let z = buf.into_inner();
        // total cap generous, ratio cap tiny => ratio guard fires.
        assert_eq!(extract_with_caps(&z, u64::MAX, 2), Err(ParseError::ZipBombRatio(2)));
    }

    #[test]
    fn size_cap_enforced_on_real_bytes_across_entries() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = ::zip::ZipWriter::new(&mut buf);
            w.start_file("a.cat", SimpleFileOptions::default()).unwrap();
            w.write_all(&vec![b'a'; 100_000]).unwrap();
            w.start_file("b.cat", SimpleFileOptions::default()).unwrap();
            w.write_all(&vec![b'a'; 100_000]).unwrap();
            w.finish().unwrap();
        }
        let z = buf.into_inner();
        // ratio cap huge so the ratio heuristic can't fire; total cap small so
        // the real-byte aggregate cap must trip across the two entries.
        assert_eq!(extract_with_caps(&z, 150_000, u64::MAX), Err(ParseError::ZipBombSize));
    }
}
