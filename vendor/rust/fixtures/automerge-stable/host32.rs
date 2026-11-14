use automerge::transaction::{CommitOptions, Transactable};
use automerge::{ActorId, AutoCommit, Automerge, AutomergeError, Change, ExpandedChange, ReadDoc, ROOT};
use hexane::{ColumnData, DeltaCursor, HasPos};

#[test]
fn actual_host_maximum_counter_save_load_bundle_and_seek() {
    #[cfg(target_pointer_width = "32")]
    assert_eq!(std::mem::size_of::<usize>(), 4);
    #[cfg(target_pointer_width = "64")]
    assert_eq!(std::mem::size_of::<usize>(), 8);
    println!("actual usize bytes={} bits={}", std::mem::size_of::<usize>(), usize::BITS);
    let mut seed = AutoCommit::new();
    seed.set_actor(ActorId::from(vec![1; 16]));
    seed.put(ROOT, "max-counter", "retained").unwrap();
    seed.commit_with(CommitOptions::default().with_time(0).with_message("max counter"));
    let original = seed.get_changes(&[]).pop().unwrap();
    let mut expanded = ExpandedChange::from(&original);
    expanded.start_op = std::num::NonZeroU64::new(u64::from(u32::MAX)).unwrap();
    let change = Change::from(expanded);
    assert_eq!(change.max_op(), u64::from(u32::MAX));
    let mut doc = Automerge::new();
    doc.apply_changes([change.clone()]).unwrap();
    assert_eq!(doc.get(ROOT, "max-counter").unwrap().unwrap().0.as_str(), Some("retained"));
    let saved = doc.save_nocompress();
    assert_eq!(saved, include_bytes!("pristine-max-document.am"));
    println!("candidate after save bytes={}", saved.len());
    let loaded = Automerge::load(&saved).unwrap();
    println!("candidate after load");
    assert_eq!(loaded.get(ROOT, "max-counter").unwrap().unwrap().0.as_str(), Some("retained"));
    assert_eq!(loaded.save_nocompress(), saved);
    let decoded = loaded.get_changes(&[]);
    assert_eq!(decoded.len(), 1);
    assert_eq!(decoded[0].max_op(), u64::from(u32::MAX));
    assert_eq!(decoded[0].raw_bytes(), change.raw_bytes());
    #[cfg(target_pointer_width = "32")]
    match doc.bundle([change.hash()]) {
        Err(AutomergeError::EncodingError(message)) => {
            assert_eq!(message, "bundle counter range exceeds host address space");
            println!("actual bundle error={message}");
        }
        other => panic!("expected 32-bit host-size refusal, got {other:?}"),
    }
    #[cfg(target_pointer_width = "64")]
    {
        let bundle = doc.bundle([change.hash()]).unwrap();
        let changes = bundle.to_changes().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].raw_bytes(), change.raw_bytes());
        assert_eq!(changes[0].hash(), change.hash());
    }
    println!("saved document bytes={} change bytes={} hash={}", saved.len(), change.raw_bytes().len(), change.hash());
    println!("saved document hex={}", saved.iter().map(|byte| format!("{byte:02x}")).collect::<String>());
    let values = [None, Some(-1i64), Some(0), Some(0), Some(i64::from(u32::MAX)), Some(i64::from(u32::MAX))];
    let column: ColumnData<DeltaCursor> = values.into_iter().collect();
    assert_eq!(column.scope_to_value(None::<i64>, ..), 0..1);
    assert_eq!(column.scope_to_value(Some(0i64), ..), 2..4);
    assert_eq!(column.scope_to_value(Some(i64::from(u32::MAX)), ..), 4..6);
    assert_eq!(column.find_by_value(u32::MAX).collect::<Vec<_>>(), [4, 5]);
    let zero: Vec<_> = column.slabs.iter_where(|_, _| true).flat_map(|cursor| {
        cursor.element.find_by_range::<DeltaCursor>(cursor.weight.pos(), 0..1)
    }).collect();
    assert_eq!(zero, [2, 3]);
    let maximum: Vec<_> = column.slabs.iter_where(|_, _| true).flat_map(|cursor| {
        cursor.element.find_by_value::<DeltaCursor>(cursor.weight.pos(), hexane::Agg::new(u32::MAX))
    }).collect();
    assert_eq!(maximum, [4, 5]);
    println!("actual typed seek zero=2..4 max=4..6; native equality max={maximum:?} zero={zero:?}");
}

#[test]
fn actual_host_empty_change_after_maximum_preserves_header_and_only_empty_query() {
    let mut doc = Automerge::load(include_bytes!("pristine-max-document.am")).unwrap();
    let before = doc.get_changes(&[]);
    assert_eq!(before.len(), 1);
    let high = before[0].clone();
    let actor = ActorId::from(vec![2; 16]);
    let mut expected = ExpandedChange::from(&high);
    expected.operations.clear();
    expected.actor_id = actor.clone();
    expected.seq = 1;
    expected.start_op = std::num::NonZeroU64::new(u64::from(u32::MAX) + 1).unwrap();
    expected.time = 1;
    expected.message = Some("empty after max".into());
    expected.deps = vec![high.hash()];
    expected.hash = None;
    let expected = Change::from(expected);
    assert_eq!(expected.len(), 0);
    doc.set_actor(actor);
    let empty_hash = doc.empty_commit(CommitOptions::default().with_time(1).with_message("empty after max"));
    assert_eq!(empty_hash, expected.hash());
    let empty = doc.get_changes(&[high.hash()]);
    assert_eq!(empty.len(), 1);
    assert_eq!(empty[0].len(), 0);
    assert_eq!(empty[0].start_op().get(), u64::from(u32::MAX) + 1);
    assert_eq!(empty[0].max_op(), u64::from(u32::MAX));
    assert_eq!(empty[0].raw_bytes(), expected.raw_bytes());
    let all = doc.get_changes(&[]);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].raw_bytes(), high.raw_bytes());
    assert_eq!(all[1].raw_bytes(), expected.raw_bytes());
    let saved = doc.save_nocompress();
    let loaded = Automerge::load(&saved).unwrap();
    assert_eq!(loaded.save_nocompress(), saved);
    let only_empty = loaded.get_changes(&[high.hash()]);
    assert_eq!(only_empty.len(), 1);
    assert_eq!(only_empty[0].raw_bytes(), expected.raw_bytes());
    assert_eq!(loaded.get(ROOT, "max-counter").unwrap().unwrap().0.as_str(), Some("retained"));
    println!("empty after MAX: usize_bytes={}, start={}, max={}, raw_bytes={}, hash={}, only-empty count=1", std::mem::size_of::<usize>(), only_empty[0].start_op(), only_empty[0].max_op(), only_empty[0].raw_bytes().len(), only_empty[0].hash());
}
