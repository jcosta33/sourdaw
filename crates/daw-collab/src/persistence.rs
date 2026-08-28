use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use crate::schema::DocId;

/// Magic bytes identifying an .sdaw file.
const SDAW_MAGIC: &[u8; 4] = b"SDAW";

/// Current format version.
const FORMAT_VERSION: u16 = 1;

/// Each record contains two four-byte length fields, even when both payloads are empty.
const RECORD_FRAMING_BYTES: usize = 8;
const DATA_LENGTH_BYTES: usize = 4;

#[derive(Clone, Copy)]
struct SdawDecodeLimits {
    container_bytes: usize,
    records: usize,
    doc_id_bytes: usize,
    document_bytes: usize,
    total_document_bytes: usize,
}

const SDAW_DECODE_LIMITS: SdawDecodeLimits = SdawDecodeLimits {
    container_bytes: 512 * 1024 * 1024,
    records: 10_000,
    doc_id_bytes: 255,
    document_bytes: 256 * 1024 * 1024,
    total_document_bytes: 512 * 1024 * 1024,
};

fn remaining_bytes(cursor: &Cursor<&[u8]>) -> usize {
    cursor
        .get_ref()
        .len()
        .saturating_sub(cursor.position() as usize)
}

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
    decode_sdaw_with_limits(bytes, SDAW_DECODE_LIMITS)
}

fn decode_sdaw_with_limits(
    bytes: &[u8],
    limits: SdawDecodeLimits,
) -> Result<HashMap<DocId, Vec<u8>>, String> {
    if bytes.len() > limits.container_bytes {
        return Err(format!(
            "Invalid .sdaw container: {} bytes exceeds the {} byte container byte budget",
            bytes.len(),
            limits.container_bytes
        ));
    }

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
    let remaining = remaining_bytes(&cursor);
    let max_records = remaining / RECORD_FRAMING_BYTES;
    if count > max_records {
        return Err(format!(
            "Invalid document count: declared {count}, but at most {max_records} records fit in {remaining} remaining bytes"
        ));
    }
    if count > limits.records {
        return Err(format!(
            "Invalid document count: declared {count}, exceeding the {} record budget",
            limits.records
        ));
    }

    let mut bundle = HashMap::with_capacity(count);

    let mut total_document_bytes = 0usize;
    for i in 0..count {
        let later_record_count = count - i - 1;
        let later_record_framing = later_record_count * RECORD_FRAMING_BYTES;

        // Read DocId
        let mut id_len_bytes = [0u8; 4];
        cursor
            .read_exact(&mut id_len_bytes)
            .map_err(|_| format!("Truncated at document {} DocId length", i))?;
        let id_len = u32::from_le_bytes(id_len_bytes) as usize;
        let remaining = remaining_bytes(&cursor);
        let required_framing = DATA_LENGTH_BYTES + later_record_framing;
        let available = remaining.checked_sub(required_framing).ok_or_else(|| {
            format!(
                "Truncated at document {i}: {remaining} bytes remain, but {required_framing} framing bytes are required"
            )
        })?;
        if id_len > available {
            return Err(format!(
                "Invalid document {i} DocId length: declared {id_len} bytes, only {available} available after reserving {required_framing} framing bytes"
            ));
        }
        if id_len > limits.doc_id_bytes {
            return Err(format!(
                "Invalid document {i} DocId length: declared {id_len} bytes, exceeding the {} byte DocId byte budget",
                limits.doc_id_bytes
            ));
        }

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
        let remaining = remaining_bytes(&cursor);
        let available = remaining.checked_sub(later_record_framing).ok_or_else(|| {
            format!(
                "Truncated at document {i}: {remaining} bytes remain, but {later_record_framing} later-record framing bytes are required"
            )
        })?;
        if data_len > available {
            return Err(format!(
                "Invalid document {i} data length: declared {data_len} bytes, only {available} available after reserving {later_record_framing} framing bytes"
            ));
        }
        if data_len > limits.document_bytes {
            return Err(format!(
                "Invalid document {i} data length: declared {data_len} bytes, exceeding the {} byte document byte budget",
                limits.document_bytes
            ));
        }
        total_document_bytes = total_document_bytes
            .checked_add(data_len)
            .ok_or_else(|| "Aggregate document byte count overflowed".to_string())?;
        if total_document_bytes > limits.total_document_bytes {
            return Err(format!(
                "Invalid .sdaw data: {total_document_bytes} aggregate document bytes exceeds the {} byte aggregate document byte budget",
                limits.total_document_bytes
            ));
        }

        let mut data = vec![0u8; data_len];
        cursor
            .read_exact(&mut data)
            .map_err(|_| format!("Truncated at document {} data", i))?;

        bundle.insert(doc_id, data);
    }

    Ok(bundle)
}

