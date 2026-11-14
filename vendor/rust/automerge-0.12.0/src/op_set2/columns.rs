use super::columnar::{load_counter_column, require_value, CountCursor, CounterCursor};
use super::meta::{ByteMetaColumn, ValueMeta};
use super::op::OpLike;
use super::op_set::MarkIndexColumn;
use super::types::{Action, ActionCursor, ActorCursor, ActorIdx, ScalarValue};
use crate::storage::columns::compression::Uncompressed;
use crate::storage::columns::{BadColumnLayout, Columns as ColumnFormat};
use crate::storage::ColumnSpec;
use crate::storage::{RawColumn, RawColumns};
use crate::types::{ActorId, SequenceType, TextEncoding};
use hexane::{BooleanCursor, ColumnData, IntCursor, PackError, RawCursor, StrCursor};
use std::borrow::Cow;

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::ops::Range;

#[derive(Debug, Clone)]
pub(super) struct Columns {
    pub(super) id_actor: ColumnData<ActorCursor>,
    pub(super) id_ctr: ColumnData<CounterCursor>,
    pub(super) obj_actor: ColumnData<ActorCursor>,
    pub(super) obj_ctr: ColumnData<CountCursor>,
    pub(super) key_actor: ColumnData<ActorCursor>,
    pub(super) key_ctr: ColumnData<CounterCursor>,
    pub(super) key_str: ColumnData<StrCursor>,
    pub(super) succ_count: ColumnData<CountCursor>,
    pub(super) succ_actor: ColumnData<ActorCursor>,
    pub(super) succ_ctr: ColumnData<CounterCursor>,
    pub(super) insert: ColumnData<BooleanCursor>,
    pub(super) action: ColumnData<ActionCursor>,
    pub(super) value_meta: ByteMetaColumn,
    pub(super) value: ColumnData<RawCursor>,
    pub(super) mark_name: ColumnData<StrCursor>,
    pub(super) expand: ColumnData<BooleanCursor>,
    pub(super) index: Indexes,
}

#[derive(Debug, Clone)]
pub(super) struct Indexes {
    pub(super) text: ColumnData<CountCursor>,
    pub(super) top: ColumnData<BooleanCursor>,
    pub(super) visible: ColumnData<BooleanCursor>,
    pub(super) inc: ColumnData<IntCursor>,
    pub(super) mark: MarkIndexColumn,
}

impl Default for Indexes {
    fn default() -> Self {
        Self {
            text: ColumnData::new(),
            top: ColumnData::new(),
            visible: ColumnData::new(),
            inc: ColumnData::new(),
            mark: MarkIndexColumn::new(),
        }
    }
}

impl Default for Columns {
    fn default() -> Self {
        Self {
            id_actor: ColumnData::new(),
            id_ctr: ColumnData::new(),
            obj_actor: ColumnData::new(),
            obj_ctr: ColumnData::new(),
            key_actor: ColumnData::new(),
            key_ctr: ColumnData::new(),
            key_str: ColumnData::new(),
            succ_count: ColumnData::new(),
            succ_actor: ColumnData::new(),
            succ_ctr: ColumnData::new(),
            insert: ColumnData::new(),
            action: ColumnData::new(),
            value_meta: ByteMetaColumn::new(),
            value: ColumnData::<RawCursor>::new(),
            mark_name: ColumnData::new(),
            expand: ColumnData::new(),
            index: Indexes::default(),
        }
    }
}

#[cfg(test)]
fn debug_cmp<I: Debug + PartialEq>(tag: &str, a: Vec<I>, b: Vec<I>) -> bool {
    if a == b {
        true
    } else {
        let pos = a.iter().zip(b.iter()).position(|(a, b)| a != b);
        log!("{} diff at {:?}", tag, pos);
        log!(" :: {:?}", b);
        log!(" :: {:?}", a);
        false
    }
}

