use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use crate::schema::DocId;

/// Magic bytes identifying an .sdaw file.
const SDAW_MAGIC: &[u8; 4] = b"SDAW";

/// Current format version.
const FORMAT_VERSION: u16 = 1;

/// Each record contains two four-byte length fields, even when both payloads are empty.
const RECORD_FRAMING_BYTES: usize = 8;
const DATA_LENGTH_BYTES: usize = 4;

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

    let mut bundle = HashMap::with_capacity(count);

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

        let mut data = vec![0u8; data_len];
        cursor
            .read_exact(&mut data)
            .map_err(|_| format!("Truncated at document {} data", i))?;

        bundle.insert(doc_id, data);
    }

    Ok(bundle)
}

/// Save a document bundle to an .sdaw file on disk.
pub fn save_sdaw_bundle(bundle: &HashMap<DocId, Vec<u8>>, path: &Path) -> Result<(), String> {
    let encoded = encode_sdaw(bundle);
    std::fs::write(path, &encoded).map_err(|e| format!("Failed to write .sdaw file: {}", e))
}

/// Load a document bundle from an .sdaw file on disk.
pub fn load_sdaw_bundle(path: &Path) -> Result<HashMap<DocId, Vec<u8>>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read .sdaw file: {}", e))?;
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
