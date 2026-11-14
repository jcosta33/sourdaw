//! Domain validation and weights over the genuine stable Hexane cursors.
use hexane::{
    Acc, ColumnCursor, ColumnData, HasAcc, HasPos, PackError, Slab, SlabWeight, SpanWeight,
};
use std::ops::Range;

pub(crate) type CounterCursor = hexane::WeightedDeltaCursor<CounterWeight>;
pub(crate) type CountCursor = hexane::RleCursor<1024, u32>;

#[cfg(test)]
thread_local! {
    static COUNTER_SLAB_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(crate) fn record_counter_slab_visit() {
    COUNTER_SLAB_VISITS.with(|count| count.set(count.get() + 1));
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct CounterWeight {
    base: SlabWeight,
    min: Option<i64>,
    max: Option<i64>,
    has_null: bool,
}
impl CounterWeight {
    fn contains(&self, target: i64) -> bool {
        self.min.is_some_and(|min| min <= target) && self.max.is_some_and(|max| target <= max)
    }
    pub(crate) fn intersects(&self, range: &Range<usize>) -> bool {
        match (self.min, self.max) {
            (Some(min), Some(max)) => {
                i128::from(max) >= i128::try_from(range.start).expect("usize fits i128")
                    && i128::from(min) < i128::try_from(range.end).expect("usize fits i128")
            }
            _ => false,
        }
    }
}

/// Equality uses the signed domain weight rather than nonzero-u32 Agg. Decode
/// only matching slabs, including counter zero and u32::MAX on 32-bit targets.
pub(crate) fn find_counter_value(
    column: &ColumnData<CounterCursor>,
    target: u64,
) -> impl Iterator<Item = usize> + '_ {
    let target = u32::try_from(target).ok();
    column
        .slabs
        .iter_where(move |_, weight| target.is_some_and(|value| weight.contains(i64::from(value))))
        .flat_map(move |cursor| {
            #[cfg(test)]
            record_counter_slab_visit();
            let start = cursor.weight.pos();
            if target == Some(0) {
                itertools::Either::Left(cursor.element.find_by_range::<CounterCursor>(start, 0..1))
            } else {
                itertools::Either::Right(cursor.element.find_by_value::<CounterCursor>(
                    start,
                    hexane::Agg::from(target.expect("matching slab requires a u32 counter")),
                ))
            }
        })
}
impl HasPos for CounterWeight {
    fn pos(&self) -> usize {
        self.base.pos()
    }
}
impl HasAcc for CounterWeight {
    fn acc(&self) -> Acc {
        self.base.acc()
    }
}
impl SpanWeight<Slab> for CounterWeight {
    fn alloc(slab: &Slab) -> Self {
        let mut result = Self {
            base: SlabWeight::alloc(slab),
            ..Self::default()
        };
        let mut absolute = i128::from(slab.abs());
        let mut cursor = hexane::IntCursor::default();
        while let Some(run) = cursor
            .try_next(slab.as_slice())
            .expect("validated delta slab")
        {
            if let Some(delta) = run.value {
                let step = i128::from(*delta);
                let first = absolute + step;
                absolute += step * i128::try_from(run.count).expect("row count fits i128");
                let low =
                    i64::try_from(first.min(absolute)).expect("validated delta absolute value");
                let high =
                    i64::try_from(first.max(absolute)).expect("validated delta absolute value");
                result.min = Some(result.min.map_or(low, |old| old.min(low)));
                result.max = Some(result.max.map_or(high, |old| old.max(high)));
            } else {
                result.has_null = true;
            }
        }
        result
    }
    fn and(mut self, other: &Self) -> Self {
        self.union(other);
        self
    }
    fn union(&mut self, other: &Self) {
        self.base.union(&other.base);
        if let Some(value) = other.min {
            self.min = Some(self.min.map_or(value, |old| old.min(value)));
        }
        if let Some(value) = other.max {
            self.max = Some(self.max.map_or(value, |old| old.max(value)));
        }
        self.has_null |= other.has_null;
    }
    fn maybe_sub(&mut self, _other: &Self) -> bool {
        false
    }
}

/// Check absolute u32 values, including every endpoint of a repeated delta run,
/// before stable decoding builds weights. Negative deltas themselves are valid.
pub(crate) fn load_counter_column(
    bytes: &[u8],
    len: usize,
    nullable: bool,
    fill_null: bool,
) -> Result<ColumnData<CounterCursor>, PackError> {
    if bytes.is_empty() && fill_null {
        return Ok(ColumnData::init_empty(len));
    }
    let mut cursor = hexane::IntCursor::default();
    let mut rows = 0usize;
    let mut absolute = 0i128;
    while let Some(run) = cursor.try_next(bytes)? {
        rows = rows.checked_add(run.count).ok_or(PackError::BadFormat)?;
        match run.value {
            Some(delta) => {
                let step = i128::from(*delta);
                let first = absolute.checked_add(step).ok_or(PackError::BadFormat)?;
                absolute = absolute
                    .checked_add(
                        step.checked_mul(
                            i128::try_from(run.count).map_err(|_| PackError::BadFormat)?,
                        )
                        .ok_or(PackError::BadFormat)?,
                    )
                    .ok_or(PackError::BadFormat)?;
                if first.min(absolute) < 0 || first.max(absolute) > i128::from(u32::MAX) {
                    return Err(PackError::InvalidValue(
                        "delta absolute value is outside u32".into(),
                    ));
                }
            }
            None if !nullable => {
                return Err(PackError::InvalidValue(
                    "null required operation counter".into(),
                ))
            }
            None => {}
        }
    }
    if rows != len {
        return Err(PackError::InvalidLength(rows, len));
    }
    ColumnData::load(bytes)
}

pub(crate) fn require_value<T>(value: Option<&T>) -> Option<String> {
    value.is_none().then(|| "null required column value".into())
}

/// Typed domain view of the stable cursor's scalar accumulator. This adapter owns
/// no column bytes or index: all positions and sums come from ColumnDataIter.
pub(crate) trait ScalarPrefix: Copy + std::fmt::Debug {
    type Cursor: ColumnCursor<Item: 'static> + 'static;
    type Total: Copy + std::fmt::Debug + std::ops::Sub<Output = Self::Total>;
    fn read(value: Option<std::borrow::Cow<'_, <Self::Cursor as ColumnCursor>::Item>>) -> Self;
    fn units(self) -> u64;
    fn from_total(total: u64) -> Self::Total;
    fn as_total(total: Self::Total) -> u64;
}
impl ScalarPrefix for bool {
    type Cursor = hexane::BooleanCursor;
    type Total = usize;
    fn read(value: Option<std::borrow::Cow<'_, bool>>) -> Self {
        *value.expect("boolean cursor always supplies a value")
    }
    fn units(self) -> u64 {
        u64::from(self)
    }
    fn from_total(total: u64) -> usize {
        usize::try_from(total).expect("boolean prefix fits column length")
    }
    fn as_total(total: usize) -> u64 {
        u64::try_from(total).expect("column length fits u64")
    }
}
impl ScalarPrefix for u32 {
    type Cursor = CountCursor;
    type Total = u64;
    fn read(value: Option<std::borrow::Cow<'_, u32>>) -> Self {
        *value.expect("validated required count value")
    }
    fn units(self) -> u64 {
        u64::from(self)
    }
    fn from_total(total: u64) -> u64 {
        total
    }
    fn as_total(total: u64) -> u64 {
        total
    }
}
impl ScalarPrefix for Option<u32> {
    type Cursor = CountCursor;
    type Total = u64;
    fn read(value: Option<std::borrow::Cow<'_, u32>>) -> Self {
        value.map(|value| *value)
    }
    fn units(self) -> u64 {
        self.map(u64::from).unwrap_or(0)
    }
    fn from_total(total: u64) -> u64 {
        total
    }
    fn as_total(total: u64) -> u64 {
        total
    }
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct ScalarPrefixItem<T: ScalarPrefix> {
    pub(crate) value: T,
    total: T::Total,
}
impl<T: ScalarPrefix> ScalarPrefixItem<T> {
    pub(crate) fn total(&self) -> T::Total {
        self.total
    }
    pub(crate) fn prefix(&self) -> T::Total {
        T::from_total(T::as_total(self.total) - self.value.units())
    }
}
pub(crate) struct ScalarPrefixSeek<T: ScalarPrefix> {
    pub(crate) pos: usize,
    pub(crate) delta: T::Total,
    pub(crate) pv: ScalarPrefixItem<T>,
}
pub(crate) struct ScalarPrefixRun<T: ScalarPrefix> {
    pub(crate) count: usize,
    pub(crate) value: ScalarPrefixItem<T>,
}
#[derive(Clone, Debug)]
pub(crate) struct ScalarPrefixIter<'a, T: ScalarPrefix> {
    iter: hexane::ColumnDataIter<'a, T::Cursor>,
    marker: std::marker::PhantomData<T>,
}
impl<T: ScalarPrefix> Default for ScalarPrefixIter<'_, T> {
    fn default() -> Self {
        Self {
            iter: Default::default(),
            marker: std::marker::PhantomData,
        }
    }
}
impl<'a, T: ScalarPrefix> ScalarPrefixIter<'a, T> {
    pub(crate) fn new(column: &'a ColumnData<T::Cursor>, range: Range<usize>) -> Self {
        Self {
            iter: column.iter_range(range),
            marker: std::marker::PhantomData,
        }
    }
    pub(crate) fn pos(&self) -> usize {
        self.iter.pos()
    }
    pub(crate) fn end_pos(&self) -> usize {
        self.iter.end_pos()
    }
    pub(crate) fn total(&self) -> T::Total {
        T::from_total(self.iter.calculate_acc().as_u64())
    }
    pub(crate) fn set_max(&mut self, max: usize) {
        self.iter.set_max(max);
    }
    pub(crate) fn advance_to(&mut self, target: usize) {
        self.iter.advance_to(target);
    }
    pub(crate) fn advance_by(&mut self, count: usize) {
        self.iter.advance_by(count);
    }
    pub(crate) fn shift_next(&mut self, range: Range<usize>) -> Option<ScalarPrefixItem<T>> {
        let value = T::read(self.iter.shift_next(range)?);
        Some(ScalarPrefixItem {
            value,
            total: self.total(),
        })
    }
    pub(crate) fn next_run(&mut self) -> Option<ScalarPrefixRun<T>> {
        let run = self.iter.next_run()?;
        let value = T::read(run.value);
        Some(ScalarPrefixRun {
            count: run.count,
            value: ScalarPrefixItem {
                value,
                total: self.total(),
            },
        })
    }
    pub(crate) fn delta_nth(&mut self, count: usize) -> Option<ScalarPrefixSeek<T>> {
        let base = self.total();
        let pv = self.nth(count)?;
        Some(ScalarPrefixSeek {
            pos: self.pos() - 1,
            delta: pv.prefix() - base,
            pv,
        })
    }
    pub(crate) fn advance_prefix(&mut self, units: T::Total) -> Option<ScalarPrefixSeek<T>> {
        let base = self.total();
        self.iter.advance_acc_by(Acc(T::as_total(units)));
        let pv = self.next()?;
        Some(ScalarPrefixSeek {
            pos: self.pos() - 1,
            delta: pv.prefix() - base,
            pv,
        })
    }
}
impl<T: ScalarPrefix> Iterator for ScalarPrefixIter<'_, T> {
    type Item = ScalarPrefixItem<T>;
    fn next(&mut self) -> Option<Self::Item> {
        let value = T::read(self.iter.next()?);
        Some(ScalarPrefixItem {
            value,
            total: self.total(),
        })
    }
    fn nth(&mut self, count: usize) -> Option<Self::Item> {
        let value = T::read(self.iter.nth(count)?);
        Some(ScalarPrefixItem {
            value,
            total: self.total(),
        })
    }
}

