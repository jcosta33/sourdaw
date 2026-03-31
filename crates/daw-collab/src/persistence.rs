use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use crate::schema::DocId;

/// Magic bytes identifying an .sdaw file.
const SDAW_MAGIC: &[u8; 4] = b"SDAW";

/// Current format version.
const FORMAT_VERSION: u16 = 1;

/// Encode a document bundle into the .sdaw binary format.
///
/// Format:
///   4B magic "SDAW"
///   2B format version (little-endian)
///   2B document count (little-endian)
///   Per document:
///     4B DocId string length (little-endian)
///     N  DocId string bytes (UTF-8)
///     4B Automerge binary length (little-endian)
///     N  Automerge save() bytes
pub fn encode_sdaw(bundle: &HashMap<DocId, Vec<u8>>) -> Vec<u8> {
    let mut buf = Vec::new();

    buf.extend_from_slice(SDAW_MAGIC);
    buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    buf.extend_from_slice(&(bundle.len() as u16).to_le_bytes());

    for (doc_id, data) in bundle {
        let id_bytes = doc_id.as_bytes();
        buf.extend_from_slice(&(id_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(id_bytes);
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(data);
    }

    buf
}

/// Decode an .sdaw binary into a document bundle.
pub fn decode_sdaw(bytes: &[u8]) -> Result<HashMap<DocId, Vec<u8>>, String> {
    let mut cursor = Cursor::new(bytes);

    // Read magic
    let mut magic = [0u8; 4];
    cursor
        .read_exact(&mut magic)
        .map_err(|_| "File too short: missing magic bytes".to_string())?;
    if &magic != SDAW_MAGIC {
        return Err("Invalid .sdaw file: bad magic bytes".to_string());
    }

    // Read version
    let mut version_bytes = [0u8; 2];
    cursor
        .read_exact(&mut version_bytes)
        .map_err(|_| "File too short: missing version".to_string())?;
    let version = u16::from_le_bytes(version_bytes);
    if version != FORMAT_VERSION {
        return Err(format!(
            "Unsupported .sdaw version: {} (expected {})",
            version, FORMAT_VERSION
        ));
    }

    // Read document count
    let mut count_bytes = [0u8; 2];
    cursor
        .read_exact(&mut count_bytes)
        .map_err(|_| "File too short: missing document count".to_string())?;
    let count = u16::from_le_bytes(count_bytes) as usize;

    let mut bundle = HashMap::with_capacity(count);

    for i in 0..count {
        // Read DocId
        let mut id_len_bytes = [0u8; 4];
        cursor
            .read_exact(&mut id_len_bytes)
            .map_err(|_| format!("Truncated at document {} DocId length", i))?;
        let id_len = u32::from_le_bytes(id_len_bytes) as usize;

        let mut id_bytes = vec![0u8; id_len];
        cursor
            .read_exact(&mut id_bytes)
            .map_err(|_| format!("Truncated at document {} DocId", i))?;
        let doc_id = String::from_utf8(id_bytes)
            .map_err(|_| format!("Invalid UTF-8 in document {} DocId", i))?;

        // Read Automerge data
        let mut data_len_bytes = [0u8; 4];
        cursor
            .read_exact(&mut data_len_bytes)
            .map_err(|_| format!("Truncated at document {} data length", i))?;
        let data_len = u32::from_le_bytes(data_len_bytes) as usize;

        let mut data = vec![0u8; data_len];
        cursor
            .read_exact(&mut data)
            .map_err(|_| format!("Truncated at document {} data", i))?;

        bundle.insert(doc_id, data);
    }

    Ok(bundle)
}

/// Save a document bundle to an .sdaw file on disk.
pub fn save_sdaw_bundle(
    bundle: &HashMap<DocId, Vec<u8>>,
    path: &Path,
) -> Result<(), String> {
    let encoded = encode_sdaw(bundle);
    std::fs::write(path, &encoded).map_err(|e| format!("Failed to write .sdaw file: {}", e))
}

/// Load a document bundle from an .sdaw file on disk.
pub fn load_sdaw_bundle(path: &Path) -> Result<HashMap<DocId, Vec<u8>>, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read .sdaw file: {}", e))?;
    decode_sdaw(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip() {
        let mut bundle = HashMap::new();
        bundle.insert("root".to_string(), vec![1, 2, 3, 4]);
        bundle.insert("track_abc".to_string(), vec![5, 6, 7]);

        let encoded = encode_sdaw(&bundle);
        let decoded = decode_sdaw(&encoded).expect("decode should succeed");

        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded["root"], vec![1, 2, 3, 4]);
        assert_eq!(decoded["track_abc"], vec![5, 6, 7]);
    }

    #[test]
    fn decode_rejects_bad_magic() {
        let bad = b"BADx\x01\x00\x00\x00";
        let result = decode_sdaw(bad);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad magic"));
    }

    #[test]
    fn decode_rejects_wrong_version() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&99u16.to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes());

        let result = decode_sdaw(&buf);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported"));
    }

    #[test]
    fn decode_handles_empty_bundle() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&0u16.to_le_bytes());

        let decoded = decode_sdaw(&buf).expect("should decode empty bundle");
        assert!(decoded.is_empty());
    }

    #[test]
    fn file_roundtrip() {
        let dir = std::env::temp_dir().join("daw_collab_test");
        std::fs::create_dir_all(&dir).ok();
        let path = dir.join("test.sdaw");

        let mut bundle = HashMap::new();
        bundle.insert("root".to_string(), vec![10, 20, 30]);

        save_sdaw_bundle(&bundle, &path).expect("save should succeed");
        let loaded = load_sdaw_bundle(&path).expect("load should succeed");

        assert_eq!(loaded["root"], vec![10, 20, 30]);

        std::fs::remove_dir_all(&dir).ok();
    }
}