/// Save a document bundle to an .sdaw file on disk.
///
/// The replacement is atomic: the bundle is CRDT project history — user data
/// with no reconstructible source — so a truncated or partial file is data
/// loss, not a retryable error. See `replace_file_atomically` for how that is
/// guaranteed.
pub fn save_sdaw_bundle(bundle: &HashMap<DocId, Vec<u8>>, path: &Path) -> Result<(), String> {
    let encoded = encode_sdaw(bundle);
    replace_file_atomically(path, |file| {
        file.write_all(&encoded)
            .map_err(|e| format!("Failed to write .sdaw file: {e}"))
    })
}

/// Replace the .sdaw file at `path` with whatever `write` produces, atomically.
///
/// Twin of `replace_file_atomically` in
/// `crates/sourdaw-native/src/commands/filesystem.rs` (issue #2823, PR #2960),
/// duplicated rather than shared because the dependency direction is fixed the
/// other way — `sourdaw-native` depends on `daw-collab`, so this crate cannot
/// import the helper without a cycle, and the one crate both depend on
/// (`daw-core`) is domain schema with no filesystem role. Keep the two in step
/// when the contract changes.
///
/// Writing straight to `path` truncates it before the replacement bytes are
/// durable, so a disk-full failure or a crash mid-write leaves the only copy of
/// the bundle empty or partial (issue #2961):
///
/// * `write` fills a newly created sibling of `path` — same directory, hence
///   the same filesystem. `create_new` plus a UUID name guarantees the temp
///   file is this writer's alone; a shared name would let a concurrent writer
///   truncate this one's half-written file and publish the interleaving of
///   both.
/// * The temp file is fsynced and closed, and only then renamed onto `path`:
///   the bytes moved over the destination are already durable, and a rename
///   within one filesystem never exposes a partially written file. std's
///   rename replaces an existing destination on every platform this crate
///   builds for (POSIX `rename(2)`; Windows `MOVEFILE_REPLACE_EXISTING`
///   semantics), so no remove-then-rename window is ever opened. Closing
///   before the rename matters on Windows, where renaming from a handle the
///   writer still holds can fail with a sharing violation.
/// * On Unix the parent directory is synced after the rename, best effort, so
///   the rename itself — not just the file's data — survives a crash.
/// * Any failure removes the temp file and leaves `path` exactly as it was.
fn replace_file_atomically(
    path: &Path,
    write: impl FnOnce(&mut std::fs::File) -> Result<(), String>,
) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Atomic write error: path has no file name".to_string())?;
    let temp_path = path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    // The temp file is closed (by the end of this closure) before the rename
    // below runs; the scoping exists to guarantee that order on Windows.
    let write_result = (|| {
        let mut temp_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| format!("Failed to create temporary .sdaw file: {e}"))?;
        write(&mut temp_file)?;
        temp_file
            .sync_all()
            .map_err(|e| format!("Failed to sync temporary .sdaw file: {e}"))
    })();

    match write_result {
        Ok(()) => {
            std::fs::rename(&temp_path, path).map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                format!("Failed to move finished .sdaw file into place: {e}")
            })?;
            sync_parent_directory_best_effort(path);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

