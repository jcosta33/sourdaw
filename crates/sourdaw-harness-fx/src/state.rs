//! The state chunk both front ends save and load.
//!
//! Beside the one restorable value, `Gain`, the chunk carries the process mode
//! the host gave the instance, so a host test observes the mode through the
//! ordinary state read rather than through a side channel, and the block sizes
//! the host promised at activation and then handed over. The editor class
//! appends a record of its editor and its run loop (see [`GuiRecord`] and
//! [`RunLoopRecord`]). Loading restores only
//! `Gain`: everything else is a record of what the host did, not a setting.

const MAGIC: &[u8; 4] = b"SDFX";
const MAGIC_BYTES: usize = 4;
const GAIN_BYTES: usize = 8;
const MODE_BYTES: usize = 4;
const FRAMES_BYTES: usize = 4;
/// The number of bytes one chunk occupies.
pub(crate) const CHUNK_BYTES: usize = MAGIC_BYTES + GAIN_BYTES + 2 * MODE_BYTES + 2 * FRAMES_BYTES;

/// The mode field of an instance the host never told anything.
pub const MODE_NEVER_SET: i32 = -1;
/// A frame-count field nothing has recorded: no activation, or no block.
pub const FRAMES_NEVER_RECORDED: u32 = u32::MAX;

/// What one saved chunk records.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecordedState {
    pub gain: f64,
    /// CLAP: the mode `clap.render`'s `set` was last called with, in
    /// `CLAP_RENDER_*` values. VST3: the `processMode` of the last
    /// `setupProcessing`, in `ProcessModes_` values.
    pub configured_mode: i32,
    /// VST3: the `processMode` of the last `ProcessData`. CLAP carries no
    /// per-block mode, so a CLAP instance always records [`MODE_NEVER_SET`].
    pub last_block_mode: i32,
    /// CLAP: the `min_frames_count` of the last `activate`. VST3 has no such
    /// promise, so a VST3 instance records [`FRAMES_NEVER_RECORDED`].
    pub declared_min_frames: u32,
    /// CLAP: the smallest `frames_count` any `process` call carried. VST3
    /// records [`FRAMES_NEVER_RECORDED`].
    pub smallest_block_frames: u32,
}

pub fn encode(state: RecordedState) -> Vec<u8> {
    let mut chunk = Vec::with_capacity(CHUNK_BYTES + GUI_RECORD_BYTES);
    chunk.extend_from_slice(MAGIC);
    chunk.extend_from_slice(&state.gain.to_le_bytes());
    chunk.extend_from_slice(&state.configured_mode.to_le_bytes());
    chunk.extend_from_slice(&state.last_block_mode.to_le_bytes());
    chunk.extend_from_slice(&state.declared_min_frames.to_le_bytes());
    chunk.extend_from_slice(&state.smallest_block_frames.to_le_bytes());
    chunk
}

/// The chunk's fields, or `None` for bytes this plugin did not write.
pub fn decode(chunk: &[u8]) -> Option<RecordedState> {
    if chunk.len() != CHUNK_BYTES {
        return None;
    }
    let (magic, rest) = chunk.split_at(MAGIC_BYTES);
    if magic != MAGIC {
        return None;
    }
    let (gain, rest) = rest.split_at(GAIN_BYTES);
    let (configured, rest) = rest.split_at(MODE_BYTES);
    let (last_block, frames) = rest.split_at(MODE_BYTES);
    let (declared_min, smallest) = frames.split_at(FRAMES_BYTES);
    Some(RecordedState {
        gain: f64::from_le_bytes(gain.try_into().ok()?),
        configured_mode: i32::from_le_bytes(configured.try_into().ok()?),
        last_block_mode: i32::from_le_bytes(last_block.try_into().ok()?),
        declared_min_frames: u32::from_le_bytes(declared_min.try_into().ok()?),
        smallest_block_frames: u32::from_le_bytes(smallest.try_into().ok()?),
    })
}

// ── The editor class's record ───────────────────────────────────────────

