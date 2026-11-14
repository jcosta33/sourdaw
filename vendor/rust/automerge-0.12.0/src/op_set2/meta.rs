use super::types::ScalarValue;
use hexane::{lebsize, ulebsize, PackError};

#[derive(Debug)]
pub(crate) enum ValueType {
    Null,
    False,
    True,
    Uleb,
    Leb,
    Float,
    String,
    Bytes,
    Counter,
    Timestamp,
    Unknown(u8),
}

#[derive(Copy, Clone, Debug, Default, PartialEq, PartialOrd)]
pub(crate) struct ValueMeta(u64);

impl ValueMeta {
    pub(crate) fn type_code(&self) -> ValueType {
        let low_byte = (self.0 as u8) & 0b00001111;
        match low_byte {
            0 => ValueType::Null,
            1 => ValueType::False,
            2 => ValueType::True,
            3 => ValueType::Uleb,
            4 => ValueType::Leb,
            5 => ValueType::Float,
            6 => ValueType::String,
            7 => ValueType::Bytes,
            8 => ValueType::Counter,
            9 => ValueType::Timestamp,
            other => ValueType::Unknown(other),
        }
    }

    pub(crate) fn length(&self) -> usize {
        self.try_length()
            .expect("validated raw value length fits address space")
    }

    pub(crate) fn try_length(&self) -> Result<usize, PackError> {
        usize::try_from(self.0 >> 4).map_err(|_| PackError::BadFormat)
    }
}

impl From<u64> for ValueMeta {
    fn from(raw: u64) -> Self {
        ValueMeta(raw)
    }
}

impl From<&crate::ScalarValue> for ValueMeta {
    fn from(p: &crate::ScalarValue) -> Self {
        match p {
            crate::ScalarValue::Uint(i) => Self((ulebsize(*i) << 4) | 3),
            crate::ScalarValue::Int(i) => Self((lebsize(*i) << 4) | 4),
            crate::ScalarValue::Null => Self(0),
            crate::ScalarValue::Boolean(b) => Self(match b {
                false => 1,
                true => 2,
            }),
            crate::ScalarValue::Timestamp(i) => Self((lebsize(*i) << 4) | 9),
            crate::ScalarValue::F64(_) => Self((8 << 4) | 5),
            crate::ScalarValue::Counter(i) => Self((lebsize(i.start) << 4) | 8),
            crate::ScalarValue::Str(s) => Self(((s.len() as u64) << 4) | 6),
            crate::ScalarValue::Bytes(b) => Self(((b.len() as u64) << 4) | 7),
            crate::ScalarValue::Unknown { type_code, bytes } => {
                Self(((bytes.len() as u64) << 4) | (*type_code as u64))
            }
        }
    }
}

impl<'a> From<&'a ScalarValue<'a>> for ValueMeta {
    fn from(p: &'a ScalarValue<'a>) -> Self {
        match p {
            ScalarValue::Uint(i) => Self((ulebsize(*i) << 4) | 3),
            ScalarValue::Int(i) => Self((lebsize(*i) << 4) | 4),
            ScalarValue::Null => Self(0),
            ScalarValue::Boolean(b) => Self(match b {
                false => 1,
                true => 2,
            }),
            ScalarValue::Timestamp(i) => Self((lebsize(*i) << 4) | 9),
            ScalarValue::F64(_) => Self((8 << 4) | 5),
            ScalarValue::Counter(i) => Self((lebsize(*i) << 4) | 8),
            ScalarValue::Str(s) => Self(((s.len() as u64) << 4) | 6),
            ScalarValue::Bytes(b) => Self(((b.len() as u64) << 4) | 7),
            ScalarValue::Unknown { type_code, bytes } => {
                Self(((bytes.len() as u64) << 4) | (*type_code as u64))
            }
        }
    }
}

impl From<&[u8]> for ValueMeta {
    fn from(b: &[u8]) -> Self {
        Self(((b.len() as u64) << 4) | 7)
    }
}

impl hexane::Packable for ValueMeta {
    fn width(item: &Self) -> usize {
        hexane::ulebsize(item.0) as usize
    }

    fn pack(item: &Self, out: &mut Vec<u8>) {
        leb128::write::unsigned(out, item.0).expect("writing to Vec cannot fail");
    }

    fn unpack(mut bytes: &[u8]) -> Result<(usize, std::borrow::Cow<'_, Self>), PackError> {
        let before = bytes.len();
        let value = leb128::read::unsigned(&mut bytes)?;
        Ok((before - bytes.len(), std::borrow::Cow::Owned(Self(value))))
    }
}

