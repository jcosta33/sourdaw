use crate::op_set2::op_set::RichTextQueryState;
use crate::op_set2::MarkData;
use crate::types::{Clock, OpId};
use hexane::PackError;
use hexane::{Acc, ColumnData, ColumnDataIter, HasAcc, HasPos, Slab, SlabWeight, SpanWeight};
use std::borrow::Cow;

use rustc_hash::FxHashSet;
use std::collections::HashMap;
use std::fmt::Debug;
use std::ops::{Add, AddAssign, Sub, SubAssign};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd)]
pub(crate) enum MarkIdx {
    Start(OpId),
    End(OpId),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MarkIndexBuilder {
    Start(OpId, MarkData<'static>),
    End(OpId),
}

impl MarkIdx {
    pub(super) fn as_i64(&self) -> i64 {
        match self {
            MarkIdx::Start(id) => {
                let tmp = ((id.actor() as i64) << 32) + ((id.counter() as i64) & 0xffffffff);
                debug_assert_eq!(self, &MarkIdx::load(tmp));
                tmp
            }
            MarkIdx::End(id) => {
                let tmp = -(((id.actor() as i64) << 32) + ((id.counter() as i64) & 0xffffffff));
                debug_assert_eq!(self, &MarkIdx::load(tmp));
                tmp
            }
        }
    }

    pub(super) fn load(v: i64) -> Self {
        if v < 0 {
            let v = -v as u64;
            let actor = (v >> 32) as usize;
            let ctr = v & 0xffffffff;
            Self::End(OpId::new(ctr, actor))
        } else {
            let v = v as u64;
            let actor = (v >> 32) as usize;
            let ctr = v & 0xffffffff;
            Self::Start(OpId::new(ctr, actor))
        }
    }

    pub(super) fn with_new_actor(self, idx: usize) -> Self {
        match self {
            Self::Start(id) => Self::Start(id.with_new_actor(idx)),
            Self::End(id) => Self::End(id.with_new_actor(idx)),
        }
    }
}

// ── Stable Hexane signed packing ────────────────────────────────────────────

impl hexane::Packable for MarkIdx {
    fn width(item: &Self) -> usize {
        hexane::lebsize(item.as_i64()) as usize
    }
    fn pack(item: &Self, out: &mut Vec<u8>) {
        leb128::write::signed(out, item.as_i64()).expect("writing to Vec cannot fail");
    }
    fn unpack(mut bytes: &[u8]) -> Result<(usize, Cow<'_, Self>), PackError> {
        let before = bytes.len();
        let value = leb128::read::signed(&mut bytes)?;
        Ok((before - bytes.len(), Cow::Owned(Self::load(value))))
    }
}

// ── MarkAcc: prefix-sum accumulator over Option<MarkIdx> ──────────────
//
// Each `OpId` appears at most once as a `Start` and at most once as an
// `End` per column (uniqueness guarantee).  So the net count for any
// `OpId` in any aggregate is always one of `{-1, 0, +1}` — and `0` is
// never stored (it cancels out).  Instead of a `HashMap<OpId, i32>` we
// keep two sets:
//
//   * `opens`  — `+1` entries: `Start` seen, `End` not yet matched.
//   * `closes` — `-1` entries: `End` seen, `Start` not yet matched.
//
// `FxHashSet` (vs the default `RandomState`) gives a 3–5× speedup per
// hash on the small, two-word `OpId` keys.
//
// For the **running prefix** during a left-to-right descent over a
// well-formed column, `closes` stays empty (every `End` cancels with a
// `Start` from an earlier subtree).  Per-subtree aggregates may have
// non-empty `closes` when a span crosses a subtree boundary.

#[derive(Clone, Default, Debug, PartialEq)]
pub(crate) struct MarkAcc {
    opens: FxHashSet<OpId>,
    closes: FxHashSet<OpId>,
}

impl MarkAcc {
    /// Flip a single `Start`/`End` delta into the accumulator.
    #[inline]
    fn apply_one(&mut self, val: MarkIdx) {
        match val {
            // Start cancels a prior dangling End; otherwise opens.
            MarkIdx::Start(id) => {
                if !self.closes.remove(&id) {
                    self.opens.insert(id);
                }
            }
            // End cancels a prior open; otherwise records a dangling close.
            MarkIdx::End(id) => {
                if !self.opens.remove(&id) {
                    self.closes.insert(id);
                }
            }
        }
    }
}

impl AddAssign for MarkAcc {
    fn add_assign(&mut self, rhs: Self) {
        for id in rhs.opens {
            if !self.closes.remove(&id) {
                self.opens.insert(id);
            }
        }
        for id in rhs.closes {
            if !self.opens.remove(&id) {
                self.closes.insert(id);
            }
        }
    }
}

/// Hot path: `SlabBTree::find_slab_at_item` descends a level by adding
/// each visited sibling's stored aggregate into the running prefix.
/// Borrowed RHS avoids cloning the child set; one HashSet op per entry.
impl AddAssign<&MarkAcc> for MarkAcc {
    fn add_assign(&mut self, rhs: &MarkAcc) {
        for &id in &rhs.opens {
            if !self.closes.remove(&id) {
                self.opens.insert(id);
            }
        }
        for &id in &rhs.closes {
            if !self.opens.remove(&id) {
                self.closes.insert(id);
            }
        }
    }
}

impl SubAssign for MarkAcc {
    fn sub_assign(&mut self, rhs: Self) {
        // Inverse of `add_assign`: an `open` from `rhs` either had merged
        // into `self.opens` (remove it) or had cancelled a prior dangling
        // close (restore it).  Symmetric for `closes`.
        for id in rhs.opens {
            if !self.opens.remove(&id) {
                self.closes.insert(id);
            }
        }
        for id in rhs.closes {
            if !self.closes.remove(&id) {
                self.opens.insert(id);
            }
        }
    }
}

impl Add for MarkAcc {
    type Output = Self;
    fn add(mut self, rhs: Self) -> Self {
        self += rhs;
        self
    }
}

impl Sub for MarkAcc {
    type Output = Self;
    fn sub(mut self, rhs: Self) -> Self {
        self -= rhs;
        self
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct MarkWeight {
    base: SlabWeight,
    marks: MarkAcc,
}
pub(crate) type MarkCursor = hexane::RleCursor<1024, MarkIdx, MarkWeight>;
impl HasPos for MarkWeight {
    fn pos(&self) -> usize {
        self.base.pos()
    }
}
impl HasAcc for MarkWeight {
    fn acc(&self) -> Acc {
        self.base.acc()
    }
}
impl SpanWeight<Slab> for MarkWeight {
    fn alloc(slab: &Slab) -> Self {
        let mut marks = MarkAcc::default();
        for run in slab.run_iter::<hexane::RleCursor<1024, MarkIdx>>() {
            if run.count > 0 {
                if let Some(value) = run.value {
                    marks.apply_one(*value);
                }
            }
        }
        Self {
            base: SlabWeight::alloc(slab),
            marks,
        }
    }
    fn and(mut self, other: &Self) -> Self {
        self.union(other);
        self
    }
    fn union(&mut self, other: &Self) {
        self.base.union(&other.base);
        self.marks += &other.marks;
    }
    fn maybe_sub(&mut self, _other: &Self) -> bool {
        false
    }
}

// ── MarkIndexColumn ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default)]
pub(crate) struct MarkIndexColumn {
    data: ColumnData<MarkCursor>,
    cache: HashMap<OpId, MarkData<'static>>,
}

impl MarkIndexColumn {
    pub(crate) fn new() -> Self {
        Self {
            data: ColumnData::new(),
            cache: HashMap::new(),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.data.len()
    }

    pub(crate) fn iter(&self) -> ColumnDataIter<'_, MarkCursor> {
        self.data.iter()
    }

    pub(crate) fn iter_range(
        &self,
        range: std::ops::Range<usize>,
    ) -> ColumnDataIter<'_, MarkCursor> {
        self.data.iter_range(range)
    }

    /// Whether any mark exists anywhere in the document: the cache holds
    /// the [`MarkData`] of every live mark-begin op.
    pub(crate) fn has_any_marks(&self) -> bool {
        !self.cache.is_empty()
    }

    pub(crate) fn mark_data(&self, id: &OpId) -> Option<&MarkData<'static>> {
        self.cache.get(id)
    }

    pub(crate) fn rewrite_with_new_actor(&mut self, idx: usize) {
        self.remap_values(|m| m.with_new_actor(idx));
        self.cache = self
            .cache
            .iter()
            .map(|(key, val)| (key.with_new_actor(idx), val.clone()))
            .collect();
    }

    /// Rebuild the data column with `f` applied to every mark idx —
    /// run at a time, so an unmarked document (all-null runs) costs a
    /// handful of run headers rather than a per-row materialize.
    fn remap_values(&mut self, f: impl Fn(MarkIdx) -> MarkIdx) {
        use hexane::EncoderState;
        let mut encoder = hexane::Encoder::<MarkCursor>::new(false);
        for run in self.data.run_iter() {
            let count = run.count;
            let value = run.value.map(|value| Cow::Owned(f(*value)));
            encoder
                .state
                .append_chunk(&mut encoder.writer, hexane::Run { count, value });
            encoder.len = encoder
                .len
                .checked_add(count)
                .expect("mark column row count");
        }
        self.data = encoder.into_column_data();
    }

    pub(crate) fn extend(&mut self, index: usize, values: Vec<Option<MarkIndexBuilder>>) {
        let mark_values: Vec<Option<MarkIdx>> = values
            .into_iter()
            .map(|v| match v? {
                MarkIndexBuilder::Start(id, mark) => {
                    self.cache.insert(id, mark);
                    Some(MarkIdx::Start(id))
                }
                MarkIndexBuilder::End(id) => Some(MarkIdx::End(id)),
            })
            .collect();
        self.data.splice(index, 0, mark_values);
    }

    pub(crate) fn undo(&mut self, index: usize, values: Vec<Option<MarkIndexBuilder>>) {
        let del = values.len();
        for v in &values {
            if let Some(MarkIndexBuilder::Start(id, _)) = v {
                self.cache.remove(id);
            }
        }
        let empty: Vec<Option<MarkIdx>> = Vec::new();
        self.data.splice(index, del, empty);
    }

    pub(crate) fn rich_text_at(
        &self,
        target: usize,
        clock: Option<&Clock>,
    ) -> RichTextQueryState<'static> {
        let mut marks = RichTextQueryState::default();
        for id in self.marks_at(target, clock) {
            let data = self.cache.get(&id).unwrap();
            marks.map.insert(id, data.clone());
        }
        marks
    }

    fn prefix_inclusive(&self, target: usize) -> MarkAcc {
        let end = target.saturating_add(1).min(self.data.len());
        if end == 0 {
            return MarkAcc::default();
        }
        let cursor = self
            .data
            .slabs
            .get_where_or_last(|prior, next| end < prior.pos() + next.pos());
        let mut left = end - cursor.weight.pos();
        let mut marks = cursor.weight.marks;
        for run in cursor
            .element
            .run_iter::<hexane::RleCursor<1024, MarkIdx>>()
        {
            let take = left.min(run.count);
            if take > 0 {
                if let Some(value) = run.value {
                    marks.apply_one(*value);
                }
            }
            left -= take;
            if left == 0 {
                break;
            }
        }
        marks
    }

    pub(crate) fn marks_at<'a>(
        &self,
        target: usize,
        clock: Option<&'a Clock>,
    ) -> impl Iterator<Item = OpId> + 'a {
        // For a well-formed mark column the running prefix at `target` has
        // an empty `closes` set — every `End` has cancelled with a prior
        // `Start`.  `opens` is the active mark set; iterate it directly.
        let acc = self.prefix_inclusive(target);
        debug_assert!(
            acc.closes.is_empty(),
            "running prefix at marks_at({target}) has dangling closes — \
             malformed mark column?"
        );
        acc.opens
            .into_iter()
            .filter(move |id| clock.map(|c| c.covers(id)).unwrap_or(true))
    }

    #[cfg(test)]
    pub(crate) fn save(&self) -> Vec<u8> {
        self.data.save()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::op_set2::types::ScalarValue;
    use std::borrow::Cow;
    use std::collections::{BTreeSet, HashSet};

    fn mk_mark(name: &str) -> MarkData<'static> {
        MarkData {
            name: Cow::Owned(name.to_string()),
            value: ScalarValue::Boolean(true),
        }
    }

    fn id(actor: usize, counter: u64) -> OpId {
        OpId::new(counter, actor)
    }

    /// Build a column with `n` positions. `marks` is a list of (start_pos, end_pos, actor, counter, name).
    /// Start and End occupy existing positions (they don't insert new entries).
    fn build_column(n: usize, marks: &[(usize, usize, usize, u64, &str)]) -> MarkIndexColumn {
        let mut col = MarkIndexColumn::new();
        let mut values: Vec<Option<MarkIndexBuilder>> = vec![None; n];
        for &(start, end, actor, counter, name) in marks {
            let op_id = id(actor, counter);
            values[start] = Some(MarkIndexBuilder::Start(op_id, mk_mark(name)));
            values[end] = Some(MarkIndexBuilder::End(op_id));
        }
        col.extend(0, values);
        col
    }

    fn active_mark_ids(col: &MarkIndexColumn, pos: usize) -> BTreeSet<OpId> {
        col.marks_at(pos, None).collect()
    }

    fn active_mark_names(col: &MarkIndexColumn, pos: usize) -> Vec<String> {
        let rt = col.rich_text_at(pos, None);
        let mut names: Vec<String> = rt.map.values().map(|m| m.name.to_string()).collect();
        names.sort();
        names
    }

    /// Find the column positions of Start and End entries for a given OpId.
    fn find_mark_positions(col: &MarkIndexColumn, target: OpId) -> Vec<usize> {
        col.data
            .iter()
            .map(|value| value.map(|value| *value))
            .enumerate()
            .filter_map(|(pos, val)| match val {
                Some(MarkIdx::Start(idv)) | Some(MarkIdx::End(idv)) if idv == target => Some(pos),
                _ => None,
            })
            .collect()
    }

    // ── Basic tests ─────────────────────────────────────────────────────

    #[test]
    fn empty_column() {
        let col = MarkIndexColumn::new();
        let rt = col.rich_text_at(0, None);
        assert!(rt.map.is_empty());
    }

    #[test]
    fn single_mark_span() {
        // 10 positions: mark "bold" spans positions 2..7
        // Layout: [_, _, S, _, _, _, _, E, _, _]
        let col = build_column(10, &[(2, 7, 0, 1, "bold")]);

        // Before the mark
        assert!(active_mark_names(&col, 0).is_empty());
        assert!(active_mark_names(&col, 1).is_empty());

        // Inside the mark (start is inclusive)
        assert_eq!(active_mark_names(&col, 2), vec!["bold"]);
        assert_eq!(active_mark_names(&col, 4), vec!["bold"]);
        assert_eq!(active_mark_names(&col, 6), vec!["bold"]);

        // At and after the end
        assert!(active_mark_names(&col, 7).is_empty());
        assert!(active_mark_names(&col, 9).is_empty());
    }

    #[test]
    fn multiple_non_overlapping_marks() {
        // [_, S(bold), _, E(bold), _, S(italic), _, E(italic), _]
        let col = build_column(9, &[(1, 3, 0, 1, "bold"), (5, 7, 0, 2, "italic")]);

        assert!(active_mark_names(&col, 0).is_empty());
        assert_eq!(active_mark_names(&col, 1), vec!["bold"]);
        assert_eq!(active_mark_names(&col, 2), vec!["bold"]);
        assert!(active_mark_names(&col, 3).is_empty());
        assert!(active_mark_names(&col, 4).is_empty());
        assert_eq!(active_mark_names(&col, 5), vec!["italic"]);
        assert_eq!(active_mark_names(&col, 6), vec!["italic"]);
        assert!(active_mark_names(&col, 7).is_empty());
    }

    #[test]
    fn overlapping_marks() {
        // bold: 1..6, italic: 3..8
        // [_, S(b), _, S(i), _, _, E(b), _, E(i), _]
        let col = build_column(10, &[(1, 6, 0, 1, "bold"), (3, 8, 0, 2, "italic")]);

        assert!(active_mark_names(&col, 0).is_empty());
        assert_eq!(active_mark_names(&col, 1), vec!["bold"]);
        assert_eq!(active_mark_names(&col, 2), vec!["bold"]);
        // Overlap region
        assert_eq!(active_mark_names(&col, 3), vec!["bold", "italic"]);
        assert_eq!(active_mark_names(&col, 5), vec!["bold", "italic"]);
        // After bold ends
        assert_eq!(active_mark_names(&col, 6), vec!["italic"]);
        assert_eq!(active_mark_names(&col, 7), vec!["italic"]);
        assert!(active_mark_names(&col, 8).is_empty());
    }

    #[test]
    fn nested_marks() {
        // outer: 0..9, inner: 3..6
        let col = build_column(10, &[(0, 9, 0, 1, "outer"), (3, 6, 0, 2, "inner")]);

        assert_eq!(active_mark_names(&col, 0), vec!["outer"]);
        assert_eq!(active_mark_names(&col, 2), vec!["outer"]);
        assert_eq!(active_mark_names(&col, 3), vec!["inner", "outer"]);
        assert_eq!(active_mark_names(&col, 5), vec!["inner", "outer"]);
        assert_eq!(active_mark_names(&col, 6), vec!["outer"]);
        assert_eq!(active_mark_names(&col, 8), vec!["outer"]);
        assert!(active_mark_names(&col, 9).is_empty());
    }

    // ── Undo tests ──────────────────────────────────────────────────────

    #[test]
    fn undo_removes_mark() {
        // bold: 2..7, italic: 4..9
        let mut col = build_column(12, &[(2, 7, 0, 1, "bold"), (4, 9, 0, 2, "italic")]);

        assert_eq!(active_mark_names(&col, 5), vec!["bold", "italic"]);

        let bold_id = id(0, 1);
        let bold_positions = find_mark_positions(&col, bold_id);
        assert_eq!(bold_positions.len(), 2, "expected Start + End for bold");

        col.undo(
            bold_positions[1],
            vec![Some(MarkIndexBuilder::End(bold_id))],
        );
        col.undo(
            bold_positions[0],
            vec![Some(MarkIndexBuilder::Start(bold_id, mk_mark("bold")))],
        );

        // Bold should be gone, italic should remain.
        for i in 0..col.len() {
            let names = active_mark_names(&col, i);
            assert!(
                !names.contains(&"bold".to_string()),
                "bold should be undone at position {i}, got {names:?}"
            );
        }

        // Italic should still be active in its range.
        let any_italic =
            (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"italic".to_string()));
        assert!(any_italic, "italic should still be active somewhere");
    }

    #[test]
    fn undo_preserves_other_marks() {
        // Three marks: a(1..5), b(3..8), c(6..10)
        let mut col = build_column(
            12,
            &[(1, 5, 0, 1, "a"), (3, 8, 0, 2, "b"), (6, 10, 0, 3, "c")],
        );

        // Verify all three at various positions.
        assert_eq!(active_mark_names(&col, 1), vec!["a"]);
        assert_eq!(active_mark_names(&col, 4), vec!["a", "b"]);
        assert_eq!(active_mark_names(&col, 7), vec!["b", "c"]);

        let b_id = id(0, 2);
        let b_positions = find_mark_positions(&col, b_id);
        assert_eq!(b_positions.len(), 2);

        col.undo(b_positions[1], vec![Some(MarkIndexBuilder::End(b_id))]);
        col.undo(
            b_positions[0],
            vec![Some(MarkIndexBuilder::Start(b_id, mk_mark("b")))],
        );

        // Check every position — "b" should be gone, "a" and "c" intact.
        for i in 0..col.len() {
            let names = active_mark_names(&col, i);
            assert!(
                !names.contains(&"b".to_string()),
                "mark 'b' should be undone at pos {i}, got {names:?}"
            );
        }

        let any_a = (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"a".to_string()));
        let any_c = (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"c".to_string()));
        assert!(any_a, "mark 'a' should still exist");
        assert!(any_c, "mark 'c' should still exist");
    }

    #[test]
    fn undo_verify_every_position() {
        // 15 positions, 3 marks:
        //   bold:      pos 2..8  (Start@2, End@8)
        //   italic:    pos 4..11 (Start@4, End@11)
        //   underline: pos 6..13 (Start@6, End@13)
        let mut col = build_column(
            15,
            &[
                (2, 8, 0, 1, "bold"),
                (4, 11, 0, 2, "italic"),
                (6, 13, 0, 3, "underline"),
            ],
        );

        // Snapshot every position's marks before undo.
        let before: Vec<Vec<String>> = (0..col.len()).map(|i| active_mark_names(&col, i)).collect();

        // Verify known positions.
        assert_eq!(before[0], Vec::<String>::new());
        assert_eq!(before[2], vec!["bold"]);
        assert_eq!(before[5], vec!["bold", "italic"]);
        assert_eq!(before[7], vec!["bold", "italic", "underline"]);
        assert_eq!(before[9], vec!["italic", "underline"]);
        assert_eq!(before[12], vec!["underline"]);
        assert_eq!(before[14], Vec::<String>::new());

        // Undo italic (id=0,2). Find its positions.
        let italic_id = id(0, 2);
        let italic_positions = find_mark_positions(&col, italic_id);
        assert_eq!(italic_positions.len(), 2);

        col.undo(
            italic_positions[1],
            vec![Some(MarkIndexBuilder::End(italic_id))],
        );
        col.undo(
            italic_positions[0],
            vec![Some(MarkIndexBuilder::Start(italic_id, mk_mark("italic")))],
        );

        // Column is now 13 items (15 - 2 removed).
        assert_eq!(col.len(), 13);

        // Check every position — italic should be gone.
        for i in 0..col.len() {
            let names = active_mark_names(&col, i);
            assert!(
                !names.contains(&"italic".to_string()),
                "italic should be gone at pos {i}, got {names:?}"
            );
        }

        let has_bold =
            (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"bold".to_string()));
        let has_underline =
            (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"underline".to_string()));
        assert!(has_bold, "bold should still exist");
        assert!(has_underline, "underline should still exist");

        // Now undo underline too.
        let underline_id = id(0, 3);
        let underline_positions = find_mark_positions(&col, underline_id);
        assert_eq!(underline_positions.len(), 2);

        col.undo(
            underline_positions[1],
            vec![Some(MarkIndexBuilder::End(underline_id))],
        );
        col.undo(
            underline_positions[0],
            vec![Some(MarkIndexBuilder::Start(
                underline_id,
                mk_mark("underline"),
            ))],
        );

        assert_eq!(col.len(), 11);

        // Only bold should remain.
        for i in 0..col.len() {
            let names = active_mark_names(&col, i);
            assert!(!names.contains(&"italic".to_string()), "italic at pos {i}");
            assert!(
                !names.contains(&"underline".to_string()),
                "underline at pos {i}"
            );
        }
        let has_bold =
            (0..col.len()).any(|i| active_mark_names(&col, i).contains(&"bold".to_string()));
        assert!(
            has_bold,
            "bold should still exist after undoing italic+underline"
        );
    }

    #[test]
    fn rich_text_at_every_position() {
        // Comprehensive check: 3 marks, verify every position.
        // bold: 2..6, italic: 4..10, underline: 8..12
        let col = build_column(
            15,
            &[
                (2, 6, 0, 1, "bold"),
                (4, 10, 0, 2, "italic"),
                (8, 12, 0, 3, "underline"),
            ],
        );

        for i in 0..col.len() {
            let names = active_mark_names(&col, i);
            let ids: BTreeSet<OpId> = active_mark_ids(&col, i);

            let rt = col.rich_text_at(i, None);
            assert_eq!(rt.map.len(), names.len(), "pos {i}: map len != names len");

            for mid in &ids {
                assert!(
                    rt.map.contains_key(mid),
                    "pos {i}: mark {mid:?} in marks_at but not in rich_text_at"
                );
            }
        }
    }

    /// Brute-force oracle: scan linearly to compute which marks are active at `pos`.
    fn oracle_marks_at(values: &[Option<MarkIdx>], pos: usize) -> BTreeSet<OpId> {
        let mut open = BTreeSet::new();
        for (i, v) in values.iter().enumerate() {
            if i > pos {
                break;
            }
            match v {
                Some(MarkIdx::Start(id)) => {
                    open.insert(*id);
                }
                Some(MarkIdx::End(id)) => {
                    open.remove(id);
                }
                None => {}
            }
        }
        open
    }

    #[test]
    #[ignore]
    fn large_column_multi_slab() {
        use rand::{RngExt, SeedableRng};
        let mut rng = rand::rngs::SmallRng::seed_from_u64(42);

        let n = 100_000;
        let mut values: Vec<Option<MarkIdx>> = vec![None; n];
        let mut cache_entries: Vec<(OpId, MarkData<'static>)> = Vec::new();

        let num_marks = 2500;
        let mut mark_ids: Vec<(OpId, usize, usize)> = Vec::new();

        for i in 0..num_marks {
            let op_id = id(0, i as u64 + 1);
            let start = rng.random_range(0..n - 2);
            let end = rng.random_range(start + 1..n);
            if values[start].is_none() && values[end].is_none() {
                values[start] = Some(MarkIdx::Start(op_id));
                values[end] = Some(MarkIdx::End(op_id));
                mark_ids.push((op_id, start, end));
                cache_entries.push((op_id, mk_mark(&format!("m{i}"))));
            }
        }

        let placed = mark_ids.len();
        assert!(placed > 100, "need enough marks placed, got {placed}");

        let mut col = MarkIndexColumn::new();
        let builder_values: Vec<Option<MarkIndexBuilder>> = values
            .iter()
            .map(|v| match v {
                Some(MarkIdx::Start(id)) => {
                    let data = cache_entries
                        .iter()
                        .find(|(cid, _)| cid == id)
                        .unwrap()
                        .1
                        .clone();
                    Some(MarkIndexBuilder::Start(*id, data))
                }
                Some(MarkIdx::End(id)) => Some(MarkIndexBuilder::End(*id)),
                None => None,
            })
            .collect();
        col.extend(0, builder_values);

        assert_eq!(col.len(), n);
        assert!(
            col.data.slabs.len() > 1,
            "need multiple slabs, got {}",
            col.data.slabs.len()
        );

        let check_positions: Vec<usize> = (0..200)
            .map(|_| rng.random_range(0..n))
            .chain([0, 1, n / 4, n / 2, 3 * n / 4, n - 2, n - 1])
            .collect();

        for &pos in &check_positions {
            let expected = oracle_marks_at(&values, pos);
            let actual = active_mark_ids(&col, pos);
            assert_eq!(expected, actual, "mismatch at pos {pos} (before undo)");
        }

        // Undo every 3rd mark.
        let marks_to_undo: Vec<(OpId, usize, usize)> = mark_ids
            .iter()
            .enumerate()
            .filter(|(i, _)| i % 3 == 0)
            .map(|(_, m)| *m)
            .collect();

        for &(op_id, _start, _end) in marks_to_undo.iter().rev() {
            let positions = find_mark_positions(&col, op_id);
            assert_eq!(
                positions.len(),
                2,
                "mark {op_id:?} should have Start+End, found {:?}",
                positions
            );
            col.undo(positions[1], vec![Some(MarkIndexBuilder::End(op_id))]);
            col.undo(
                positions[0],
                vec![Some(MarkIndexBuilder::Start(
                    op_id,
                    cache_entries
                        .iter()
                        .find(|(cid, _)| *cid == op_id)
                        .unwrap()
                        .1
                        .clone(),
                ))],
            );
        }

        let undone_ids: HashSet<OpId> = marks_to_undo.iter().map(|(id, _, _)| *id).collect();
        let remaining_values: Vec<Option<MarkIdx>> = values
            .iter()
            .filter(|v| match v {
                Some(MarkIdx::Start(id)) | Some(MarkIdx::End(id)) => !undone_ids.contains(id),
                None => true,
            })
            .cloned()
            .collect();

        assert_eq!(
            col.len(),
            remaining_values.len(),
            "column length after undo"
        );

        let new_len = col.len();
        let check_positions: Vec<usize> = (0..200)
            .map(|_| rng.random_range(0..new_len))
            .chain([0, 1, new_len / 4, new_len / 2, 3 * new_len / 4, new_len - 1])
            .collect();

        for &pos in &check_positions {
            let expected = oracle_marks_at(&remaining_values, pos);
            let actual = active_mark_ids(&col, pos);
            assert_eq!(
                expected, actual,
                "mismatch at pos {pos} (after undo, col_len={new_len})"
            );
        }
    }
}

