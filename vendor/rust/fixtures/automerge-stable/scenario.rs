use automerge::marks::{ExpandMark, Mark};
use automerge::transaction::{CommitOptions, Transactable};
use automerge::{ActorId, AutoCommit, ObjType, ScalarValue, TextEncoding, ROOT};

fn commit(doc: &mut AutoCommit, time: i64, message: &str) {
    assert!(doc
        .commit_with(
            CommitOptions::default()
                .with_time(time)
                .with_message(message)
        )
        .is_some());
}

pub fn build_document() -> AutoCommit {
    let mut doc = AutoCommit::new_with_encoding(TextEncoding::UnicodeCodePoint);
    doc.set_actor(ActorId::from(vec![0x22; 16]));
    let text = doc.put_object(ROOT, "text", ObjType::Text).unwrap();
    doc.splice_text(&text, 0, 0, "aμ🙂bcdefghij").unwrap();
    let list = doc.put_object(ROOT, "list", ObjType::List).unwrap();
    doc.insert(&list, 0, 19).unwrap();
    doc.insert(&list, 1, "μ").unwrap();
    doc.insert(&list, 2, false).unwrap();
    doc.put(ROOT, "counter", ScalarValue::counter(10)).unwrap();
    doc.put(ROOT, "empty", ScalarValue::Bytes(vec![])).unwrap();
    let raw: Vec<u8> = (0..8193)
        .map(|offset| ((offset * 37 + 11) % 251) as u8)
        .collect();
    doc.put(ROOT, "raw", ScalarValue::Bytes(raw)).unwrap();
    commit(&mut doc, -3, "base μ");
    let mut left = doc.fork();
    left.set_actor(ActorId::from(vec![0x11; 16]));
    left.put(ROOT, "conflict", "left").unwrap();
    left.increment(ROOT, "counter", 3).unwrap();
    left.mark(
        &text,
        Mark::new("bold".into(), true, 2, 7),
        ExpandMark::None,
    )
    .unwrap();
    commit(&mut left, 0, "");
    let mut right = doc.fork();
    right.set_actor(ActorId::from(vec![0x33; 16]));
    right.put(ROOT, "conflict", "right").unwrap();
    right.increment(ROOT, "counter", -2).unwrap();
    right
        .mark(
            &text,
            Mark::new("italic".into(), "yes", 4, 9),
            ExpandMark::Both,
        )
        .unwrap();
    commit(&mut right, 7, "right μ");
    doc.merge(&mut left).unwrap();
    doc.merge(&mut right).unwrap();
    doc.put(ROOT, "tail", 23).unwrap();
    doc.delete(&list, 0).unwrap();
    commit(&mut doc, 11, "tail");
    doc
}