impl Columns {
    #[cfg(test)]
    pub(super) fn debug_cmp(&self, other: &Self) {
        let mut ok = true;
        ok &= debug_cmp("ID_ACTOR", self.id_actor.to_vec(), other.id_actor.to_vec());
        ok &= debug_cmp("ID_CTR", self.id_ctr.to_vec(), other.id_ctr.to_vec());
        ok &= debug_cmp(
            "OBJ_ACTOR",
            self.obj_actor.to_vec(),
            other.obj_actor.to_vec(),
        );
        ok &= debug_cmp("OBJ_CTR", self.obj_ctr.to_vec(), other.obj_ctr.to_vec());
        assert!(ok);
        log!("KEY_ACTOR");
        assert_eq!(self.key_actor.to_vec(), other.key_actor.to_vec());
        log!("KEY_STR");
        assert_eq!(self.key_str.to_vec(), other.key_str.to_vec());
        log!("INSERT");
        assert_eq!(self.insert.to_vec(), other.insert.to_vec());
        log!("ACTION");
        assert_eq!(self.action.to_vec(), other.action.to_vec());
        log!("MARK_NAME");
        assert_eq!(self.mark_name.to_vec(), other.mark_name.to_vec());
        log!("EXPAND");
        assert_eq!(
            self.expand.iter().collect::<Vec<_>>(),
            other.expand.iter().collect::<Vec<_>>()
        );
        log!("SUCC_COUNT");
        assert_eq!(self.succ_count.to_vec(), other.succ_count.to_vec());
        log!("SUCC_ACTOR");
        assert_eq!(self.succ_actor.to_vec(), other.succ_actor.to_vec());
        log!("SUCC_CTR");
        assert_eq!(self.succ_ctr.to_vec(), other.succ_ctr.to_vec());
        log!("META");
        assert_eq!(self.value_meta.to_vec(), other.value_meta.to_vec());
        log!("VALUE");
        assert_eq!(self.value.save(), other.value.save());
    }

    fn export_column(
        &self,
        spec: &ColumnSpec,
        data: &mut Vec<u8>,
    ) -> Option<RawColumn<Uncompressed>> {
        match *spec {
            ID_ACTOR_COL_SPEC => RawColumn::try_new(*spec, self.id_actor.save_to(data)),
            ID_COUNTER_COL_SPEC => RawColumn::try_new(*spec, self.id_ctr.save_to(data)),
            OBJ_ID_ACTOR_COL_SPEC => {
                RawColumn::try_new(*spec, self.obj_actor.save_to_unless_empty(data))
            }
            OBJ_ID_COUNTER_COL_SPEC => {
                RawColumn::try_new(*spec, self.obj_ctr.save_to_unless_empty(data))
            }
            KEY_ACTOR_COL_SPEC => {
                RawColumn::try_new(*spec, self.key_actor.save_to_unless_empty(data))
            }
            KEY_COUNTER_COL_SPEC => {
                RawColumn::try_new(*spec, self.key_ctr.save_to_unless_empty(data))
            }
            KEY_STR_COL_SPEC => RawColumn::try_new(*spec, self.key_str.save_to_unless_empty(data)),
            // insert is a special case - it will save even if empty for backward compatibility
            INSERT_COL_SPEC => RawColumn::try_new(*spec, self.insert.save_to(data)),
            ACTION_COL_SPEC => RawColumn::try_new(*spec, self.action.save_to(data)),
            MARK_NAME_COL_SPEC => {
                RawColumn::try_new(*spec, self.mark_name.save_to_unless_empty(data))
            }
            EXPAND_COL_SPEC => RawColumn::try_new(*spec, self.expand.save_to_unless_empty(data)),
            SUCC_COUNT_COL_SPEC => RawColumn::try_new(*spec, self.succ_count.save_to(data)),
            SUCC_ACTOR_COL_SPEC => RawColumn::try_new(*spec, self.succ_actor.save_to(data)),
            SUCC_COUNTER_COL_SPEC => RawColumn::try_new(*spec, self.succ_ctr.save_to(data)),
            VALUE_META_COL_SPEC => RawColumn::try_new(*spec, self.value_meta.save_to(data)),
            VALUE_COL_SPEC => RawColumn::try_new(*spec, self.value.save_to(data)),
            _ => None,
        }
    }

    pub(crate) fn export(&self) -> (RawColumns<Uncompressed>, Vec<u8>) {
        let mut data = vec![];

        let mut cols = ALL_COLUMN_SPECS;
        cols.sort();

        let raw: RawColumns<Uncompressed> = cols
            .iter()
            .filter_map(|spec| self.export_column(spec, &mut data))
            .collect();

        (raw, data)
    }

