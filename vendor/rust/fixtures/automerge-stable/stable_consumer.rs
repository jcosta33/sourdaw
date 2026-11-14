use automerge::marks::{ExpandMark, Mark};
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{ActorId, AutoCommit, ObjType, ReadDoc, ScalarValue, TextEncoding, ROOT};
use hexane::{
    ColumnCursor, ColumnData, DeltaCursor, PackError, Packable, RawCursor, ReadRawError, StrCursor,
    UIntCursor,
};

fn document(actor: u8) -> AutoCommit {
    let mut doc = AutoCommit::new_with_encoding(TextEncoding::UnicodeCodePoint);
    doc.set_actor(ActorId::from(vec![actor; 16]));
    doc
}

fn commit(doc: &mut AutoCommit, time: i64, message: &str) {
    assert!(doc
        .commit_with(
            CommitOptions::default()
                .with_time(time)
                .with_message(message)
        )
        .is_some());
}

#[test]
fn stable_canonical_wire_uses_independent_leb_rle_bytes() {
    let mut bytes = Vec::new();
    UIntCursor::encode(&mut bytes, [1u64, 2, 3]);
    assert_eq!(bytes, [0x7d, 1, 2, 3]); // signed -3 literal count, three unsigned values
    bytes.clear();
    DeltaCursor::encode(&mut bytes, [1i64, 2, 3]);
    assert_eq!(bytes, [3, 1]); // three repetitions of signed delta +1
    bytes.clear();
    StrCursor::encode(&mut bytes, [Some("")]);
    assert_eq!(bytes, [0x7f, 0]); // one literal, empty UTF-8 string
    bytes.clear();
    StrCursor::encode(&mut bytes, [None::<&str>]);
    assert_eq!(bytes, [0, 1]); // one null, distinct from empty string
    bytes.clear();
    StrCursor::encode(&mut bytes, [Some("μ")]);
    assert_eq!(bytes, [0x7f, 2, 0xce, 0xbc]);
}

#[test]
fn stable_pack_checks_bounds_without_rejecting_empty_or_exact_eof() {
    assert_eq!(str::unpack(&[0]).unwrap().1.as_ref(), "");
    assert_eq!(str::unpack(&[2, 0xce, 0xbc]).unwrap().1.as_ref(), "μ");
    assert_eq!(<[u8]>::unpack(&[2, 0, 255]).unwrap().1.as_ref(), &[0, 255]);
    assert!(matches!(str::unpack(&[2, 0xce]), Err(PackError::BadFormat)));
    assert!(matches!(
        str::unpack(&[2, 255, 255]),
        Err(PackError::InvalidUtf8)
    ));
    let mut overflow_length = vec![255; 9];
    overflow_length.push(1); // independently encoded u64::MAX length
    assert!(matches!(
        <[u8]>::unpack(&overflow_length),
        Err(PackError::BadFormat)
    ));
}

#[test]
fn stable_delta_refuses_absolute_overflow_and_preserves_signed_values() {
    let mut malformed = vec![0x7e]; // two signed literals
    malformed.extend([255; 9]);
    malformed.push(0); // signed i64::MAX
    malformed.push(1); // next absolute would be i64::MAX + 1
    assert!(matches!(
        ColumnData::<DeltaCursor>::load(&malformed),
        Err(PackError::BadFormat)
    ));
    let valid: ColumnData<DeltaCursor> = [Some(-3i64), None, Some(0), Some(4), Some(1)]
        .into_iter()
        .collect();
    let loaded = ColumnData::<DeltaCursor>::load(&valid.save()).unwrap();
    assert_eq!(loaded.to_vec(), [Some(-3), None, Some(0), Some(4), Some(1)]);
}

#[test]
fn stable_raw_reader_checks_overflow_and_retains_empty_eof() {
    let column = ColumnData::<RawCursor>::load(&[11, 22, 33]).unwrap();
    let mut reader = column.raw_reader(1);
    assert!(matches!(
        reader.read_next(usize::MAX),
        Err(ReadRawError::CrossBoundary)
    ));
    let mut reader = column.raw_reader(0);
    assert_eq!(reader.read_next(3).unwrap(), [11, 22, 33]);
    assert_eq!(reader.suspend(), 3);
    assert_eq!(reader.read_next(0).unwrap(), []);
    assert_eq!(reader.suspend(), 3);
    assert!(matches!(reader.read_next(1), Err(ReadRawError::EndOfData)));
}