/// Byte lengths are wider than Hexane's scalar Agg. Keep them in the actual
/// stable B-tree weight while the encoded cursor's scalar accumulator stays zero.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ValueWeight {
    base: hexane::SlabWeight,
    bytes: u64,
}

pub(crate) type MetaCursor = hexane::RleCursor<1024, ValueMeta, ValueWeight>;

impl hexane::HasPos for ValueWeight {
    fn pos(&self) -> usize {
        hexane::HasPos::pos(&self.base)
    }
}
impl hexane::HasAcc for ValueWeight {
    fn acc(&self) -> hexane::Acc {
        hexane::HasAcc::acc(&self.base)
    }
}
impl hexane::SpanWeight<hexane::Slab> for ValueWeight {
    fn alloc(slab: &hexane::Slab) -> Self {
        let mut bytes = 0u64;
        for run in slab.run_iter::<hexane::RleCursor<1024, ValueMeta>>() {
            if let Some(value) = run.value {
                let count = u64::try_from(run.count).expect("slab row count fits u64");
                bytes = bytes
                    .checked_add(
                        (value.0 >> 4)
                            .checked_mul(count)
                            .expect("validated metadata byte length"),
                    )
                    .expect("validated metadata total byte length");
            }
        }
        Self {
            base: hexane::SpanWeight::alloc(slab),
            bytes,
        }
    }
    fn and(mut self, other: &Self) -> Self {
        hexane::SpanWeight::union(&mut self, other);
        self
    }
    fn union(&mut self, other: &Self) {
        hexane::SpanWeight::union(&mut self.base, &other.base);
        self.bytes = self
            .bytes
            .checked_add(other.bytes)
            .expect("validated metadata total byte length");
    }
    fn maybe_sub(&mut self, _other: &Self) -> bool {
        // Let the stable tree recompute after removal, keeping all weight fields coherent.
        false
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ByteMetaColumn {
    data: hexane::ColumnData<MetaCursor>,
}

#[derive(Clone, Debug)]
pub(crate) struct ByteMetaItem {
    pub(crate) value: ValueMeta,
    prefix: u64,
}
impl ByteMetaItem {
    pub(crate) fn prefix(&self) -> u64 {
        self.prefix
    }
    pub(crate) fn total(&self) -> u64 {
        self.prefix
            .checked_add(self.value.0 >> 4)
            .expect("validated metadata total byte length")
    }
}

impl ByteMetaColumn {
    pub(crate) fn new() -> Self {
        Self::default()
    }
    pub(crate) fn len(&self) -> usize {
        self.data.len()
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.data.len() == 0
    }
    pub(crate) fn save(&self) -> Vec<u8> {
        self.data.save()
    }
    pub(crate) fn save_to(&self, out: &mut Vec<u8>) -> std::ops::Range<usize> {
        self.data.save_to(out)
    }
    pub(crate) fn load(bytes: &[u8]) -> Result<Self, PackError> {
        use hexane::ColumnCursor;
        let mut cursor = hexane::RleCursor::<1024, ValueMeta>::default();
        let mut total = 0u64;
        while let Some(run) = cursor.try_next(bytes)? {
            let value = run
                .value
                .ok_or_else(|| PackError::InvalidValue("null value metadata".into()))?;
            let count = u64::try_from(run.count).map_err(|_| PackError::BadFormat)?;
            let length = (value.0 >> 4)
                .checked_mul(count)
                .ok_or(PackError::BadFormat)?;
            total = total.checked_add(length).ok_or(PackError::BadFormat)?;
        }
        let data = hexane::ColumnData::load_with(bytes, &|value| {
            value.is_none().then(|| "null value metadata".into())
        })?;
        Ok(Self { data })
    }
    pub(crate) fn load_with_length(bytes: &[u8], len: usize) -> Result<Self, PackError> {
        let result = Self::load(bytes)?;
        if result.len() != len {
            return Err(PackError::InvalidLength(result.len(), len));
        }
        Ok(result)
    }
    pub(crate) fn get_prefix(&self, index: usize) -> u64 {
        use hexane::HasPos;
        let index = index.min(self.len());
        if index == 0 {
            return 0;
        }
        let cursor = self
            .data
            .slabs
            .get_where_or_last(|prior, next| index < prior.pos() + next.pos());
        let mut prefix = cursor.weight.bytes;
        let mut left = index - cursor.weight.pos();
        for run in cursor
            .element
            .run_iter::<hexane::RleCursor<1024, ValueMeta>>()
        {
            let count = left.min(run.count);
            if let Some(value) = run.value {
                prefix = prefix
                    .checked_add(
                        (value.0 >> 4)
                            .checked_mul(u64::try_from(count).expect("row count fits u64"))
                            .expect("validated metadata byte length"),
                    )
                    .expect("validated metadata total byte length");
            }
            left -= count;
            if left == 0 {
                break;
            }
        }
        prefix
    }
    pub(crate) fn get(&self, index: usize) -> Option<ByteMetaItem> {
        let value = self.data.get(index)??;
        Some(ByteMetaItem {
            value: *value,
            prefix: self.get_prefix(index),
        })
    }
    pub(crate) fn to_vec(&self) -> Vec<ValueMeta> {
        self.iter().map(|item| item.value).collect()
    }
    pub(crate) fn iter(&self) -> ByteMetaIter<'_> {
        self.iter_range(0..self.len())
    }
    pub(crate) fn iter_range(&self, range: std::ops::Range<usize>) -> ByteMetaIter<'_> {
        ByteMetaIter {
            column: Some(self),
            prefix: self.get_prefix(range.start),
            iter: self.data.iter_range(range),
        }
    }
    pub(crate) fn extend<I: IntoIterator<Item = ValueMeta>>(&mut self, values: I) {
        self.data.extend(values);
    }
    pub(crate) fn splice<I: IntoIterator<Item = ValueMeta>>(
        &mut self,
        index: usize,
        del: usize,
        values: I,
    ) {
        self.data.splice(index, del, values);
    }
    pub(crate) fn from_values<I: IntoIterator<Item = ValueMeta>>(values: I) -> Self {
        let mut result = Self::new();
        result.extend(values);
        result
    }
}
impl FromIterator<ValueMeta> for ByteMetaColumn {
    fn from_iter<I: IntoIterator<Item = ValueMeta>>(values: I) -> Self {
        Self::from_values(values)
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ByteMetaIter<'a> {
    column: Option<&'a ByteMetaColumn>,
    prefix: u64,
    iter: hexane::ColumnDataIter<'a, MetaCursor>,
}
impl ByteMetaIter<'_> {
    pub(crate) fn pos(&self) -> usize {
        self.iter.pos()
    }
    pub(crate) fn end_pos(&self) -> usize {
        self.iter.end_pos()
    }
    pub(crate) fn set_max(&mut self, max: usize) {
        self.iter.set_max(max);
    }
    pub(crate) fn advance_to(&mut self, index: usize) {
        self.iter.advance_to(index);
        self.prefix = self
            .column
            .map(|column| column.get_prefix(self.iter.pos()))
            .unwrap_or(0);
    }
    pub(crate) fn shift_next(&mut self, range: std::ops::Range<usize>) -> Option<ByteMetaItem> {
        let prefix = self.column?.get_prefix(range.start);
        let value = self.iter.shift_next(range)??;
        let item = ByteMetaItem {
            value: *value,
            prefix,
        };
        self.prefix = item.total();
        Some(item)
    }
    pub(crate) fn suspend(&self) -> ByteMetaIterState {
        ByteMetaIterState(self.iter.suspend())
    }
}
impl Iterator for ByteMetaIter<'_> {
    type Item = ByteMetaItem;
    fn next(&mut self) -> Option<Self::Item> {
        let value = self.iter.next()??;
        let item = ByteMetaItem {
            value: *value,
            prefix: self.prefix,
        };
        self.prefix = item.total();
        Some(item)
    }
    fn nth(&mut self, count: usize) -> Option<Self::Item> {
        let column = self.column?;
        let value = self.iter.nth(count)??;
        let index = self.iter.pos().checked_sub(1)?;
        let item = ByteMetaItem {
            value: *value,
            prefix: column.get_prefix(index),
        };
        self.prefix = item.total();
        Some(item)
    }
}
pub(crate) struct ByteMetaIterState(hexane::ColumnDataIterState<MetaCursor>);
impl ByteMetaIterState {
    pub(crate) fn try_resume<'a>(
        &self,
        column: &'a ByteMetaColumn,
    ) -> Result<ByteMetaIter<'a>, PackError> {
        let iter = self.0.try_resume(&column.data)?;
        Ok(ByteMetaIter {
            prefix: column.get_prefix(iter.pos()),
            column: Some(column),
            iter,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::ByteMetaColumn;
    use super::*;

    #[test]
    fn column_data_meta_group() {
        // ValueMeta packs (length << 4) | type_code; lengths sum to a running
        // byte offset into the value blob.  Types 0–3 (Null/False/True/Uleb)
        // have length 0; types 6+ encode an explicit length in the upper bits.
        let data = vec![
            ValueMeta(1),             // length 0
            ValueMeta(6 + (30 << 4)), // length 30
            ValueMeta(6 + (10 << 4)), // length 10
            ValueMeta(3),             // length 0
            ValueMeta(4),             // length 0
        ];
        let col = ByteMetaColumn::from_values(data);

        // PrefixIter yields PrefixedValues; total() is the running sum of
        // length() up to and including the current item.
        let mut iter = col.iter();

        let pv = iter.next().unwrap();
        assert_eq!(pv.value, ValueMeta(1));
        assert_eq!(pv.total(), 0);

        let pv = iter.next().unwrap();
        assert_eq!(pv.value, ValueMeta(6 + (30 << 4)));
        assert_eq!(pv.total(), 30);

        let pv = iter.next().unwrap();
        assert_eq!(pv.value, ValueMeta(6 + (10 << 4)));
        assert_eq!(pv.total(), 40);

        let pv = iter.next().unwrap();
        assert_eq!(pv.value, ValueMeta(3));
        assert_eq!(pv.total(), 40);

        // nth(3) jumps to index 3 (the fourth item)
        let pv = col.iter().nth(3).unwrap();
        assert_eq!(pv.value, ValueMeta(3));
        assert_eq!(pv.total(), 40);

        // iter_range(3..5) starts at index 3 with the cumulative prefix carried
        let mut iter = col.iter_range(3..5);
        let pv = iter.next().unwrap();
        assert_eq!(pv.value, ValueMeta(3));
        assert_eq!(pv.total(), 40);
    }
}

#[cfg(test)]
mod root_port_weight_tests {
    use super::*;
    use hexane::ColumnCursor;

    fn assert_prefixes(column: &ByteMetaColumn, values: &[ValueMeta]) {
        let mut expected = 0u64;
        for (index, value) in values.iter().enumerate() {
            assert_eq!(
                column.get_prefix(index),
                expected,
                "exclusive prefix {index}"
            );
            let item = column.get(index).unwrap();
            assert_eq!(item.value, *value);
            assert_eq!(item.prefix(), expected);
            expected = expected.checked_add(value.0 >> 4).unwrap();
            assert_eq!(item.total(), expected);
        }
        assert_eq!(column.get_prefix(values.len()), expected);
        let items: Vec<_> = column.iter().map(|item| item.value).collect();
        assert_eq!(items, values);
        for index in [0, 1, 1023, 4095, values.len() - 1] {
            assert_eq!(column.iter().nth(index).unwrap().value, values[index]);
            assert_eq!(
                column
                    .iter_range(index..values.len())
                    .next()
                    .unwrap()
                    .prefix(),
                column.get_prefix(index)
            );
        }
    }

    #[test]
    fn root_port_value_meta_wide_split_delete_reweight_and_rejection() {
        let mut values: Vec<_> = (0..4608u64)
            .map(|index| {
                let length = match index {
                    0 => 0,
                    1 => 1,
                    1023 => 4096,
                    _ => (1u64 << 51) + index,
                };
                ValueMeta((length << 4) | 7)
            })
            .collect();
        let mut column = ByteMetaColumn::from_values(values.clone());
        eprintln!(
            "value tree: rows={}, slabs={}, total_bytes={}",
            column.len(),
            column.data.slabs.len(),
            column.get_prefix(column.len())
        );
        assert!(
            column.data.slabs.len() > 2 * 16 - 1,
            "exceeds stable SpanTree leaf capacity (2 * B - 1, B = 16)"
        );
        assert_prefixes(&column, &values);
        let loaded = ByteMetaColumn::load_with_length(&column.save(), values.len()).unwrap();
        assert_prefixes(&loaded, &values);
        let state = column.iter_range(1023..2049).suspend();
        let replacement = [
            ValueMeta(((u64::from(u32::MAX) + 17) << 4) | 7),
            ValueMeta(7),
        ];
        column.splice(1023, 3, replacement);
        values.splice(1023..1026, replacement);
        assert!(matches!(
            state.try_resume(&column),
            Err(PackError::InvalidResume)
        ));
        assert_prefixes(&column, &values);
        column.splice(4094, 257, std::iter::empty());
        values.drain(4094..4351);
        assert_prefixes(&column, &values);
        let mut overflow = Vec::new();
        MetaCursor::encode(&mut overflow, [ValueMeta(u64::MAX); 17]);
        assert!(matches!(
            ByteMetaColumn::load(&overflow),
            Err(PackError::BadFormat)
        ));
        let mut null = Vec::new();
        MetaCursor::encode(&mut null, [None::<ValueMeta>]);
        assert!(matches!(
            ByteMetaColumn::load(&null),
            Err(PackError::InvalidValue(_))
        ));
    }
}
