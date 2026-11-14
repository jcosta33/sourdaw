use hexane::{ColumnCursor, ColumnData, DeltaCursor, Packable};

#[test]
fn stable_valid_wide_delta_displacement_survives_save_and_splice() {
    let step = 1i64 << 62;
    let values = [Some(i64::MIN), Some(-step), Some(0), Some(step)];
    let mut encoded = Vec::new();
    encoded.push(0x7f); // one literal i64::MIN, then three repeated positive deltas
    i64::pack(&i64::MIN, &mut encoded);
    encoded.push(3);
    i64::pack(&step, &mut encoded);
    let mut written = Vec::new();
    DeltaCursor::encode(&mut written, values);
    assert_eq!(written, encoded);
    let built: ColumnData<DeltaCursor> = values.into_iter().collect();
    assert_eq!(built.to_vec(), values);
    assert_eq!(built.save(), encoded);
    let mut column = ColumnData::<DeltaCursor>::load(&encoded).unwrap();
    assert_eq!(column.to_vec(), values);
    assert_eq!(column.save(), encoded);
    let mut expected = values.to_vec();
    column.splice(1, 1, [Some(-step + 1)]);
    expected.splice(1..2, [Some(-step + 1)]);
    assert_eq!(column.to_vec(), expected);
    column.splice(2, 0, [None, Some(-7)]);
    expected.splice(2..2, [None, Some(-7)]);
    assert_eq!(column.to_vec(), expected);
    column.splice(2, 2, std::iter::empty::<Option<i64>>());
    expected.drain(2..4);
    assert_eq!(column.to_vec(), expected);
    let loaded = ColumnData::<DeltaCursor>::load(&column.save()).unwrap();
    assert_eq!(loaded.to_vec(), expected);
}

#[test]
fn stable_valid_near_i64_extrema_preserve_byte_encoding() {
    let values = [i64::MIN, -1, i64::MAX - 1, i64::MAX];
    let mut bytes = Vec::new();
    DeltaCursor::encode(&mut bytes, values);
    let built: ColumnData<DeltaCursor> = values.into_iter().collect();
    assert_eq!(built.to_vec(), values.map(Some));
    assert_eq!(built.save(), bytes);
    let column = ColumnData::<DeltaCursor>::load(&bytes).unwrap();
    assert_eq!(column.to_vec(), values.map(Some));
    assert_eq!(column.save(), bytes);
}

#[test]
fn stable_plain_signed_rle_values_do_not_accumulate_as_deltas() {
    let values = [
        Some(i64::MIN),
        Some(i64::MIN),
        None,
        Some(i64::MAX),
        Some(i64::MAX),
    ];
    let mut column: ColumnData<hexane::IntCursor> = values.into_iter().collect();
    assert_eq!(column.to_vec(), values);
    column.splice(1, 1, [Some(i64::MAX)]);
    assert_eq!(
        column.to_vec(),
        [
            Some(i64::MIN),
            Some(i64::MAX),
            None,
            Some(i64::MAX),
            Some(i64::MAX)
        ]
    );
    let loaded = ColumnData::<hexane::IntCursor>::load(&column.save()).unwrap();
    assert_eq!(loaded.to_vec(), column.to_vec());
}

#[test]
fn stable_automerge_full_signed_timestamp_route_saves_reloads_and_preserves_hashes() {
    use automerge::transaction::{CommitOptions, Transactable};
    use automerge::{ActorId, AutoCommit, ROOT};
    let mut doc = AutoCommit::new();
    doc.set_actor(ActorId::from(vec![7; 16]));
    let times = [i64::MIN, -(1i64 << 62), 0, 1i64 << 62];
    for (index, time) in times.into_iter().enumerate() {
        doc.put(ROOT, "value", index as i64).unwrap();
        assert!(doc
            .commit_with(CommitOptions::default().with_time(time))
            .is_some());
    }
    let before: Vec<_> = doc
        .get_changes(&[])
        .iter()
        .map(|change| (change.hash(), change.raw_bytes().to_vec()))
        .collect();
    assert_eq!(
        doc.get_changes_meta(&[])
            .iter()
            .map(|change| change.timestamp)
            .collect::<Vec<_>>(),
        times
    );
    let saved = doc.save_nocompress();
    let mut loaded = AutoCommit::load(&saved).unwrap();
    assert_eq!(
        loaded
            .get_changes_meta(&[])
            .iter()
            .map(|change| change.timestamp)
            .collect::<Vec<_>>(),
        times
    );
    let after: Vec<_> = loaded
        .get_changes(&[])
        .iter()
        .map(|change| (change.hash(), change.raw_bytes().to_vec()))
        .collect();
    assert_eq!(after, before);
    assert_eq!(loaded.save_nocompress(), saved);
}

#[test]
fn stable_typed_delta_seek_reads_absolutes_for_null_negative_zero_and_extrema() {
    let values = [
        None,
        None,
        Some(i64::MIN),
        Some(-1),
        Some(0),
        Some(0),
        Some(i64::MAX),
        Some(i64::MAX),
    ];
    let column: ColumnData<DeltaCursor> = values.into_iter().collect();
    assert_eq!(column.scope_to_value(None::<i64>, ..), 0..2);
    assert_eq!(column.scope_to_value(Some(i64::MIN), ..), 2..3);
    assert_eq!(column.scope_to_value(Some(-1i64), ..), 3..4);
    assert_eq!(column.scope_to_value(Some(-2i64), ..), 3..3);
    assert_eq!(column.scope_to_value(Some(0i64), ..), 4..6);
    assert_eq!(column.scope_to_value(Some(1i64), ..), 6..6);
    assert_eq!(column.scope_to_value(Some(i64::MAX), ..), 6..8);
    let mut iter = column.iter_range(3..8);
    assert_eq!(iter.seek_to_value(Some(0i64), 3..7), 4..6);
    assert_eq!(iter.next().flatten().as_deref().copied(), Some(0));
    assert_eq!(iter.seek_to_value(Some(i64::MAX), 5..8), 6..8);
    assert_eq!(iter.next().flatten().as_deref().copied(), Some(i64::MAX));
}

#[test]
fn stable_delta_load_predicate_observes_absolute_interior_values() {
    let mut bytes = Vec::new();
    DeltaCursor::encode(&mut bytes, [5i64, 6, 7, 8]);
    let error = ColumnData::<DeltaCursor>::load_with(&bytes, &|value| {
        value
            .filter(|value| **value == 6)
            .map(|_| "interior six".to_string())
    })
    .unwrap_err();
    assert!(matches!(error, hexane::PackError::InvalidValue(message) if message == "interior six"));
    bytes.clear();
    DeltaCursor::encode(&mut bytes, [8i64, 5, 2]);
    let column = ColumnData::<DeltaCursor>::load_with(&bytes, &|value| {
        value
            .filter(|value| **value < 0)
            .map(|_| "negative absolute".to_string())
    })
    .unwrap();
    assert_eq!(column.to_vec(), [Some(8), Some(5), Some(2)]);
}