#[test]
fn stable_automerge_raw_values_survive_replace_delete_save_and_reload() {
    let mut doc = document(1);
    let lengths = [0usize, 1, 4095, 4096, 4097, 8193];
    let values: Vec<Vec<u8>> = lengths
        .iter()
        .enumerate()
        .map(|(index, length)| {
            (0..*length)
                .map(|offset| ((offset * 31 + index * 17) % 251) as u8)
                .collect()
        })
        .collect();
    for (index, bytes) in values.iter().enumerate() {
        doc.put(
            ROOT,
            format!("raw-{index}"),
            ScalarValue::Bytes(bytes.clone()),
        )
        .unwrap();
    }
    commit(&mut doc, -3, "raw μ");
    doc.put(ROOT, "raw-2", ScalarValue::Bytes(vec![231; 5001]))
        .unwrap();
    doc.delete(ROOT, "raw-1").unwrap();
    commit(&mut doc, 0, "");
    let heads = doc.get_heads();
    let saved = doc.save_nocompress();
    let mut loaded = AutoCommit::load(&saved).unwrap();
    assert_eq!(loaded.get_heads(), heads);
    assert!(loaded.get(ROOT, "raw-1").unwrap().is_none());
    for index in [0usize, 2, 3, 4, 5] {
        let expected: &[u8] = if index == 2 {
            &[231; 5001]
        } else {
            &values[index]
        };
        let value = loaded.get(ROOT, format!("raw-{index}")).unwrap().unwrap().0;
        assert_eq!(value.as_bytes().unwrap(), expected);
    }
    assert_eq!(loaded.save_nocompress(), saved);
}

#[test]
fn stable_mark_prefixes_survive_many_boundaries_actor_remap_and_rollback() {
    let mut doc = document(9);
    let text = doc.put_object(ROOT, "text", ObjType::Text).unwrap();
    doc.splice_text(&text, 0, 0, &"a".repeat(128)).unwrap();
    for start in (0..128).step_by(2) {
        doc.mark(
            &text,
            Mark::new("bold".into(), true, start, start + 1),
            ExpandMark::None,
        )
        .unwrap();
    }
    commit(&mut doc, 7, "marks");
    let historical = doc.get_heads();
    let expected: Vec<_> = (0..128)
        .step_by(2)
        .map(|start| Mark::new("bold".into(), true, start, start + 1))
        .collect();
    assert_eq!(doc.marks(&text).unwrap(), expected);
    for index in [0usize, 1, 2, 31, 32, 63, 64, 126, 127] {
        let expected = if index % 2 == 0 {
            vec![("bold".to_string(), ScalarValue::Boolean(true))]
        } else {
            vec![]
        };
        let actual: Vec<_> = doc
            .get_marks(&text, index, None)
            .unwrap()
            .iter()
            .map(|(name, value)| (name.to_owned(), value.clone()))
            .collect();
        assert_eq!(actual, expected, "mark prefix at {index}");
    }
    doc.mark(
        &text,
        Mark::new("italic".into(), true, 31, 97),
        ExpandMark::None,
    )
    .unwrap();
    assert!(doc.rollback() > 0);
    assert_eq!(doc.marks(&text).unwrap(), expected);
    let mut peer = doc.fork();
    peer.set_actor(ActorId::from(vec![1; 16])); // sorts before original, forcing real actor remap
    peer.put(ROOT, "peer", "present").unwrap();
    commit(&mut peer, 0, "peer");
    doc.merge(&mut peer).unwrap();
    assert_eq!(doc.marks(&text).unwrap(), expected);
    assert_eq!(doc.marks_at(&text, &historical).unwrap(), expected);
    let loaded = AutoCommit::load(&doc.save_nocompress()).unwrap();
    assert_eq!(loaded.marks(&text).unwrap(), expected);
}