pub(crate) fn scalar_prefix_get<T: ScalarPrefix>(
    column: &ColumnData<T::Cursor>,
    index: usize,
) -> Option<ScalarPrefixItem<T>> {
    let value = T::read(column.get(index)?);
    Some(ScalarPrefixItem {
        value,
        total: T::from_total(column.get_acc(index + 1).as_u64()),
    })
}
pub(crate) fn scalar_prefix_delta<T: ScalarPrefix>(
    column: &ColumnData<T::Cursor>,
    from: usize,
    to: usize,
) -> Option<ScalarPrefixSeek<T>> {
    let mut iter = ScalarPrefixIter::<T>::new(column, from..column.len());
    iter.delta_nth(to - from)
}
pub(crate) fn bool_index_for_total(
    column: &ColumnData<hexane::BooleanCursor>,
    target: usize,
) -> usize {
    if target == 0 {
        return 0;
    }
    let mut iter = ScalarPrefixIter::<bool>::new(column, 0..column.len());
    iter.advance_prefix(target - 1)
        .map(|seek| seek.pos)
        .unwrap_or(column.len())
}

#[cfg(test)]
mod root_port_weight_tests {
    use super::*;
    use crate::op_set2::op_set::CtrWalker;

    fn reset_visits() {
        COUNTER_SLAB_VISITS.with(|count| count.set(0));
    }
    fn visits() -> usize {
        COUNTER_SLAB_VISITS.with(|count| count.get())
    }