    #[cfg(test)]
    pub(crate) fn save_checkpoint(&self) -> std::collections::HashMap<&'static str, Vec<u8>> {
        [
            // op
            ("id_actor", self.id_actor.save()),
            ("id_ctr", self.id_ctr.save()),
            ("obj_actor", self.obj_actor.save()),
            ("obj_ctr", self.obj_ctr.save()),
            ("key_actor", self.key_actor.save()),
            ("key_ctr", self.key_ctr.save()),
            ("key_str", self.key_str.save()),
            ("insert", self.insert.save()),
            ("action", self.action.save()),
            ("value_meta", self.value_meta.save()),
            ("value", self.value.save()),
            ("mark_name", self.mark_name.save()),
            ("expand", self.expand.save()),
            // succ
            ("succ_count", self.succ_count.save()),
            ("succ_actor", self.succ_actor.save()),
            ("succ_ctr", self.succ_ctr.save()),
            // indexes
            ("visible", self.index.visible.save()),
            ("inc", self.index.inc.save()),
            ("mark", self.index.mark.save()),
            ("text", self.index.text.save()),
            ("top", self.index.top.save()),
            ("visible", self.index.visible.save()),
        ]
        .into_iter()
        .collect()
    }

    pub(crate) fn validate(
        bytes: usize,
        cols: &RawColumns<Uncompressed>,
    ) -> Result<RawColumns<Uncompressed>, BadColumnLayout> {
        use ids::*;
        let _ = ColumnFormat::parse2(bytes, cols.iter())?;
        Ok(cols
            .iter()
            .filter(|col| {
                matches!(
                    col.spec(),
                    ID_ACTOR_COL_SPEC
                        | ID_COUNTER_COL_SPEC
                        | OBJ_ID_ACTOR_COL_SPEC
                        | OBJ_ID_COUNTER_COL_SPEC
                        | KEY_ACTOR_COL_SPEC
                        | KEY_COUNTER_COL_SPEC
                        | KEY_STR_COL_SPEC
                        | SUCC_COUNT_COL_SPEC
                        | SUCC_ACTOR_COL_SPEC
                        | SUCC_COUNTER_COL_SPEC
                        | INSERT_COL_SPEC
                        | ACTION_COL_SPEC
                        | VALUE_META_COL_SPEC
                        | VALUE_COL_SPEC
                        | MARK_NAME_COL_SPEC
                        | EXPAND_COL_SPEC
                )
            })
            .cloned()
            .collect())
    }

    pub(crate) fn load(
        cols: BTreeMap<ColumnSpec, Range<usize>>,
        data: &[u8],
        _actors: &[ActorId],
    ) -> Result<Self, PackError> {
        let data_for = |spec| {
            data.get(cols.get(&spec).cloned().unwrap_or_default())
                .ok_or(PackError::BadFormat)
        };
        let actor = |value: Option<&ActorIdx>| {
            value
                .filter(|value| usize::from(**value) >= _actors.len())
                .map(|_| "actor index outside document actor table".to_owned())
        };
        let required_actor =
            |value: Option<&ActorIdx>| require_value(value).or_else(|| actor(value));
        let id_actor =
            ColumnData::<ActorCursor>::load_with(data_for(ID_ACTOR_COL_SPEC)?, &required_actor)?;
        let len = id_actor.len();
        let id_ctr = load_counter_column(data_for(ID_COUNTER_COL_SPEC)?, len, false, false)?;
        let obj_actor = ColumnData::<ActorCursor>::load_with_unless_empty(
            data_for(OBJ_ID_ACTOR_COL_SPEC)?,
            len,
            &actor,
        )?;
        let obj_ctr =
            ColumnData::<CountCursor>::load_unless_empty(data_for(OBJ_ID_COUNTER_COL_SPEC)?, len)?;
        let key_actor = ColumnData::<ActorCursor>::load_with_unless_empty(
            data_for(KEY_ACTOR_COL_SPEC)?,
            len,
            &actor,
        )?;
        let key_ctr = load_counter_column(data_for(KEY_COUNTER_COL_SPEC)?, len, true, true)?;
        let key_str = ColumnData::<StrCursor>::load_unless_empty(data_for(KEY_STR_COL_SPEC)?, len)?;
        let insert =
            ColumnData::<BooleanCursor>::load_unless_empty(data_for(INSERT_COL_SPEC)?, len)?;
        let action =
            ColumnData::<ActionCursor>::load_with(data_for(ACTION_COL_SPEC)?, &require_value)?;
        if action.len() != len {
            return Err(PackError::InvalidLength(action.len(), len));
        }
        let mark_name =
            ColumnData::<StrCursor>::load_unless_empty(data_for(MARK_NAME_COL_SPEC)?, len)?;
        let expand =
            ColumnData::<BooleanCursor>::load_unless_empty(data_for(EXPAND_COL_SPEC)?, len)?;
        let succ_count =
            ColumnData::<CountCursor>::load_with(data_for(SUCC_COUNT_COL_SPEC)?, &require_value)?;
        if succ_count.len() != len {
            return Err(PackError::InvalidLength(succ_count.len(), len));
        }
        let succ_len =
            usize::try_from(succ_count.acc().as_u64()).map_err(|_| PackError::BadFormat)?;
        let succ_actor =
            ColumnData::<ActorCursor>::load_with(data_for(SUCC_ACTOR_COL_SPEC)?, &required_actor)?;
        if succ_actor.len() != succ_len {
            return Err(PackError::InvalidLength(succ_actor.len(), succ_len));
        }
        let succ_ctr =
            load_counter_column(data_for(SUCC_COUNTER_COL_SPEC)?, succ_len, false, false)?;
        let value_meta = ByteMetaColumn::load_with_length(data_for(VALUE_META_COL_SPEC)?, len)?;
        let value = ColumnData::<RawCursor>::load(data_for(VALUE_COL_SPEC)?)?;
        let value_len =
            usize::try_from(value_meta.get_prefix(len)).map_err(|_| PackError::BadFormat)?;
        if value.len() != value_len {
            return Err(PackError::InvalidLength(value.len(), value_len));
        }

        let index = Indexes::default();

        Ok(Self {
            id_actor,
            id_ctr,
            obj_actor,
            obj_ctr,
            key_actor,
            key_ctr,
            key_str,
            succ_count,
            succ_actor,
            succ_ctr,
            insert,
            action,
            value_meta,
            value,
            mark_name,
            expand,
            index,
        })
    }

    fn remap_actors<F>(&mut self, f: &F)
    where
        F: Fn(ActorIdx) -> ActorIdx,
    {
        self.id_actor
            .remap(|value| value.map(|value| Cow::Owned(f(*value))));
        self.succ_actor
            .remap(|value| value.map(|value| Cow::Owned(f(*value))));
        self.obj_actor
            .remap(|value| value.map(|value| Cow::Owned(f(*value))));
        self.key_actor
            .remap(|value| value.map(|value| Cow::Owned(f(*value))));
    }

    pub(crate) fn rewrite_with_new_actor(&mut self, idx: usize) {
        let idx = idx as u32;
        self.remap_actors(&move |a| match a {
            ActorIdx(actor) if actor >= idx => ActorIdx(actor + 1),
            _ => a,
        });
    }

    pub(crate) fn rewrite_without_actor(&mut self, idx: usize) {
        let idx = idx as u32;
        self.remap_actors(&move |a| match a {
            ActorIdx(id) if id > idx => ActorIdx(id - 1),
            ActorIdx(id) if id == idx => {
                panic!("cant rewrite - actor is present")
            }
            _ => a,
        });
    }

    pub(crate) fn remove_ops<O>(&mut self, pos: usize, ops: &[O]) -> usize
    where
        O: OpLike,
    {
        let ops = ops.iter().filter(|o| O::action(o) != Action::Delete);
        let del = ops.clone().count();

        let value_pos = usize::try_from(self.value_meta.get_prefix(pos))
            .expect("validated raw value prefix fits address space");
        let succ_pos = self.succ_count.get_acc(pos).as_usize();

        self.id_actor
            .splice(pos, del, std::iter::empty::<ActorIdx>());
        self.id_ctr.splice(pos, del, std::iter::empty::<i64>());
        self.obj_actor
            .splice(pos, del, std::iter::empty::<Option<ActorIdx>>());
        self.obj_ctr
            .splice(pos, del, std::iter::empty::<Option<u32>>());
        self.key_actor
            .splice(pos, del, std::iter::empty::<Option<ActorIdx>>());
        self.key_ctr
            .splice(pos, del, std::iter::empty::<Option<i64>>());
        self.key_str.splice(pos, del, [] as [Option<&str>; 0]);
        self.insert.splice(pos, del, std::iter::empty::<bool>());
        self.action.splice(pos, del, std::iter::empty::<Action>());
        self.expand.splice(pos, del, std::iter::empty::<bool>());
        self.mark_name.splice(pos, del, [] as [Option<&str>; 0]);

        self.value_meta
            .splice(pos, del, std::iter::empty::<ValueMeta>());

        let raw_len = ops
            .clone()
            .filter_map(|o| o.raw_value().map(|r| r.len()))
            .sum();
        self.value
            .splice(value_pos, raw_len, std::iter::empty::<&[u8]>());

        self.succ_count.splice(pos, del, std::iter::empty::<u32>());
        let succ_del = ops.clone().flat_map(|o| o.succ()).count();

        if succ_del > 0 {
            self.succ_actor
                .splice(succ_pos, succ_del, std::iter::empty::<ActorIdx>());
            self.succ_ctr
                .splice(succ_pos, succ_del, std::iter::empty::<i64>());
            self.index
                .inc
                .splice(succ_pos, succ_del, std::iter::empty::<Option<i64>>());
        }

        let marks = ops.clone().map(O::mark_index).collect();
        self.index.mark.undo(pos, marks);
        self.index.text.splice(pos, del, [] as [Option<u32>; 0]);
        self.index.top.splice(pos, del, [] as [bool; 0]);
        self.index.visible.splice(pos, del, [] as [bool; 0]);

        ops.count()
    }

    pub(crate) fn splice<O>(&mut self, pos: usize, ops: &[O], text_encoding: TextEncoding) -> usize
    where
        O: OpLike,
    {
        let ops = ops.iter().filter(|o| O::action(o) != Action::Delete);

        let value_pos = usize::try_from(self.value_meta.get_prefix(pos))
            .expect("validated raw value prefix fits address space");
        let succ_pos = self.succ_count.get_acc(pos).as_usize();

        self.id_actor.splice(pos, 0, ops.clone().map(O::id_actor));
        self.id_ctr
            .splice(pos, 0, ops.clone().map(|o| i64::from(O::id_ctr(o) as u32)));
        self.obj_actor.splice(pos, 0, ops.clone().map(O::obj_actor));
        self.obj_ctr
            .splice(pos, 0, ops.clone().map(|o| O::obj_ctr(o).map(|v| v as u32)));
        self.key_actor.splice(pos, 0, ops.clone().map(O::key_actor));
        self.key_ctr.splice(
            pos,
            0,
            ops.clone()
                .map(|o| O::key_ctr(o).map(|v| i64::from(v as u32))),
        );
        self.key_str.splice(pos, 0, ops.clone().map(O::key_str));
        self.insert.splice(pos, 0, ops.clone().map(O::insert));
        self.action.splice(pos, 0, ops.clone().map(O::action));
        self.expand.splice(pos, 0, ops.clone().map(O::expand));
        self.mark_name.splice(pos, 0, ops.clone().map(O::mark_name));

        self.value_meta
            .splice(pos, 0, ops.clone().map(|o| o.meta_value()));

        self.value
            .splice(value_pos, 0, ops.clone().filter_map(|o| o.raw_value()));

        self.succ_count
            .splice(pos, 0, ops.clone().map(|o| o.succ().len() as u32));

        let succ_actor = ops
            .clone()
            .flat_map(|o| o.succ().map(|id| id.actoridx()))
            .collect::<Vec<_>>();

        self.succ_actor
            .splice(succ_pos, 0, succ_actor.iter().copied());

        let succ_ctr = ops
            .clone()
            .flat_map(|o| o.succ().map(|id| id.icounter()))
            .collect::<Vec<_>>();

        self.succ_ctr
            .splice(succ_pos, 0, succ_ctr.iter().map(|&v| i64::from(v as u32)));

        self.index
            .inc
            .splice(succ_pos, 0, ops.clone().flat_map(O::succ_inc));

        self.index
            .mark
            .extend(pos, ops.clone().map(O::mark_index).collect());
        self.index.text.splice(
            pos,
            0,
            ops.clone().map(|s| {
                if O::top(s) {
                    Some(O::width(s, SequenceType::Text, text_encoding) as u32)
                } else {
                    None
                }
            }),
        );
        self.index.top.splice(pos, 0, ops.clone().map(O::top));
        self.index
            .visible
            .splice(pos, 0, ops.clone().map(O::visible));

        ops.count()
    }

    #[cfg(test)]
    pub(crate) fn new<'a, I: Iterator<Item = super::op::Op<'a>> + ExactSizeIterator + Clone>(
        ops: I,
    ) -> Self {
        let mut op_set = Self::default();
        let ops: Vec<_> = ops.collect();
        op_set.splice(0, &ops, TextEncoding::platform_default());
        op_set
    }

    pub(crate) fn len(&self) -> usize {
        self.id_actor.len()
    }

    pub(crate) fn sub_len(&self) -> usize {
        self.succ_actor.len()
    }

    pub(crate) fn dump(&self) {
        let mut id_a = self.id_actor.iter();
        let mut id_c = self.id_ctr.iter();
        let mut act = self.action.iter();
        let mut obj_a = self.obj_actor.iter();
        let mut obj_c = self.obj_ctr.iter();
        let mut key_str = self.key_str.iter();
        let mut key_a = self.key_actor.iter();
        let mut key_c = self.key_ctr.iter();
        let mut meta = self.value_meta.iter().map(|item| item.value);
        let mut value = self.value.raw_reader(0);
        let mut succ = self.succ_count.iter();
        let mut insert = self.insert.iter();
        let mut text = self.index.text.iter();
        let mut vis = self.index.visible.iter();
        let mut top = self.index.top.iter();
        let mut pos = 0;
        log!("::::: id       obj      key        elem     i v t tx act suc value");
        loop {
            let id_a_n = id_a.next().flatten();
            let id_c_n = id_c.next().flatten();
            let obj_a_n = obj_a.next();
            let obj_c_n = obj_c.next();
            if id_a_n.is_none() && id_c_n.is_none() && obj_a_n.is_none() && obj_c_n.is_none() {
                break;
            }
            let id_a_s = fmt_display(id_a_n);
            let id_c_s = fmt_display(id_c_n);
            let obj_a_s = fmt_opt_display(obj_a_n);
            let obj_c_s = fmt_opt_display(obj_c_n);
            let act_s = fmt_display(act.next().flatten());
            let insert_s = fmt_bool(insert.next().flatten().map(|value| *value));
            let text_s = fmt_opt_debug(text.next());
            let vis_s = fmt_bool(vis.next().flatten().map(|value| *value));
            let top_s = fmt_bool(top.next().flatten().map(|value| *value));
            let key_s = fmt_opt_debug(key_str.next());
            let key_a_s = fmt_opt_display(key_a.next());
            let key_c_s = fmt_opt_display(key_c.next());
            let succ_s = fmt_display(succ.next().flatten());
            let m = meta.next();
            let v = if let Some(m) = m {
                let raw_data = value
                    .read_next(m.length())
                    .expect("metadata matches raw value boundaries");
                ScalarValue::from_raw(m, raw_data).unwrap()
            } else {
                ScalarValue::Null
            };
            log!(
                "{:4}: {:8} {:8} {:10} {:8} {:1} {:1} {:1} {:2} {:3} {:1}   {}",
                pos,
                format!("({}, {})", id_c_s, id_a_s),
                format!("({}, {})", obj_c_s, obj_a_s),
                key_s,
                format!("({}, {})", key_c_s, key_a_s),
                insert_s,
                vis_s,
                top_s,
                text_s,
                act_s,
                succ_s,
                v,
            );
            pos += 1;
        }
    }
}