/// Sync the directory holding `path` after a successful replace, Unix only.
///
/// The file's bytes are already durable when this runs; syncing the directory
/// makes the rename — the replacement of the old inode's name — durable too.
/// Windows cannot open a directory through std for syncing and NTFS journals
/// the rename, so there is nothing to do there. Best effort, because at this
/// point the replacement is already complete and visible: a failure here only
/// weakens crash-durability back to the level of every unsynced rename, never
/// the file's contents.
#[cfg(unix)]
fn sync_parent_directory_best_effort(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_directory_best_effort(_path: &Path) {}

/// Load a document bundle from an .sdaw file on disk.
pub fn load_sdaw_bundle(path: &Path) -> Result<HashMap<DocId, Vec<u8>>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open .sdaw file: {e}"))?;
    let file_len = file
        .metadata()
        .map_err(|e| format!("Failed to inspect .sdaw file: {e}"))?
        .len();
    let bytes = read_sdaw_bytes_with_limits(file, file_len, SDAW_DECODE_LIMITS)?;
    decode_sdaw(&bytes)
}

fn read_sdaw_bytes_with_limits<R: Read>(
    reader: R,
    file_len: u64,
    limits: SdawDecodeLimits,
) -> Result<Vec<u8>, String> {
    if file_len > limits.container_bytes as u64 {
        return Err(format!(
            "Invalid .sdaw container: {file_len} bytes exceeds the {} byte container byte budget",
            limits.container_bytes
        ));
    }

    let mut bytes = Vec::with_capacity(file_len as usize);
    reader
        .take((limits.container_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read .sdaw file: {e}"))?;
    if bytes.len() > limits.container_bytes {
        return Err(format!(
            "Invalid .sdaw container: file grew beyond the {} byte container byte budget while reading",
            limits.container_bytes
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const TEST_LIMITS: SdawDecodeLimits = SdawDecodeLimits {
        container_bytes: 64,
        records: 1,
        doc_id_bytes: 4,
        document_bytes: 4,
        total_document_bytes: 6,
    };

    fn encoded_bundle(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let bundle = entries
            .iter()
            .map(|(id, data)| ((*id).to_string(), (*data).to_vec()))
            .collect();
        encode_sdaw(&bundle)
    }

    #[test]
    fn decode_rejects_container_over_explicit_budget() {
        let bytes = vec![0; TEST_LIMITS.container_bytes + 1];
        let error = decode_sdaw_with_limits(&bytes, TEST_LIMITS)
            .expect_err("container budget must be checked before parsing");

        assert!(error.contains("container byte budget"));
    }

    #[test]
    fn file_read_rejects_growth_beyond_the_reported_size_and_container_budget() {
        let bytes = vec![0; TEST_LIMITS.container_bytes + 1];
        let error = read_sdaw_bytes_with_limits(Cursor::new(bytes), 0, TEST_LIMITS)
            .expect_err("a file that grows after metadata inspection must remain bounded");

        assert!(error.contains("container byte budget"));
    }

    #[test]
    fn decode_rejects_record_count_over_explicit_budget() {
        let bytes = encoded_bundle(&[("one", &[1]), ("two", &[2])]);
        let error = decode_sdaw_with_limits(&bytes, TEST_LIMITS)
            .expect_err("record budget must be checked before preallocation");

        assert!(error.contains("record budget"));
    }

    #[test]
    fn decode_rejects_doc_id_over_explicit_budget() {
        let bytes = encoded_bundle(&[("large", &[1])]);
        let error = decode_sdaw_with_limits(&bytes, TEST_LIMITS)
            .expect_err("DocId budget must be checked before allocation");

        assert!(error.contains("DocId byte budget"));
    }

    #[test]
    fn decode_rejects_document_over_explicit_budget() {
        let bytes = encoded_bundle(&[("root", &[1, 2, 3, 4, 5])]);
        let error = decode_sdaw_with_limits(&bytes, TEST_LIMITS)
            .expect_err("document budget must be checked before allocation");

        assert!(error.contains("document byte budget"));
    }

    #[test]
    fn decode_rejects_aggregate_document_bytes_over_explicit_budget() {
        let limits = SdawDecodeLimits {
            records: 2,
            ..TEST_LIMITS
        };
        let bytes = encoded_bundle(&[("one", &[1, 2, 3, 4]), ("two", &[5, 6, 7, 8])]);
        let error = decode_sdaw_with_limits(&bytes, limits)
            .expect_err("aggregate document budget must be checked before allocation");

        assert!(error.contains("aggregate document byte budget"));
    }

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
    fn decode_rejects_document_count_that_cannot_fit_before_preallocating() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&u16::MAX.to_le_bytes());

        let error = decode_sdaw(&buf).expect_err("impossible document count must be rejected");

        assert_eq!(
            error,
            "Invalid document count: declared 65535, but at most 0 records fit in 0 remaining bytes"
        );
    }

    #[test]
    fn decode_rejects_doc_id_length_larger_than_remaining_input_before_allocating() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&u32::MAX.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());

        let error = decode_sdaw(&buf).expect_err("oversized DocId length must be rejected");

        assert_eq!(
            error,
            "Invalid document 0 DocId length: declared 4294967295 bytes, only 0 available after reserving 4 framing bytes"
        );
    }

    #[test]
    fn decode_rejects_data_length_larger_than_remaining_input_before_allocating() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&4u32.to_le_bytes());
        buf.extend_from_slice(b"root");
        buf.extend_from_slice(&u32::MAX.to_le_bytes());

        let error = decode_sdaw(&buf).expect_err("oversized data length must be rejected");

        assert_eq!(
            error,
            "Invalid document 0 data length: declared 4294967295 bytes, only 0 available after reserving 0 framing bytes"
        );
    }

    #[test]
    fn decode_reserves_current_data_length_and_later_record_framing_before_doc_id() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&5u32.to_le_bytes());
        buf.extend_from_slice(&[0u8; 12]);

        let error = decode_sdaw(&buf).expect_err("DocId must leave all record framing intact");

        assert_eq!(
            error,
            "Invalid document 0 DocId length: declared 5 bytes, only 0 available after reserving 12 framing bytes"
        );
    }

    #[test]
    fn decode_reserves_later_record_framing_before_document_data() {
        let mut buf = Vec::new();
        buf.extend_from_slice(SDAW_MAGIC);
        buf.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());
        buf.extend_from_slice(&5u32.to_le_bytes());
        buf.extend_from_slice(&[0u8; 8]);

        let error = decode_sdaw(&buf).expect_err("data must leave later record framing intact");

        assert_eq!(
            error,
            "Invalid document 0 data length: declared 5 bytes, only 0 available after reserving 8 framing bytes"
        );
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

    struct TempBundleDir {
        root: PathBuf,
    }

    impl TempBundleDir {
        fn create(test_name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "daw-collab-atomic-save-{test_name}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).expect("test bundle directory should be created");
            Self { root }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempBundleDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn temp_file_residue(directory: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(directory)
            .expect("test bundle directory should be listable")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "tmp"))
            .collect()
    }

    /// Regression (issue #2961): `save_sdaw_bundle` used to call
    /// `std::fs::write` on the destination directly, truncating the only copy
    /// of the CRDT project history before the replacement bytes were durable —
    /// a mid-write failure (disk full, I/O fault) destroyed unreconstructible
    /// user data. A failure injected mid-write, after real bytes have reached
    /// the temp file, must leave the destination byte-for-byte untouched and
    /// no temp file behind.
    #[test]
    fn a_mid_write_failure_leaves_a_pre_existing_bundle_untouched() {
        let dir = TempBundleDir::create("failure-existing");
        let destination = dir.path("project.sdaw");
        let previous = encoded_bundle(&[("root", &[1, 2, 3, 4])]);
        std::fs::write(&destination, &previous).expect("pre-existing bundle should be written");

        let error = replace_file_atomically(&destination, |file| {
            // Real bytes reach the temp file before the injected failure,
            // mirroring an I/O fault partway through a save.
            file.write_all(b"partial bytes")
                .map_err(|e| format!("Failed to write .sdaw file: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            previous,
            "a failed save must leave the destination byte-for-byte intact"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be removed after a failed save"
        );
    }

    /// The same failure against a not-yet-existing destination must create
    /// nothing there: a truncated file would satisfy a later existence check
    /// and masquerade as the bundle.
    #[test]
    fn a_mid_write_failure_creates_nothing_at_a_missing_destination() {
        let dir = TempBundleDir::create("failure-missing");
        let destination = dir.path("project.sdaw");

        let error = replace_file_atomically(&destination, |file| {
            file.write_all(b"partial")
                .map_err(|e| format!("Failed to write .sdaw file: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert!(
            !destination.exists(),
            "a failed save must not leave a file at the destination"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be removed after a failed save"
        );
    }

    #[test]
    fn a_successful_save_replaces_an_existing_bundle_completely_and_leaves_no_temp_file() {
        let dir = TempBundleDir::create("success-existing");
        let destination = dir.path("project.sdaw");
        let previous = HashMap::from([("root".to_string(), vec![10, 20, 30])]);
        save_sdaw_bundle(&previous, &destination).expect("pre-existing bundle should be written");

        let replacement = HashMap::from([
            ("root".to_string(), vec![1, 2, 3, 4]),
            ("track_kick".to_string(), vec![5, 6]),
        ]);
        save_sdaw_bundle(&replacement, &destination).expect("replacement save should succeed");

        let loaded = load_sdaw_bundle(&destination).expect("replaced bundle should decode");
        assert_eq!(
            loaded, replacement,
            "a successful save must replace the bundle in full"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be renamed away on success"
        );
    }

    /// Rename-based replacement is also how a destination that does not exist
    /// yet appears: it either exists complete or not at all, never truncated.
    #[test]
    fn a_successful_save_can_create_a_missing_bundle() {
        let dir = TempBundleDir::create("success-missing");
        let destination = dir.path("project.sdaw");
        let fresh = HashMap::from([("root".to_string(), vec![10, 20, 30])]);

        save_sdaw_bundle(&fresh, &destination).expect("first save should succeed");

        let loaded = load_sdaw_bundle(&destination).expect("created bundle should decode");
        assert_eq!(
            loaded, fresh,
            "a created bundle must hold every document in full"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be renamed away on success"
        );
    }

    /// Through the public save itself, at the phase no closure can reach from
    /// outside: when the directory cannot host the temp sibling, the save must
    /// refuse rather than fall back to writing in place. The old
    /// `std::fs::write` reopened the existing bundle through this read-only
    /// directory — opening an existing file needs no directory write
    /// permission — and overwrote it in place, which is exactly the defect
    /// this issue fixes. Unix only, because the read-only directory is
    /// arranged with Unix permission bits.
    #[cfg(unix)]
    #[test]
    fn a_save_that_cannot_create_its_temp_file_leaves_the_existing_bundle_untouched() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempBundleDir::create("readonly-directory");
        let destination = dir.path("project.sdaw");
        let bundle = HashMap::from([("root".to_string(), vec![1, 2, 3, 4])]);
        let previous = encode_sdaw(&bundle);
        std::fs::write(&destination, &previous).expect("pre-existing bundle should be written");
        std::fs::set_permissions(&dir.root, std::fs::Permissions::from_mode(0o555))
            .expect("directory should become read-only");

        let error = save_sdaw_bundle(&bundle, &destination).unwrap_err();

        // Restore before asserting, so the directory cleans up even when an
        // assertion below fails.
        std::fs::set_permissions(&dir.root, std::fs::Permissions::from_mode(0o755))
            .expect("directory should become writable again");
        assert!(
            error.contains("temporary .sdaw file"),
            "the failure must come from the temp-file phase: {error}"
        );
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            previous,
            "a refused save must leave the destination byte-for-byte intact"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "a refused save must leave no temp file behind"
        );
    }
}

/// Golden-fixture conformance between the two independent `.sdaw` codecs: the one
/// above, and `encodeSdawFile` / `decodeSdawFile` in
/// `src/modules/CrdtDocument/useCases/sdawFileFormat/`. The fixtures under
/// `tests/fixtures/sdaw/` are the artifact — each language decodes bytes the *other*
/// language produced, so neither side can drift without the other going red.
///
/// The canonical bundles below are mirrored exactly in
/// `sdawCrossLanguageConformance.spec.ts`. Change one and you must change both.
#[cfg(test)]
mod conformance_tests {
    use super::*;
    use automerge::transaction::{CommitOptions, Transactable};
    use automerge::{ActorId, AutoCommit, ObjType, ReadDoc, ScalarValue, Value};
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/sdaw")
            .join(name)
    }

    fn read_fixture(name: &str) -> Vec<u8> {
        let path = fixture_path(name);
        std::fs::read(&path).unwrap_or_else(|e| panic!("missing fixture {}: {e}", path.display()))
    }

    fn canonical_empty() -> HashMap<DocId, Vec<u8>> {
        HashMap::new()
    }

    fn canonical_single() -> HashMap<DocId, Vec<u8>> {
        HashMap::from([("root".to_string(), vec![1u8, 2, 3, 4])])
    }

    /// Four documents whose ids are deliberately *not* in alphabetical order when
    /// inserted on the TypeScript side, and whose framed record sizes are all
    /// distinct (16, 20, 22 and 19 bytes). Both properties matter: the first keeps
    /// the two multi-document fixtures genuinely different files, and the second
    /// means a total-length comparison cannot be fooled by a duplicated record
    /// standing in for a dropped one.
    fn canonical_multi() -> HashMap<DocId, Vec<u8>> {
        HashMap::from([
            ("root".to_string(), vec![1u8, 2, 3, 4]),
            ("track_kick".to_string(), vec![5u8, 6]),
            ("track_snare".to_string(), vec![7u8, 8, 9]),
            ("track_bass".to_string(), vec![10u8]),
        ])
    }

    /// A hand-built bundle whose single DocId is not valid UTF-8 (`0xFF 0xFE`).
    /// Neither encoder can produce this — `DocId` is a `String` on both sides — so
    /// it stands in for a corrupted or hostile file, which is exactly where the two
    /// decoders diverged before this fixture existed.
    const CORRUPT_INVALID_UTF8_DOCID: &[u8] = &[
        b'S', b'D', b'A', b'W', // magic
        0x01, 0x00, // version 1
        0x01, 0x00, // one document
        0x02, 0x00, 0x00, 0x00, // DocId length 2
        0xFF, 0xFE, // DocId bytes: invalid UTF-8
        0x04, 0x00, 0x00, 0x00, // data length 4
        0x01, 0x02, 0x03, 0x04, // data
    ];

    /// Split an encoded bundle into its 8-byte header and the raw bytes of each
    /// record, so two encodings can be compared byte-for-byte without depending on
    /// record order. `None` when the bytes are not walkable as records.
    fn split_records(bytes: &[u8]) -> Option<(Vec<u8>, Vec<Vec<u8>>)> {
        let mut records = Vec::new();
        let mut offset = 8;
        while offset < bytes.len() {
            let start = offset;
            for _ in 0..2 {
                let len_bytes = bytes.get(offset..offset + 4)?;
                let len = u32::from_le_bytes(len_bytes.try_into().ok()?) as usize;
                offset += 4 + len;
            }
            records.push(bytes.get(start..offset)?.to_vec());
        }
        Some((bytes.get(..8)?.to_vec(), records))
    }

    /// Serialize a bundle reproducibly, by canonicalising the order of the records
    /// `encode_sdaw` produced.
    ///
    /// `encode_sdaw` iterates a `HashMap`, so its record order is a fresh random
    /// permutation every process and a fixture written straight from it is not
    /// reproducible. This takes the encoder's real output for the *whole* bundle —
    /// including its multi-document path — and only reorders the records, sorting
    /// them by their raw bytes. Every byte in the result was produced by
    /// `encode_sdaw`; nothing is hand-written, and crucially nothing is re-encoded
    /// per record, so a defect that only manifests for multi-document bundles still
    /// reaches the fixture and still reaches the TypeScript side.
    ///
    /// This canonicalises the fixture only. `encode_sdaw` is untouched, and whether
    /// it should sort remains an open decision.
    fn encode_sdaw_sorted(bundle: &HashMap<DocId, Vec<u8>>) -> Vec<u8> {
        let encoded = encode_sdaw(bundle);
        // Canonicalising order is a fixture convenience, not a validity check. If the
        // encoder emits something that cannot be walked as records, write it verbatim
        // rather than refusing — a broken encoder has to reach the other language's
        // decoder, which is the whole point of the fixture.
        let Some((mut out, mut records)) = split_records(&encoded) else {
            return encoded;
        };
        records.sort();
        for record in records {
            out.extend_from_slice(&record);
        }
        out
    }

    /// Build an Automerge document reproducibly.
    ///
    /// The actor id and the commit timestamp are both pinned. Left to their defaults
    /// they are a random actor and `SystemTime::now()`, which makes every regenerated
    /// fixture a different file and leaves a reviewer unable to verify a checked-in
    /// artifact by regenerating it.
    fn automerge_doc(actor: &str, fields: &[(&str, &str)]) -> Vec<u8> {
        let mut doc = AutoCommit::new().with_actor(ActorId::try_from(actor).expect("actor id"));
        for (key, value) in fields {
            doc.put(automerge::ROOT, *key, *value).expect("put field");
        }
        doc.commit_with(CommitOptions::default().with_time(0));
        doc.save()
    }

    fn canonical_automerge() -> HashMap<DocId, Vec<u8>> {
        HashMap::from([
            (
                "root".to_string(),
                automerge_doc(
                    "00000000000000000000000000000001",
                    &[("name", "conformance"), ("kind", "root")],
                ),
            ),
            (
                "track_a".to_string(),
                automerge_doc("00000000000000000000000000000002", &[("label", "alpha")]),
            ),
        ])
    }

    /// Read a root-level string.
    ///
    /// The JS binding stores map strings as a collaborative `Text` object while this
    /// binding stores them as a `Str` scalar, so a cross-language reader has to accept
    /// both. That asymmetry lives in Automerge's authoring APIs, not in the `.sdaw`
    /// container these tests conform.
    fn read_string(doc: &AutoCommit, key: &str) -> String {
        let (value, id) = doc
            .get(automerge::ROOT, key)
            .expect("read key")
            .unwrap_or_else(|| panic!("document has no key {key}"));
        match value {
            Value::Scalar(scalar) => match scalar.as_ref() {
                ScalarValue::Str(text) => text.to_string(),
                other => panic!("key {key} is not a string: {other:?}"),
            },
            Value::Object(ObjType::Text) => doc.text(&id).expect("read text"),
            other => panic!("key {key} is not a string: {other:?}"),
        }
    }

    #[test]
    fn decodes_the_typescript_written_empty_bundle() {
        let decoded = decode_sdaw(&read_fixture("ts-written-empty.sdaw")).expect("decode");
        assert!(decoded.is_empty());
    }

    #[test]
    fn encodes_an_empty_bundle_to_the_exact_bytes_typescript_wrote() {
        assert_eq!(
            encode_sdaw(&canonical_empty()),
            read_fixture("ts-written-empty.sdaw")
        );
    }

    #[test]
    fn decodes_the_typescript_written_single_document_bundle() {
        let decoded = decode_sdaw(&read_fixture("ts-written-single.sdaw")).expect("decode");
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded["root"], vec![1, 2, 3, 4]);
    }

    #[test]
    fn encodes_the_single_document_bundle_to_the_exact_bytes_typescript_wrote() {
        assert_eq!(
            encode_sdaw(&canonical_single()),
            read_fixture("ts-written-single.sdaw")
        );
    }

    #[test]
    fn decodes_every_document_of_the_typescript_written_multi_document_bundle() {
        let decoded = decode_sdaw(&read_fixture("ts-written-multi.sdaw")).expect("decode");
        assert_eq!(decoded, canonical_multi());
    }

    #[test]
    fn encodes_the_canonical_multi_document_bundle_to_the_same_records_typescript_wrote() {
        // The multi-document check is deliberately asymmetric, and this is the weaker
        // half. TypeScript owns the byte-for-byte multi-document assertion
        // (`re-encodes the Rust-written multi-document bundle to byte-identical
        // output`); `encode_sdaw` cannot mirror it, because it iterates a `HashMap`
        // and so emits records in a per-process random order that will not match the
        // TypeScript file's order.
        //
        // What *is* assertable order-independently, and still at the byte level, is
        // the multiset of raw record bytes. Comparing only the total length would be
        // blind: it cannot tell a duplicated record from a dropped one of the same
        // size. Comparing the records themselves can.
        let (our_header, mut ours) = split_records(&encode_sdaw(&canonical_multi()))
            .expect("our own output walks as records");
        let (their_header, mut theirs) = split_records(&read_fixture("ts-written-multi.sdaw"))
            .expect("the fixture walks as records");

        assert_eq!(our_header, their_header);
        ours.sort();
        theirs.sort();
        assert_eq!(ours, theirs);
        assert_eq!(ours.len(), 4, "a dropped or duplicated record");
    }

    #[test]
    fn re_encodes_the_typescript_written_multi_document_bundle_to_an_equivalent_bundle() {
        // Byte equality is not assertable here: `encode_sdaw` iterates a `HashMap` and
        // therefore emits records in a per-process random order, so it cannot reproduce
        // the TypeScript file's record order (see the report on AC-7). Equivalence of the
        // decoded bundle is what the format actually guarantees.
        let decoded = decode_sdaw(&read_fixture("ts-written-multi.sdaw")).expect("decode");
        let round_tripped = decode_sdaw(&encode_sdaw(&decoded)).expect("re-decode");
        assert_eq!(round_tripped, canonical_multi());
    }

    #[test]
    fn loads_the_automerge_documents_typescript_wrote_and_reads_their_fields() {
        let decoded = decode_sdaw(&read_fixture("ts-written-automerge.sdaw")).expect("decode");
        let root = AutoCommit::load(&decoded["root"]).expect("load root document");
        assert_eq!(read_string(&root, "name"), "conformance");
        assert_eq!(read_string(&root, "kind"), "root");
        let track = AutoCommit::load(&decoded["track_a"]).expect("load track document");
        assert_eq!(read_string(&track, "label"), "alpha");
    }

    #[test]
    fn rejects_a_docid_that_is_not_valid_utf8() {
        let error = decode_sdaw(&read_fixture("corrupt-invalid-utf8-docid.sdaw"))
            .expect_err("a DocId that is not valid UTF-8 must be rejected");
        assert_eq!(error, "Invalid UTF-8 in document 0 DocId");
    }

    /// Regenerates the Rust-authored fixtures, plus the shared corrupt fixture.
    /// Ignored by default; run it after deliberately changing this encoder, then
    /// re-run the Vitest conformance spec — that is what proves the change is still
    /// readable from the other side:
    ///
    ///   cargo test -p daw-collab -- --ignored write_rust_authored_fixtures
    ///
    /// Output is fully reproducible: records go out in DocId order via
    /// `encode_sdaw_sorted`, and the Automerge documents pin their actor id and commit
    /// time. Regenerating against an unchanged encoder is a no-op diff, so a reviewer
    /// can verify the checked-in artifacts by re-running this.
    #[test]
    #[ignore = "fixture generator; see the doc comment for the regeneration command"]
    fn write_rust_authored_fixtures() {
        for (name, bundle) in [
            ("rust-written-empty.sdaw", canonical_empty()),
            ("rust-written-single.sdaw", canonical_single()),
            ("rust-written-multi.sdaw", canonical_multi()),
            ("rust-written-automerge.sdaw", canonical_automerge()),
        ] {
            std::fs::write(fixture_path(name), encode_sdaw_sorted(&bundle)).expect("write fixture");
        }
        std::fs::write(
            fixture_path("corrupt-invalid-utf8-docid.sdaw"),
            CORRUPT_INVALID_UTF8_DOCID,
        )
        .expect("write corrupt fixture");
    }
}