#[test]
fn stable_concurrent_merge_and_bundle_preserve_change_bytes_and_metadata() {
    let mut base = document(2);
    let text = base.put_object(ROOT, "text", ObjType::Text).unwrap();
    base.splice_text(&text, 0, 0, "aμb").unwrap();
    base.put(ROOT, "counter", ScalarValue::counter(10)).unwrap();
    commit(&mut base, -3, "base μ");
    let mut left = base.fork();
    left.set_actor(ActorId::from(vec![1; 16]));
    left.put(ROOT, "conflict", "left").unwrap();
    left.increment(ROOT, "counter", 3).unwrap();
    left.mark(
        &text,
        Mark::new("bold".into(), true, 1, 2),
        ExpandMark::None,
    )
    .unwrap();
    commit(&mut left, 0, "");
    let mut right = base.fork();
    right.set_actor(ActorId::from(vec![3; 16]));
    right.put(ROOT, "conflict", "right").unwrap();
    right.increment(ROOT, "counter", -2).unwrap();
    commit(&mut right, 7, "right");
    let mut first = base.clone();
    first.merge(&mut left.clone()).unwrap();
    first.merge(&mut right.clone()).unwrap();
    let mut second = base;
    second.merge(&mut right).unwrap();
    second.merge(&mut left).unwrap();
    assert_eq!(first.text(&text).unwrap(), "aμb");
    assert_eq!(
        first.get(ROOT, "counter").unwrap().unwrap().0.as_i64(),
        Some(11)
    );
    let mut conflicts: Vec<_> = first
        .get_all(ROOT, "conflict")
        .unwrap()
        .into_iter()
        .map(|(value, _)| value.as_str().unwrap().to_owned())
        .collect();
    conflicts.sort();
    assert_eq!(conflicts, ["left", "right"]);
    assert_eq!(first.get_heads(), second.get_heads());
    let changes = first.get_changes(&[]);
    let mut expected: Vec<_> = changes
        .iter()
        .map(|change| (change.hash(), change.raw_bytes().to_vec()))
        .collect();
    expected.sort_by_key(|item| item.0);
    let bundle = first
        .bundle(changes.iter().map(|change| change.hash()))
        .unwrap();
    let mut from_bundle = document(4);
    from_bundle.load_incremental(bundle.bytes()).unwrap();
    assert_eq!(from_bundle.get_heads(), first.get_heads());
    assert_eq!(from_bundle.text(&text).unwrap(), "aμb");
    let mut actual: Vec<_> = from_bundle
        .get_changes(&[])
        .iter()
        .map(|change| (change.hash(), change.raw_bytes().to_vec()))
        .collect();
    actual.sort_by_key(|item| item.0);
    assert_eq!(actual, expected);
    let saved = first.save_nocompress();
    assert_eq!(saved, golden("merge-left-first.am"));
    assert_eq!(second.save_nocompress(), golden("merge-right-first.am"));
    let mut loaded = AutoCommit::load(&saved).unwrap();
    assert_eq!(loaded.save_nocompress(), saved);
}

#[test]
fn stable_maximum_counter_bundle_uses_actual_host_width_without_wrap() {
    let mut seed = document(1);
    seed.put(ROOT, "max-counter", "retained").unwrap();
    commit(&mut seed, 0, "max counter");
    let original = seed.get_changes(&[]).pop().unwrap();
    let mut expanded = automerge::ExpandedChange::from(&original);
    expanded.start_op = std::num::NonZeroU64::new(u64::from(u32::MAX)).unwrap();
    let change = automerge::Change::from(expanded);
    let mut doc = automerge::Automerge::new();
    doc.apply_changes([change.clone()]).unwrap();
    assert_eq!(
        doc.get(ROOT, "max-counter").unwrap().unwrap().0.as_str(),
        Some("retained")
    );
    let result = doc.bundle([change.hash()]);
    #[cfg(target_pointer_width = "32")]
    {
        match result {
            Err(automerge::AutomergeError::EncodingError(message)) => {
                assert_eq!(message, "bundle counter range exceeds host address space");
            }
            other => panic!("expected host-size encoding refusal, got {other:?}"),
        }
    }
    #[cfg(target_pointer_width = "64")]
    {
        let bundle = result.unwrap();
        let decoded = bundle.to_changes().unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].max_op(), u64::from(u32::MAX));
        assert_eq!(decoded[0].hash(), change.hash());
        assert_eq!(decoded[0].raw_bytes(), change.raw_bytes());
    }
}