const NONE: &str = ".";

fn fmt_display<T: std::fmt::Display>(t: Option<T>) -> String {
    match t {
        None => NONE.to_owned(),
        Some(t) => format!("{}", t),
    }
}

fn fmt_opt_display<T: std::fmt::Display>(t: Option<Option<T>>) -> String {
    match t {
        None => NONE.to_owned(),
        Some(None) => "-".to_owned(),
        Some(Some(t)) => format!("{}", t),
    }
}

fn fmt_opt_debug<T: std::fmt::Debug>(t: Option<Option<T>>) -> String {
    match t {
        None => NONE.to_owned(),
        Some(None) => "-".to_owned(),
        Some(Some(t)) => format!("{:?}", t),
    }
}

fn fmt_bool(t: Option<bool>) -> String {
    match t {
        None => NONE.to_owned(),
        Some(true) => "t".to_string(),
        Some(false) => "f".to_string(),
    }
}

// Stick all of the column ID initialization in a module so we can turn off
// rustfmt for the whole thing
#[rustfmt::skip]
pub(crate) mod ids {
    use crate::storage::{columns::ColumnId, ColumnSpec};

    pub(crate) const OBJ_COL_ID:                ColumnId = ColumnId::new(0);
    pub(crate) const KEY_COL_ID:                ColumnId = ColumnId::new(1);
    pub(crate) const ID_COL_ID:                 ColumnId = ColumnId::new(2);
    pub(crate) const INSERT_COL_ID:             ColumnId = ColumnId::new(3);
    pub(crate) const ACTION_COL_ID:             ColumnId = ColumnId::new(4);
    pub(crate) const VAL_COL_ID:                ColumnId = ColumnId::new(5);
    pub(crate) const SUCC_COL_ID:               ColumnId = ColumnId::new(8);
    pub(crate) const EXPAND_COL_ID:             ColumnId = ColumnId::new(9);
    pub(crate) const MARK_NAME_COL_ID:          ColumnId = ColumnId::new(10);