const GUI_MAGIC: &[u8; 4] = b"SDGU";
/// How many editor calls the record keeps, oldest first. Calls past it are
/// dropped, which no test comes near.
pub const GUI_CALLS_KEPT: usize = 16;
/// The bytes the editor record appends to the chunk, its run-loop record
/// included.
pub(crate) const GUI_RECORD_BYTES: usize =
    MAGIC_BYTES + 1 + GUI_CALLS_KEPT + 3 + RUN_LOOP_RECORD_BYTES;

const RUN_LOOP_MAGIC: &[u8; 4] = b"SDRL";
const COUNT_BYTES: usize = 4;
const RUN_LOOP_RECORD_BYTES: usize = MAGIC_BYTES + 1 + 3 * COUNT_BYTES + 1;

/// One `clap.gui` call the host made, in the order it made them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuiCall {
    Create,
    Show,
    Hide,
    Destroy,
}

impl GuiCall {
    pub(crate) const fn code(self) -> u8 {
        match self {
            Self::Create => 1,
            Self::Show => 2,
            Self::Hide => 3,
            Self::Destroy => 4,
        }
    }

    fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Create),
            2 => Some(Self::Show),
            3 => Some(Self::Hide),
            4 => Some(Self::Destroy),
            _ => None,
        }
    }
}

/// What the editor class saw of its editor and what the host answered it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuiRecord {
    pub calls: Vec<GuiCall>,
    /// The host's answer to the last `request_show`, if one was made.
    pub show_answer: Option<bool>,
    /// The host's answer to the last `request_hide`, if one was made.
    pub hide_answer: Option<bool>,
    /// What `can_resize` answers now.
    pub can_resize: bool,
    pub run_loop: RunLoopRecord,
}

/// What the editor class's `clap.timer-support` and `clap.posix-fd-support`
/// registrations saw.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RunLoopRecord {
    /// Whether the host offered both extensions to `plugin.init`.
    pub offered: bool,
    /// `on_timer` calls for the timer registered in `plugin.init`, which the
    /// instance never unregisters.
    pub init_timer_fires: u32,
    /// `on_timer` calls for the timers the editors registered in `gui.create`.
    pub editor_timer_fires: u32,
    /// `on_fd` calls reporting an editor's pipe readable.
    pub editor_fd_fires: u32,
    /// Whether every editor callback ran on the thread that created that
    /// editor.
    pub all_on_creating_thread: bool,
}

const ANSWER_NEVER_GIVEN: u8 = 2;

pub(crate) fn encode_answer(answer: Option<bool>) -> u8 {
    match answer {
        None => ANSWER_NEVER_GIVEN,
        Some(answer) => u8::from(answer),
    }
}

fn decode_answer(byte: u8) -> Option<Option<bool>> {
    match byte {
        0 => Some(Some(false)),
        1 => Some(Some(true)),
        ANSWER_NEVER_GIVEN => Some(None),
        _ => None,
    }
}

/// Append the editor record to a chunk [`encode`] wrote.
pub(crate) fn append_gui_record(
    chunk: &mut Vec<u8>,
    call_codes: &[u8; GUI_CALLS_KEPT],
    call_count: usize,
    answers: [u8; 2],
    can_resize: bool,
    run_loop: RunLoopRecord,
) {
    chunk.extend_from_slice(GUI_MAGIC);
    chunk.push(call_count.min(GUI_CALLS_KEPT) as u8);
    chunk.extend_from_slice(call_codes);
    chunk.extend_from_slice(&answers);
    chunk.push(u8::from(can_resize));
    chunk.extend_from_slice(RUN_LOOP_MAGIC);
    chunk.push(u8::from(run_loop.offered));
    chunk.extend_from_slice(&run_loop.init_timer_fires.to_le_bytes());
    chunk.extend_from_slice(&run_loop.editor_timer_fires.to_le_bytes());
    chunk.extend_from_slice(&run_loop.editor_fd_fires.to_le_bytes());
    chunk.push(u8::from(run_loop.all_on_creating_thread));
}