mod scenario;

fn golden(name: &str) -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("goldens")
            .join(name),
    )
    .unwrap()
}

#[test]
fn stable_original_alpha_document_change_bundle_bytes_and_reads() {
    let mut doc = scenario::build_document();
    let changes = doc.get_changes(&[]);
    let hashes: Vec<_> = changes.iter().map(|change| change.hash()).collect();
    assert_eq!(
        hashes
            .iter()
            .map(|hash| format!("{hash}\n"))
            .collect::<String>()
            .as_bytes(),
        golden("change-hashes.txt")
    );
    for change in &changes {
        assert_eq!(
            change.raw_bytes(),
            golden(&format!("changes/{}.bin", change.hash()))
        );
    }
    let bundle = doc.bundle(hashes).unwrap();
    assert_eq!(bundle.bytes(), golden("bundle.bin"));
    assert_eq!(doc.save_nocompress(), golden("document-uncompressed.am"));
    assert_eq!(doc.save(), golden("document-compressed.am"));
    let mut loaded = AutoCommit::load(&golden("document-uncompressed.am")).unwrap();
    assert_eq!(loaded.get_heads(), doc.get_heads());
    let text = loaded.get(ROOT, "text").unwrap().unwrap().1;
    assert_eq!(loaded.text(&text).unwrap(), "aμ🙂bcdefghij");
    assert_eq!(
        loaded.get(ROOT, "counter").unwrap().unwrap().0.as_i64(),
        Some(11)
    );
    let raw = loaded.get(ROOT, "raw").unwrap().unwrap().0;
    let expected_raw: Vec<u8> = (0..8193)
        .map(|offset| ((offset * 37 + 11) % 251) as u8)
        .collect();
    assert_eq!(raw.as_bytes().unwrap(), expected_raw);
    let mut marks = loaded.marks(&text).unwrap();
    marks.sort_by_key(|mark| (mark.name().to_owned(), mark.start, mark.end));
    assert_eq!(
        marks,
        [
            Mark::new("bold".into(), true, 2, 7),
            Mark::new("italic".into(), "yes", 4, 9)
        ]
    );
    let left_hash = changes
        .iter()
        .find(|change| change.actor_id().as_ref() == [0x11u8; 16])
        .unwrap()
        .hash();
    let left_heads = [left_hash];
    assert_eq!(
        loaded.marks_at(&text, &left_heads).unwrap(),
        [Mark::new("bold".into(), true, 2, 7)]
    );
    let historical: Vec<_> = loaded
        .get_marks(&text, 5, Some(&left_heads))
        .unwrap()
        .iter()
        .map(|(name, value)| (name.to_owned(), value.clone()))
        .collect();
    assert_eq!(
        historical,
        [("bold".to_owned(), ScalarValue::Boolean(true))]
    );
    let list = loaded.get(ROOT, "list").unwrap().unwrap().1;
    assert_eq!(loaded.length(&list), 2);
    assert_eq!(loaded.get(&list, 0).unwrap().unwrap().0.as_str(), Some("μ"));
    assert_eq!(loaded.save_nocompress(), golden("document-uncompressed.am"));
    let mut from_bundle = document(9);
    from_bundle.load_incremental(&golden("bundle.bin")).unwrap();
    assert_eq!(from_bundle.get_heads(), loaded.get_heads());
    assert_eq!(from_bundle.text(&text).unwrap(), "aμ🙂bcdefghij");
    let mut corrupt = golden("document-uncompressed.am");
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(AutoCommit::load(&corrupt).is_err());
}