    pub(crate) const ID_ACTOR_COL_SPEC:       ColumnSpec = ColumnSpec::new_actor(ID_COL_ID);
    pub(crate) const ID_COUNTER_COL_SPEC:     ColumnSpec = ColumnSpec::new_delta(ID_COL_ID);
    pub(crate) const OBJ_ID_ACTOR_COL_SPEC:   ColumnSpec = ColumnSpec::new_actor(OBJ_COL_ID);
    pub(crate) const OBJ_ID_COUNTER_COL_SPEC: ColumnSpec = ColumnSpec::new_integer(OBJ_COL_ID);
    pub(crate) const KEY_ACTOR_COL_SPEC:      ColumnSpec = ColumnSpec::new_actor(KEY_COL_ID);
    pub(crate) const KEY_COUNTER_COL_SPEC:    ColumnSpec = ColumnSpec::new_delta(KEY_COL_ID);
    pub(crate) const KEY_STR_COL_SPEC:        ColumnSpec = ColumnSpec::new_string(KEY_COL_ID);
    pub(crate) const SUCC_COUNT_COL_SPEC:     ColumnSpec = ColumnSpec::new_group(SUCC_COL_ID);
    pub(crate) const SUCC_ACTOR_COL_SPEC:     ColumnSpec = ColumnSpec::new_actor(SUCC_COL_ID);
    pub(crate) const SUCC_COUNTER_COL_SPEC:   ColumnSpec = ColumnSpec::new_delta(SUCC_COL_ID);
    pub(crate) const INSERT_COL_SPEC:         ColumnSpec = ColumnSpec::new_boolean(INSERT_COL_ID);
    pub(crate) const ACTION_COL_SPEC:         ColumnSpec = ColumnSpec::new_integer(ACTION_COL_ID);
    pub(crate) const VALUE_META_COL_SPEC:     ColumnSpec = ColumnSpec::new_value_metadata(VAL_COL_ID);
    pub(crate) const VALUE_COL_SPEC:          ColumnSpec = ColumnSpec::new_value(VAL_COL_ID);
    pub(crate) const MARK_NAME_COL_SPEC:      ColumnSpec = ColumnSpec::new_string(MARK_NAME_COL_ID);
    pub(crate) const EXPAND_COL_SPEC:         ColumnSpec = ColumnSpec::new_boolean(EXPAND_COL_ID);

    pub(crate) const ALL_COLUMN_SPECS: [ColumnSpec; 16] = [
        ID_ACTOR_COL_SPEC,
        ID_COUNTER_COL_SPEC,
        OBJ_ID_ACTOR_COL_SPEC,
        OBJ_ID_COUNTER_COL_SPEC,
        KEY_ACTOR_COL_SPEC,
        KEY_COUNTER_COL_SPEC,
        KEY_STR_COL_SPEC,
        SUCC_COUNT_COL_SPEC,
        SUCC_ACTOR_COL_SPEC,
        SUCC_COUNTER_COL_SPEC,
        INSERT_COL_SPEC,
        ACTION_COL_SPEC,
        VALUE_META_COL_SPEC,
        VALUE_COL_SPEC,
        MARK_NAME_COL_SPEC,
        EXPAND_COL_SPEC,
    ];
}

pub(super) use ids::*;