#[cfg(test)]
mod root_port_weight_tests {
    use super::*;
    use crate::op_set2::types::ScalarValue;
    use std::collections::BTreeSet;

    fn mark() -> MarkData<'static> {
        MarkData {
            name: Cow::Borrowed("shared"),
            value: ScalarValue::Boolean(true),
        }
    }

    fn assert_prefixes(column: &MarkIndexColumn, values: &[Option<MarkIndexBuilder>]) {
        let mut expected = BTreeSet::new();
        for (position, value) in values.iter().enumerate() {
            match value {
                Some(MarkIndexBuilder::Start(id, _)) => {
                    assert!(expected.insert(*id));
                }
                Some(MarkIndexBuilder::End(id)) => {
                    assert!(expected.remove(id));
                }
                None => {}
            }
            let actual: BTreeSet<_> = column.marks_at(position, None).collect();
            assert_eq!(actual, expected, "inclusive mark prefix {position}");
            for id in &actual {
                assert_eq!(column.mark_data(id).unwrap(), &mark());
            }
        }
    }

    #[test]
    fn root_port_mark_weight_multi_node_split_delete_remap_and_undo() {
        let mut values = Vec::new();
        for index in 0..1000u64 {
            let left = OpId::new(index * 2 + 1, 65536);
            let right = OpId::new(index * 2 + 2, 65537);
            values.extend([
                Some(MarkIndexBuilder::Start(left, mark())),
                Some(MarkIndexBuilder::Start(right, mark())),
                Some(MarkIndexBuilder::End(left)),
                None,
                Some(MarkIndexBuilder::End(right)),
            ]);
        }
        let mut column = MarkIndexColumn::new();
        column.extend(0, values.clone());
        eprintln!(
            "mark tree: rows={}, slabs={}",
            column.len(),
            column.data.slabs.len()
        );
        assert!(
            column.data.slabs.len() > 2 * 16 - 1,
            "exceeds stable SpanTree leaf capacity (2 * B - 1, B = 16)"
        );
        assert_prefixes(&column, &values);
        let inserted_id = OpId::new(9001, 2);
        let inserted = vec![
            Some(MarkIndexBuilder::Start(inserted_id, mark())),
            None,
            Some(MarkIndexBuilder::End(inserted_id)),
        ];
        column.extend(1023, inserted.clone());
        values.splice(1023..1023, inserted.clone());
        assert_prefixes(&column, &values);
        column.undo(1023, inserted);
        values.drain(1023..1026);
        assert!(column.mark_data(&inserted_id).is_none());
        assert_prefixes(&column, &values);
        let deleted: Vec<_> = values.drain(4095..4100).collect();
        column.undo(4095, deleted);
        assert_prefixes(&column, &values);
        column.rewrite_with_new_actor(0);
        for value in values.iter_mut().flatten() {
            match value {
                MarkIndexBuilder::Start(id, _) | MarkIndexBuilder::End(id) => {
                    *id = id.with_new_actor(0)
                }
            }
        }
        assert_prefixes(&column, &values);
    }
}