    #[test]
    fn root_port_counter_signed_null_zero_max_and_sparse_visits() {
        let mut values: Vec<_> = (0..8192i64)
            .map(|index| Some((index * 104729) % 1000003 + 17))
            .collect();
        values[4] = Some(-9);
        values[5] = None;
        values[17] = Some(0);
        values[4096] = Some(1);
        values[6001] = Some(i64::from(u32::MAX));
        let column: ColumnData<CounterCursor> = values.clone().into_iter().collect();
        let slab_count = column.slabs.len();
        assert!(slab_count > 16);
        reset_visits();
        let maximum: Vec<_> = find_counter_value(&column, u64::from(u32::MAX)).collect();
        assert_eq!(maximum, [6001]);
        let equality_visits = visits();
        assert!(
            visits() < slab_count / 2,
            "equality visited {} of {slab_count} slabs",
            visits()
        );
        reset_visits();
        let small: Vec<_> = CtrWalker::new(&column, 0..4).collect();
        assert_eq!(small, [17, 4096]);
        eprintln!(
            "counter tree: slabs={slab_count}, equality_visits={equality_visits}, range_visits={}",
            visits()
        );
        assert!(
            visits() < slab_count / 2,
            "range visited {} of {slab_count} slabs",
            visits()
        );
        assert!(find_counter_value(&column, u64::MAX).next().is_none());
        let sorted: ColumnData<CounterCursor> = [
            None,
            None,
            Some(-3),
            Some(0),
            Some(0),
            Some(i64::from(u32::MAX)),
        ]
        .into_iter()
        .collect();
        assert_eq!(sorted.scope_to_value(None::<i64>, ..), 0..2);
        assert_eq!(sorted.scope_to_value(Some(0i64), ..), 3..5);
        assert_eq!(sorted.scope_to_value(Some(i64::from(u32::MAX)), ..), 5..6);
        let increasing: ColumnData<CounterCursor> =
            (0..300i64).map(|index| Some(index * index + 19)).collect();
        assert!(
            increasing.slabs.len() > 1,
            "first-value witness must cross an actual slab"
        );
        let second = increasing.slabs.get_cursor(1).unwrap();
        assert_eq!(
            second
                .element
                .first_value::<CounterCursor>()
                .as_deref()
                .copied(),
            increasing
                .get(second.weight.pos())
                .flatten()
                .as_deref()
                .copied()
        );
        // A long linear delta sequence occupies one compressed run and slab.
        // Equality must use native run matching, without expanding the leaf's rows.
        let compressed: ColumnData<CounterCursor> = (0..100_000i64).collect();
        assert_eq!(compressed.slabs.len(), 1);
        assert_eq!(
            find_counter_value(&compressed, 99_999).collect::<Vec<_>>(),
            [99_999]
        );
        assert_eq!(find_counter_value(&compressed, 0).collect::<Vec<_>>(), [0]);
        assert!(find_counter_value(&compressed, u64::from(u32::MAX))
            .next()
            .is_none());
        let mut bytes = Vec::new();
        hexane::DeltaCursor::encode(&mut bytes, [Some(0i64), None, Some(i64::from(u32::MAX))]);
        let loaded = load_counter_column(&bytes, 3, true, false).unwrap();
        assert_eq!(loaded.to_vec(), [Some(0), None, Some(i64::from(u32::MAX))]);
        assert!(matches!(
            load_counter_column(&bytes, 3, false, false),
            Err(PackError::InvalidValue(_))
        ));
        bytes.clear();
        hexane::DeltaCursor::encode(&mut bytes, [i64::from(u32::MAX) + 1]);
        assert!(matches!(
            load_counter_column(&bytes, 1, false, false),
            Err(PackError::InvalidValue(_))
        ));
        bytes.clear();
        hexane::DeltaCursor::encode(&mut bytes, [-1i64]);
        assert!(matches!(
            load_counter_column(&bytes, 1, false, false),
            Err(PackError::InvalidValue(_))
        ));
    }
}