fn decode_run_loop(record: &[u8]) -> Option<RunLoopRecord> {
    let (magic, rest) = record.split_at_checked(MAGIC_BYTES)?;
    if magic != RUN_LOOP_MAGIC {
        return None;
    }
    let (offered, rest) = rest.split_at_checked(1)?;
    let (init_timer, rest) = rest.split_at_checked(COUNT_BYTES)?;
    let (editor_timer, rest) = rest.split_at_checked(COUNT_BYTES)?;
    let (editor_fd, rest) = rest.split_at_checked(COUNT_BYTES)?;
    Some(RunLoopRecord {
        offered: offered == [1],
        init_timer_fires: u32::from_le_bytes(init_timer.try_into().ok()?),
        editor_timer_fires: u32::from_le_bytes(editor_timer.try_into().ok()?),
        editor_fd_fires: u32::from_le_bytes(editor_fd.try_into().ok()?),
        all_on_creating_thread: rest == [1],
    })
}

/// The editor class's chunk: the common fields and the editor record, or
/// `None` for bytes it did not write.
pub fn decode_gui(chunk: &[u8]) -> Option<(RecordedState, GuiRecord)> {
    if chunk.len() != CHUNK_BYTES + GUI_RECORD_BYTES {
        return None;
    }
    let (common, record) = chunk.split_at(CHUNK_BYTES);
    let state = decode(common)?;
    let (magic, rest) = record.split_at(MAGIC_BYTES);
    if magic != GUI_MAGIC {
        return None;
    }
    let (count, rest) = rest.split_at(1);
    let (codes, rest) = rest.split_at(GUI_CALLS_KEPT);
    let (rest, run_loop) = rest.split_at(3);
    let calls = codes
        .iter()
        .take(usize::from(count[0]))
        .map(|code| GuiCall::from_code(*code))
        .collect::<Option<Vec<_>>>()?;
    Some((
        state,
        GuiRecord {
            calls,
            show_answer: decode_answer(rest[0])?,
            hide_answer: decode_answer(rest[1])?,
            can_resize: rest[2] == 1,
            run_loop: decode_run_loop(run_loop)?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chunk_round_trips_every_field() {
        let state = RecordedState {
            gain: 0.25,
            configured_mode: 2,
            last_block_mode: MODE_NEVER_SET,
            declared_min_frames: 1,
            smallest_block_frames: 5,
        };

        assert_eq!(decode(&encode(state)), Some(state));
    }

    #[test]
    fn bytes_this_plugin_did_not_write_are_refused() {
        let mut chunk = encode(RecordedState {
            gain: 0.25,
            configured_mode: 0,
            last_block_mode: 0,
            declared_min_frames: FRAMES_NEVER_RECORDED,
            smallest_block_frames: FRAMES_NEVER_RECORDED,
        });
        chunk[0] = b'X';

        assert_eq!(decode(&chunk), None);
        assert_eq!(decode(&chunk[..CHUNK_BYTES - 1]), None);
    }

    #[test]
    fn an_editor_record_round_trips_its_calls_in_order_and_its_answers() {
        let state = RecordedState {
            gain: 0.5,
            configured_mode: MODE_NEVER_SET,
            last_block_mode: MODE_NEVER_SET,
            declared_min_frames: 1,
            smallest_block_frames: 64,
        };
        let mut codes = [0; GUI_CALLS_KEPT];
        let calls = [
            GuiCall::Create,
            GuiCall::Show,
            GuiCall::Hide,
            GuiCall::Destroy,
        ];
        for (slot, call) in codes.iter_mut().zip(calls) {
            *slot = call.code();
        }
        let run_loop = RunLoopRecord {
            offered: true,
            init_timer_fires: 7,
            editor_timer_fires: 3,
            editor_fd_fires: 2,
            all_on_creating_thread: true,
        };
        let mut chunk = encode(state);
        append_gui_record(
            &mut chunk,
            &codes,
            calls.len(),
            [encode_answer(Some(true)), encode_answer(None)],
            true,
            run_loop,
        );

        let (decoded, record) = decode_gui(&chunk).unwrap();

        assert_eq!(decoded, state);
        assert_eq!(
            record,
            GuiRecord {
                calls: calls.to_vec(),
                show_answer: Some(true),
                hide_answer: None,
                can_resize: true,
                run_loop,
            }
        );
        assert_eq!(decode(&chunk), None, "an editor chunk is not a plain one");
    }
}
