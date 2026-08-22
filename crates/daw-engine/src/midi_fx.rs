use crate::midi::diagnostics::ActiveMidiRtDiagnostics;
use crate::plugin_slot::{MidiNoteEvent, TransportState};

pub const MIDI_EVENT_BUFFER_CAPACITY: usize = 128;

const EMPTY_MIDI_EVENT: MidiNoteEvent = MidiNoteEvent {
    note: 0,
    velocity: 0,
    channel: 0,
    is_note_on: false,
    probability_cutoff: 0,
    project_probability_seed: 0,
    clip_id_hash: 0,
    event_id_hash: 0,
    absolute_occurrence_index: 0,
};

const FNV_OFFSET_BASIS: u32 = 2_166_136_261;
const FNV_PRIME: u32 = 16_777_619;
pub const PROBABILITY_CUTOFF_RANGE: u64 = 1_u64 << 32;

/// Convert an arbitrary finite percentage to the fixed cutoff shared by all runtimes.
pub fn probability_percent_to_cutoff(probability_percent: f64) -> u64 {
    if !probability_percent.is_finite() || probability_percent <= 0.0 {
        return 0;
    }
    if probability_percent >= 100.0 {
        return PROBABILITY_CUTOFF_RANGE;
    }

    let scaled = (probability_percent / 100.0) * PROBABILITY_CUTOFF_RANGE as f64;
    scaled.ceil() as u64
}

#[inline]
fn mix_byte(hash: u32, value: u8) -> u32 {
    (hash ^ u32::from(value)).wrapping_mul(FNV_PRIME)
}

#[inline]
fn mix_u32(mut hash: u32, value: u32) -> u32 {
    for byte in value.to_le_bytes() {
        hash = mix_byte(hash, byte);
    }
    hash
}

/// Hash a stable string identity before entering the audio thread.
pub fn hash_probability_id(value: &str) -> u32 {
    let code_unit_count = value.encode_utf16().count() as u32;
    let mut hash = mix_u32(FNV_OFFSET_BASIS, code_unit_count);
    for code_unit in value.encode_utf16() {
        hash = mix_byte(hash, (code_unit & 0xff) as u8);
        hash = mix_byte(hash, (code_unit >> 8) as u8);
    }
    hash
}

#[inline]
fn avalanche(mut hash: u32) -> u32 {
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0xc2b2_ae35);
    hash ^ (hash >> 16)
}

/// Allocation-free deterministic roll for a pre-hashed stable MIDI identity tuple.
#[inline]
pub fn deterministic_probability_roll(
    project_probability_seed: u32,
    clip_id_hash: u32,
    event_id_hash: u32,
    absolute_occurrence_index: u64,
) -> u32 {
    let mut hash = FNV_OFFSET_BASIS;
    hash = mix_u32(hash, project_probability_seed);
    hash = mix_u32(hash, clip_id_hash);
    hash = mix_u32(hash, event_id_hash);
    hash = mix_u32(hash, absolute_occurrence_index as u32);
    hash = mix_u32(hash, (absolute_occurrence_index >> 32) as u32);
    avalanche(hash)
}

pub struct MidiEventBuffer {
    events: [MidiNoteEvent; MIDI_EVENT_BUFFER_CAPACITY],
    len: usize,
}

impl MidiEventBuffer {
    pub fn new() -> Self {
        Self {
            events: [EMPTY_MIDI_EVENT; MIDI_EVENT_BUFFER_CAPACITY],
            len: 0,
        }
    }

    pub fn capacity(&self) -> usize {
        MIDI_EVENT_BUFFER_CAPACITY
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn as_slice(&self) -> &[MidiNoteEvent] {
        &self.events[..self.len]
    }

    pub fn iter(&self) -> impl Iterator<Item = &MidiNoteEvent> {
        self.as_slice().iter()
    }

    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut MidiNoteEvent> {
        self.events[..self.len].iter_mut()
    }

    pub fn try_push(&mut self, event: MidiNoteEvent) -> bool {
        if self.len >= MIDI_EVENT_BUFFER_CAPACITY {
            return false;
        }

        self.events[self.len] = event;
        self.len += 1;
        true
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    pub fn retain_mut<F>(&mut self, mut keep_event: F)
    where
        F: FnMut(&mut MidiNoteEvent) -> bool,
    {
        let mut write_index = 0;

        for read_index in 0..self.len {
            let mut event = self.events[read_index];
            if keep_event(&mut event) {
                self.events[write_index] = event;
                write_index += 1;
            }
        }

        self.len = write_index;
    }
}

/// A MIDI-FX parameter, addressed without a name for the reason given on
/// [`crate::timeline::AutomationTarget`]: a command carrying a `String`
/// parameter name would have its allocation freed on the audio thread when
/// the command is consumed.
///
/// The address is flat across every MIDI-FX kind — the same shape
/// [`crate::timeline::DeviceParam`] gives built-in devices — so one command
/// vocabulary serves the whole chain. A parameter an effect does not own is
/// ignored by that effect's [`MidiFx::set_param`], exactly as an unknown name
/// was before addressing.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MidiFxParam {
    /// The arpeggiator's step rate, in beats.
    Rate,
    /// The arpeggiator's pattern mode, addressed by its ordinal.
    Mode,
    /// The arpeggiator's octave range.
    Octaves,
    /// The velocity scaler's output floor.
    Min,
    /// The velocity scaler's output ceiling.
    Max,
    /// The velocity scaler's multiplicative scale.
    Scale,
    /// The velocity scaler's additive offset.
    Offset,
}

impl MidiFxParam {
    /// The wire name this parameter is addressed by. Its inverse is
    /// [`Self::from_name`], so the named and the addressed paths cannot drift
    /// into meaning different things.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Rate => "rate",
            Self::Mode => "mode",
            Self::Octaves => "octaves",
            Self::Min => "min",
            Self::Max => "max",
            Self::Scale => "scale",
            Self::Offset => "offset",
        }
    }

    /// Resolve a wire name onto its address — the inverse of [`Self::name`].
    /// `None` refuses the name control-side: a name with no address cannot
    /// cross the ring to be freed on the audio thread after the fact.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "rate" => Some(Self::Rate),
            "mode" => Some(Self::Mode),
            "octaves" => Some(Self::Octaves),
            "min" => Some(Self::Min),
            "max" => Some(Self::Max),
            "scale" => Some(Self::Scale),
            "offset" => Some(Self::Offset),
            _ => None,
        }
    }
}

pub trait MidiFx: Send {
    /// Process MIDI events. This can add, remove, or modify events.
    /// Returns the modified list of MIDI events to be passed to the next stage.
    fn process_midi(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
    );

    /// Internal scheduler hook for effects that publish bounded RT diagnostics.
    fn process_midi_with_diagnostics(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
        _diagnostics: &mut ActiveMidiRtDiagnostics,
    ) {
        self.process_midi(events, transport, sample_rate, num_samples);
    }

    /// Set a parameter by its address and value. The name-to-address
    /// resolution happened control-side ([`MidiFxParam::from_name`]), where an
    /// unmapped name is refused rather than carried onto the audio thread.
    fn set_param(&mut self, param: MidiFxParam, value: f32);

    /// Reset internal state (e.g. arpeggiator step counter).
    fn reset(&mut self);
}

/// The fixed capacity of one device's MIDI-FX table, on the same contract as
/// the scheduler's effect table ([`crate::scheduler::EFFECT_TABLE_CAPACITY`]):
/// the slots are built once, inline in the device, so installing an FX neither
/// allocates nor frees on the audio thread, and an add past the ceiling is
/// refused and counted rather than grown.
pub(crate) const MIDI_FX_TABLE_CAPACITY: usize = 8;

/// One resident MIDI-FX unit. An enum rather than a `Box<dyn MidiFx>`: the
/// unit lives inline in the device's preallocated table, so installing one
/// writes it in place instead of boxing it on the audio thread (ADR 0020).
pub(crate) enum MidiFxSlot {
    Arpeggiator(Arpeggiator),
    VelocityScaler(VelocityScaler),
}

impl MidiFx for MidiFxSlot {
    fn process_midi(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
    ) {
        match self {
            Self::Arpeggiator(fx) => fx.process_midi(events, transport, sample_rate, num_samples),
            Self::VelocityScaler(fx) => {
                fx.process_midi(events, transport, sample_rate, num_samples)
            }
        }
    }

    fn process_midi_with_diagnostics(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) {
        match self {
            Self::Arpeggiator(fx) => fx.process_midi_with_diagnostics(
                events,
                transport,
                sample_rate,
                num_samples,
                diagnostics,
            ),
            Self::VelocityScaler(fx) => fx.process_midi_with_diagnostics(
                events,
                transport,
                sample_rate,
                num_samples,
                diagnostics,
            ),
        }
    }

    fn set_param(&mut self, param: MidiFxParam, value: f32) {
        match self {
            Self::Arpeggiator(fx) => fx.set_param(param, value),
            Self::VelocityScaler(fx) => fx.set_param(param, value),
        }
    }

    fn reset(&mut self) {
        match self {
            Self::Arpeggiator(fx) => fx.reset(),
            Self::VelocityScaler(fx) => fx.reset(),
        }
    }
}

/// A device's MIDI-FX chain: a fixed table of inline slots, compact from the
/// front, so chain order — the order MIDI flows through the units — is the
/// index the commands address and removal preserves.
///
/// Every operation is a move within memory the device already owns: pushing
/// never grows anything, and the slot an add or a remove hands back carries no
/// heap, so nothing here allocates or frees on the audio thread (ADR 0020).
pub(crate) struct MidiFxTable {
    slots: [Option<MidiFxSlot>; MIDI_FX_TABLE_CAPACITY],
    len: usize,
}

impl MidiFxTable {
    pub(crate) fn new() -> Self {
        Self {
            slots: std::array::from_fn(|_| None),
            len: 0,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.len
    }

    pub(crate) fn capacity(&self) -> usize {
        MIDI_FX_TABLE_CAPACITY
    }

    pub(crate) fn is_full(&self) -> bool {
        self.len == MIDI_FX_TABLE_CAPACITY
    }

    /// Append one unit at the end of the chain. `false` refuses a full table:
    /// the caller counts the refusal rather than growing the table inside the
    /// audio deadline.
    pub(crate) fn push(&mut self, slot: MidiFxSlot) -> bool {
        if self.is_full() {
            return false;
        }

        self.slots[self.len] = Some(slot);
        self.len += 1;
        true
    }

    /// Take the unit at `index` out of the chain, shifting the units behind
    /// it forward so the chain stays compact. `None` leaves an out-of-range
    /// removal untouched.
    pub(crate) fn remove(&mut self, index: usize) -> Option<MidiFxSlot> {
        if index >= self.len {
            return None;
        }

        let removed = self.slots[index].take();
        for shift_index in index..self.len - 1 {
            self.slots[shift_index] = self.slots[shift_index + 1].take();
        }
        self.len -= 1;
        removed
    }

    pub(crate) fn get_mut(&mut self, index: usize) -> Option<&mut MidiFxSlot> {
        if index >= self.len {
            return None;
        }

        Some(
            self.slots[index]
                .as_mut()
                .expect("every slot below len holds a unit by construction"),
        )
    }

    /// Iterate the chain in MIDI-flow order.
    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = &mut MidiFxSlot> {
        self.slots[..self.len].iter_mut().map(|slot| {
            slot.as_mut()
                .expect("every slot below len holds a unit by construction")
        })
    }
}

pub struct VelocityScaler {
    pub min: u8,
    pub max: u8,
    pub scale: f32,
    pub offset: i16,
}

impl Default for VelocityScaler {
    fn default() -> Self {
        Self {
            min: 0,
            max: 127,
            scale: 1.0,
            offset: 0,
        }
    }
}

impl MidiFx for VelocityScaler {
    fn process_midi(
        &mut self,
        events: &mut MidiEventBuffer,
        _transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
        for event in events.iter_mut() {
            if event.is_note_on {
                let mut vel = (event.velocity as f32 * self.scale) as i16 + self.offset;
                vel = vel.clamp(self.min as i16, self.max as i16);
                event.velocity = vel as u8;
            }
        }
    }

    fn set_param(&mut self, param: MidiFxParam, value: f32) {
        // min/max are independently settable but must stay ordered: `process_midi`
        // calls `i16::clamp(min, max)` every note-on, and that panics on the
        // audio thread the moment min > max. Restoring the invariant here,
        // rather than at the call site, keeps every caller safe by construction.
        match param {
            MidiFxParam::Min => {
                self.min = value.clamp(0.0, 127.0) as u8;
                if self.min > self.max {
                    self.max = self.min;
                }
            }
            MidiFxParam::Max => {
                self.max = value.clamp(0.0, 127.0) as u8;
                if self.max < self.min {
                    self.min = self.max;
                }
            }
            MidiFxParam::Scale => self.scale = value,
            MidiFxParam::Offset => self.offset = value as i16,
            // The arpeggiator's parameters: not owned by this unit.
            MidiFxParam::Rate | MidiFxParam::Mode | MidiFxParam::Octaves => {}
        }
    }

    fn reset(&mut self) {}
}

pub enum ArpMode {
    Up,
    Down,
    UpDown,
    Random,
}

const ARPEGGIATOR_ACTIVE_NOTE_CAPACITY: usize = 16;
pub const ARPEGGIATOR_MIN_RATE_BEATS: f64 = 1.0 / 64.0;
pub const ARPEGGIATOR_MAX_RATE_BEATS: f64 = 16.0;
pub const ARPEGGIATOR_MAX_OCTAVE_RANGE: u8 = 4;

#[derive(Clone, Copy)]
struct ActiveNote {
    note: u8,
    velocity: u8,
    channel: i16,
}

struct ActiveNoteBuffer {
    notes: [ActiveNote; ARPEGGIATOR_ACTIVE_NOTE_CAPACITY],
    len: usize,
}

impl ActiveNoteBuffer {
    fn new() -> Self {
        Self {
            notes: [ActiveNote {
                note: 0,
                velocity: 0,
                channel: 0,
            }; ARPEGGIATOR_ACTIVE_NOTE_CAPACITY],
            len: 0,
        }
    }

    #[cfg(test)]
    fn capacity(&self) -> usize {
        ARPEGGIATOR_ACTIVE_NOTE_CAPACITY
    }

    fn len(&self) -> usize {
        self.len
    }

    fn is_empty(&self) -> bool {
        self.len == 0
    }

    fn contains(&self, note: &u8) -> bool {
        self.notes[..self.len].iter().any(|held| held.note == *note)
    }

    fn get(&self, index: usize) -> Option<ActiveNote> {
        if index >= self.len {
            return None;
        }

        Some(self.notes[index])
    }

    fn try_insert_sorted(&mut self, entry: ActiveNote) -> bool {
        if self.contains(&entry.note) {
            return true;
        }

        if self.len >= ARPEGGIATOR_ACTIVE_NOTE_CAPACITY {
            return false;
        }

        let mut insert_index = 0;
        while insert_index < self.len && self.notes[insert_index].note < entry.note {
            insert_index += 1;
        }

        let mut shift_index = self.len;
        while shift_index > insert_index {
            self.notes[shift_index] = self.notes[shift_index - 1];
            shift_index -= 1;
        }

        self.notes[insert_index] = entry;
        self.len += 1;
        true
    }

    fn remove(&mut self, note: u8) {
        let mut remove_index = None;

        for index in 0..self.len {
            if self.notes[index].note == note {
                remove_index = Some(index);
                break;
            }
        }

        if let Some(start_index) = remove_index {
            for index in start_index..self.len.saturating_sub(1) {
                self.notes[index] = self.notes[index + 1];
            }
            self.len -= 1;
        }
    }
}

/// The pitch the arpeggiator most recently sounded and has not yet released.
#[derive(Clone, Copy)]
struct SoundingNote {
    note: u8,
    channel: i16,
}

pub struct Arpeggiator {
    pub mode: ArpMode,
    pub rate_beats: f64,
    pub octave_range: u8,
    active_notes: ActiveNoteBuffer,
    sounding: Option<SoundingNote>,
    steps_emitted: u64,
    last_beat_step: f64,
}

impl Default for Arpeggiator {
    fn default() -> Self {
        Self {
            mode: ArpMode::Up,
            rate_beats: 0.25, // 1/16th note
            octave_range: 1,
            active_notes: ActiveNoteBuffer::new(),
            sounding: None,
            steps_emitted: 0,
            last_beat_step: -1.0,
        }
    }
}

impl Arpeggiator {
    /// Map the running step counter to an index into the octave-expanded
    /// pattern. Every mode starts at its natural endpoint (Up and UpDown at
    /// the lowest note, Down at the highest) on the first step after a reset.
    fn pattern_index(&self, pattern_len: usize) -> usize {
        let step = self.steps_emitted as usize;
        match self.mode {
            ArpMode::Up => step % pattern_len,
            ArpMode::Down => pattern_len - 1 - (step % pattern_len),
            ArpMode::UpDown => {
                if pattern_len == 1 {
                    return 0;
                }
                // Classic up-down without repeating the endpoints.
                let cycle = pattern_len * 2 - 2;
                let position = step % cycle;
                if position < pattern_len {
                    position
                } else {
                    cycle - position
                }
            }
            // Deterministic by design: renders and automation replay
            // identically, but the avalanche hash removes the audible
            // fixed-stride cycling of a plain modulo sequence.
            ArpMode::Random => {
                avalanche(mix_u32(FNV_OFFSET_BASIS, self.steps_emitted as u32)) as usize
                    % pattern_len
            }
        }
    }

    fn release_sounding(&mut self, events: &mut MidiEventBuffer) {
        if let Some(sounding) = self.sounding.take() {
            let _ = events.try_push(MidiNoteEvent {
                note: sounding.note,
                velocity: 0,
                channel: sounding.channel,
                is_note_on: false,
                probability_cutoff: PROBABILITY_CUTOFF_RANGE,
                project_probability_seed: 0,
                clip_id_hash: 0,
                event_id_hash: 0,
                absolute_occurrence_index: 0,
            });
        }
    }
}

#[cfg(test)]
impl Arpeggiator {
    pub(crate) fn active_note_count(&self) -> usize {
        self.active_notes.len()
    }

    pub(crate) fn contains_active_note(&self, note: u8) -> bool {
        self.active_notes.contains(&note)
    }
}

impl MidiFx for Arpeggiator {
    fn process_midi(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
    ) {
        let mut diagnostics = ActiveMidiRtDiagnostics::new();
        self.process_midi_with_diagnostics(
            events,
            transport,
            sample_rate,
            num_samples,
            &mut diagnostics,
        );
    }

    fn process_midi_with_diagnostics(
        &mut self,
        events: &mut MidiEventBuffer,
        transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
        diagnostics: &mut ActiveMidiRtDiagnostics,
    ) {
        // 1. Maintain active note list from incoming events
        for event in events.iter() {
            if event.is_note_on {
                // Drop the newest active note when the fixed tracking buffer is full.
                if !self.active_notes.try_insert_sorted(ActiveNote {
                    note: event.note,
                    velocity: event.velocity,
                    channel: event.channel,
                }) {
                    diagnostics.record_arpeggiator_active_note_exhaustion(1);
                }
            } else {
                self.active_notes.remove(event.note);
            }
        }

        // Clear input events to suppress them from the instrument,
        // we'll replace them with our own arpeggiated events.
        events.clear();

        if self.active_notes.is_empty() {
            // The chord was released: silence whatever the arp left sounding
            // before dropping back to idle.
            self.release_sounding(events);
            self.reset_stepping();
            return;
        }

        if !transport.is_playing {
            // The transport clock is the arp's only clock; while it is stopped
            // no new step can be timed, so hold nothing over.
            self.release_sounding(events);
            self.reset_stepping();
            return;
        }

        // 2. Determine if it's time for a new step
        let beat = transport.song_pos_beats;
        let step_beat = (beat / self.rate_beats).floor();

        // A backwards move is a loop wrap or relocate: retrigger immediately
        // instead of stalling until the playhead passes its old position.
        if step_beat != self.last_beat_step {
            self.last_beat_step = step_beat;

            // 3. Select the note for this step from the octave-expanded pattern
            let octave_count =
                usize::from(self.octave_range.clamp(1, ARPEGGIATOR_MAX_OCTAVE_RANGE));
            let pattern_len = self.active_notes.len() * octave_count;
            let index = self.pattern_index(pattern_len);
            let octave = (index / self.active_notes.len()) as u8;
            let Some(held) = self.active_notes.get(index % self.active_notes.len()) else {
                return;
            };
            let pitch = held.note.saturating_add(octave * 12).min(127);

            // 4. Replace the previous step's note with this one
            self.release_sounding(events);
            let _ = events.try_push(MidiNoteEvent {
                note: pitch,
                velocity: held.velocity,
                channel: held.channel,
                is_note_on: true,
                probability_cutoff: PROBABILITY_CUTOFF_RANGE,
                project_probability_seed: 0,
                clip_id_hash: 0,
                event_id_hash: 0,
                absolute_occurrence_index: 0,
            });
            self.sounding = Some(SoundingNote {
                note: pitch,
                channel: held.channel,
            });
            self.steps_emitted += 1;
        }
    }

    fn set_param(&mut self, param: MidiFxParam, value: f32) {
        match param {
            MidiFxParam::Rate => {
                // The step timer divides by this every block; zero, negative
                // and non-finite rates must never reach it.
                let rate = f64::from(value);
                self.rate_beats = if rate.is_finite() {
                    rate.clamp(ARPEGGIATOR_MIN_RATE_BEATS, ARPEGGIATOR_MAX_RATE_BEATS)
                } else {
                    self.rate_beats
                };
            }
            MidiFxParam::Mode => {
                self.mode = match value as i32 {
                    0 => ArpMode::Up,
                    1 => ArpMode::Down,
                    2 => ArpMode::UpDown,
                    _ => ArpMode::Random,
                };
            }
            MidiFxParam::Octaves => {
                self.octave_range = if value.is_finite() {
                    (value as i32).clamp(1, i32::from(ARPEGGIATOR_MAX_OCTAVE_RANGE)) as u8
                } else {
                    self.octave_range
                };
            }
            // The velocity scaler's parameters: not owned by this unit.
            MidiFxParam::Min | MidiFxParam::Max | MidiFxParam::Scale | MidiFxParam::Offset => {}
        }
    }

    fn reset(&mut self) {
        self.reset_stepping();
        self.sounding = None;
    }
}

impl Arpeggiator {
    fn reset_stepping(&mut self) {
        self.steps_emitted = 0;
        self.last_beat_step = -1.0;
    }
}

#[derive(Default)]
pub struct ProbabilityEvaluator;

impl MidiFx for ProbabilityEvaluator {
    fn process_midi(
        &mut self,
        events: &mut MidiEventBuffer,
        _transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
        events.retain_mut(|event| {
            if event.probability_cutoff >= PROBABILITY_CUTOFF_RANGE {
                return true;
            }
            if event.probability_cutoff == 0 {
                return false;
            }

            let roll = deterministic_probability_roll(
                event.project_probability_seed,
                event.clip_id_hash,
                event.event_id_hash,
                event.absolute_occurrence_index,
            );
            u64::from(roll) < event.probability_cutoff
        });
    }

    fn set_param(&mut self, _param: MidiFxParam, _value: f32) {}

    fn reset(&mut self) {}
}

#[cfg(test)]
fn note_on(note: u8) -> MidiNoteEvent {
    MidiNoteEvent {
        note,
        velocity: 100,
        channel: 0,
        is_note_on: true,
        probability_cutoff: PROBABILITY_CUTOFF_RANGE,
        project_probability_seed: 0,
        clip_id_hash: 0,
        event_id_hash: 0,
        absolute_occurrence_index: 0,
    }
}

#[cfg(test)]
mod velocity_scaler_tests {
    use super::*;

    #[test]
    fn set_param_ordering_that_inverts_min_and_max_does_not_panic_on_the_next_note_on() {
        let mut scaler = VelocityScaler::default();
        // A UI or automation lane can send these independently: min pushed
        // above the current max is a routine sequence, not an edge case.
        scaler.set_param(MidiFxParam::Min, 100.0);
        scaler.set_param(MidiFxParam::Max, 50.0);

        let mut events = MidiEventBuffer::new();
        assert!(events.try_push(note_on(60)));

        // i16::clamp panics when min > max; this must not panic on the RT path.
        scaler.process_midi(&mut events, &TransportState::default(), 48_000.0, 128);

        let processed = events.as_slice()[0];
        assert!(processed.velocity >= scaler.min.min(scaler.max));
        assert!(processed.velocity <= scaler.min.max(scaler.max));
    }

    #[test]
    fn set_param_never_leaves_min_greater_than_max() {
        let mut scaler = VelocityScaler::default();
        scaler.set_param(MidiFxParam::Max, 30.0);
        scaler.set_param(MidiFxParam::Min, 90.0);
        assert!(scaler.min <= scaler.max);

        scaler.set_param(MidiFxParam::Min, 10.0);
        scaler.set_param(MidiFxParam::Max, 5.0);
        assert!(scaler.min <= scaler.max);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `from_name` is the inverse of `name`, so the named boundary and the
    /// addressed command cannot drift into meaning different things.
    #[test]
    fn midi_fx_param_from_name_is_the_inverse_of_name() {
        const EVERY_PARAM: [MidiFxParam; 7] = [
            MidiFxParam::Rate,
            MidiFxParam::Mode,
            MidiFxParam::Octaves,
            MidiFxParam::Min,
            MidiFxParam::Max,
            MidiFxParam::Scale,
            MidiFxParam::Offset,
        ];

        for param in EVERY_PARAM {
            assert_eq!(MidiFxParam::from_name(param.name()), Some(param));
        }
        assert_eq!(MidiFxParam::from_name("not-a-real-param"), None);
    }

    /// Pushing past the fixed ceiling is refused, not grown: the table has no
    /// heap to grow into, and the caller must be able to tell the two apart.
    #[test]
    fn a_full_midi_fx_table_refuses_the_next_push() {
        let mut table = MidiFxTable::new();
        for _ in 0..MIDI_FX_TABLE_CAPACITY {
            assert!(table.push(MidiFxSlot::VelocityScaler(VelocityScaler::default())));
        }

        assert!(table.is_full());
        assert!(!table.push(MidiFxSlot::VelocityScaler(VelocityScaler::default())));
        assert_eq!(table.len(), MIDI_FX_TABLE_CAPACITY);
    }

    /// Removal keeps the chain compact, so the index the commands address is
    /// the position MIDI flows through after any removal.
    #[test]
    fn removal_shifts_the_chain_behind_the_taken_slot() {
        let mut table = MidiFxTable::new();
        assert!(table.push(MidiFxSlot::VelocityScaler(VelocityScaler {
            min: 1,
            ..VelocityScaler::default()
        })));
        assert!(table.push(MidiFxSlot::Arpeggiator(Arpeggiator::default())));
        assert!(table.push(MidiFxSlot::VelocityScaler(VelocityScaler {
            min: 2,
            ..VelocityScaler::default()
        })));

        let removed = table.remove(1);
        assert!(removed.is_some());
        assert!(table.remove(MIDI_FX_TABLE_CAPACITY).is_none());
        assert_eq!(table.len(), 2);
        match table.get_mut(0) {
            Some(MidiFxSlot::VelocityScaler(scaler)) => assert_eq!(scaler.min, 1),
            _ => panic!("slot 0 must hold the min=1 scaler"),
        }
        match table.get_mut(1) {
            Some(MidiFxSlot::VelocityScaler(scaler)) => assert_eq!(scaler.min, 2),
            _ => panic!("slot 1 must hold the min=2 scaler after the shift"),
        }
        assert!(table.get_mut(2).is_none());
    }

    fn playing_at(beat: f64) -> TransportState {
        TransportState {
            is_playing: true,
            song_pos_beats: beat,
            ..TransportState::default()
        }
    }

    fn note_off(note: u8) -> MidiNoteEvent {
        MidiNoteEvent {
            is_note_on: false,
            ..note_on(note)
        }
    }

    /// Advance the arp one block at the given beat with no new input and
    /// return the emitted (note, is_note_on) pairs in order.
    fn step_at(arpeggiator: &mut Arpeggiator, beat: f64) -> Vec<(u8, bool)> {
        let mut events = MidiEventBuffer::new();
        arpeggiator.process_midi(&mut events, &playing_at(beat), 48_000.0, 128);
        events
            .iter()
            .map(|event| (event.note, event.is_note_on))
            .collect()
    }

    fn hold_chord(arpeggiator: &mut Arpeggiator, notes: &[u8], beat: f64) -> Vec<(u8, bool)> {
        let mut events = MidiEventBuffer::new();
        for note in notes {
            assert!(events.try_push(note_on(*note)));
        }
        arpeggiator.process_midi(&mut events, &playing_at(beat), 48_000.0, 128);
        events
            .iter()
            .map(|event| (event.note, event.is_note_on))
            .collect()
    }

    #[test]
    fn scheduler_arpeggiator_drops_newest_active_notes_after_fixed_capacity() {
        let mut arpeggiator = Arpeggiator::default();
        let mut events = MidiEventBuffer::new();

        for note in 60..=76 {
            assert!(events.try_push(note_on(note)));
        }

        arpeggiator.process_midi(&mut events, &TransportState::default(), 48_000.0, 128);

        assert_eq!(
            arpeggiator.active_notes.capacity(),
            ARPEGGIATOR_ACTIVE_NOTE_CAPACITY
        );
        assert_eq!(
            arpeggiator.active_notes.len(),
            ARPEGGIATOR_ACTIVE_NOTE_CAPACITY
        );
        assert!(arpeggiator.active_notes.contains(&75));
        assert!(!arpeggiator.active_notes.contains(&76));
    }

    /// Regression (#1838 F7): the arp emitted note-ons and nothing else, so
    /// every arpeggiated note sounded forever. Each step must first release
    /// the previous step's pitch.
    #[test]
    fn each_step_releases_the_previous_pitch_before_sounding_the_next() {
        let mut arpeggiator = Arpeggiator::default();

        assert_eq!(
            hold_chord(&mut arpeggiator, &[60, 64, 67], 0.0),
            vec![(60, true)]
        );
        assert_eq!(
            step_at(&mut arpeggiator, 0.25),
            vec![(60, false), (64, true)]
        );
        assert_eq!(
            step_at(&mut arpeggiator, 0.5),
            vec![(64, false), (67, true)]
        );
    }

    /// Regression (#1838 F7): Up incremented before the first emit and so
    /// skipped the lowest held note.
    #[test]
    fn up_starts_at_the_lowest_held_note_and_down_at_the_highest() {
        let mut up = Arpeggiator::default();
        assert_eq!(hold_chord(&mut up, &[60, 64, 67], 0.0), vec![(60, true)]);

        let mut down = Arpeggiator::default();
        down.set_param(MidiFxParam::Mode, 1.0);
        assert_eq!(hold_chord(&mut down, &[60, 64, 67], 0.0), vec![(67, true)]);
    }

    #[test]
    fn up_down_walks_the_pattern_without_repeating_endpoints() {
        let mut arpeggiator = Arpeggiator::default();
        arpeggiator.set_param(MidiFxParam::Mode, 2.0);

        let mut sequence = vec![hold_chord(&mut arpeggiator, &[60, 64, 67], 0.0)[0].0];
        for step in 1..6 {
            let emitted = step_at(&mut arpeggiator, 0.25 * f64::from(step));
            sequence.push(emitted.last().expect("every step emits a note-on").0);
        }

        assert_eq!(sequence, vec![60, 64, 67, 64, 60, 64]);
    }

    /// Regression (#1838 F7): releasing the chord left the last arpeggiated
    /// note sounding with no note-off ever coming.
    #[test]
    fn releasing_the_chord_releases_the_sounding_note() {
        let mut arpeggiator = Arpeggiator::default();
        assert_eq!(hold_chord(&mut arpeggiator, &[60], 0.0), vec![(60, true)]);

        let mut events = MidiEventBuffer::new();
        assert!(events.try_push(note_off(60)));
        arpeggiator.process_midi(&mut events, &playing_at(0.1), 48_000.0, 128);

        assert_eq!(
            events
                .iter()
                .map(|e| (e.note, e.is_note_on))
                .collect::<Vec<_>>(),
            vec![(60, false)]
        );
    }

    /// Regression (#1838 F7): `transport.is_playing` was never consulted; a
    /// stopped transport must silence the arp instead of freezing its last
    /// note-on.
    #[test]
    fn stopping_the_transport_releases_the_sounding_note() {
        let mut arpeggiator = Arpeggiator::default();
        assert_eq!(hold_chord(&mut arpeggiator, &[60], 0.0), vec![(60, true)]);

        let mut events = MidiEventBuffer::new();
        arpeggiator.process_midi(&mut events, &TransportState::default(), 48_000.0, 128);

        assert_eq!(
            events
                .iter()
                .map(|e| (e.note, e.is_note_on))
                .collect::<Vec<_>>(),
            vec![(60, false)]
        );
    }

    #[test]
    fn emitted_steps_inherit_the_held_notes_velocity_and_channel() {
        let mut arpeggiator = Arpeggiator::default();
        let mut events = MidiEventBuffer::new();
        assert!(events.try_push(MidiNoteEvent {
            velocity: 37,
            channel: 5,
            ..note_on(60)
        }));

        arpeggiator.process_midi(&mut events, &playing_at(0.0), 48_000.0, 128);

        let emitted = events.as_slice()[0];
        assert_eq!(
            (
                emitted.note,
                emitted.velocity,
                emitted.channel,
                emitted.is_note_on
            ),
            (60, 37, 5, true)
        );
    }

    /// Regression (#1838 F7): `"rate"` fed a division unvalidated; zero,
    /// negative and non-finite values must clamp instead of poisoning the
    /// step timer.
    #[test]
    fn rate_clamps_to_a_positive_finite_range() {
        let mut arpeggiator = Arpeggiator::default();

        arpeggiator.set_param(MidiFxParam::Rate, 0.0);
        assert_eq!(arpeggiator.rate_beats, ARPEGGIATOR_MIN_RATE_BEATS);

        arpeggiator.set_param(MidiFxParam::Rate, -3.0);
        assert_eq!(arpeggiator.rate_beats, ARPEGGIATOR_MIN_RATE_BEATS);

        arpeggiator.set_param(MidiFxParam::Rate, f32::NAN);
        assert_eq!(arpeggiator.rate_beats, ARPEGGIATOR_MIN_RATE_BEATS);

        arpeggiator.set_param(MidiFxParam::Rate, 64.0);
        assert_eq!(arpeggiator.rate_beats, ARPEGGIATOR_MAX_RATE_BEATS);
    }

    /// Regression (#1838 F7): `octave_range` was written by `set_param` and
    /// never read; the pattern must actually span the configured octaves.
    #[test]
    fn octave_range_expands_the_pattern_upward() {
        let mut arpeggiator = Arpeggiator::default();
        arpeggiator.set_param(MidiFxParam::Octaves, 2.0);

        assert_eq!(hold_chord(&mut arpeggiator, &[60], 0.0), vec![(60, true)]);
        assert_eq!(
            step_at(&mut arpeggiator, 0.25),
            vec![(60, false), (72, true)]
        );
        assert_eq!(
            step_at(&mut arpeggiator, 0.5),
            vec![(72, false), (60, true)]
        );
    }

    /// Regression (#1838 F7): Random was `step * 17 % len` — a fixed-stride
    /// rotation. It must stay deterministic for reproducible renders but
    /// cover the held notes without an audible constant stride.
    #[test]
    fn random_is_deterministic_across_runs_and_covers_the_chord() {
        let chord = [60u8, 64, 67, 71];
        let sequence = |arpeggiator: &mut Arpeggiator| {
            let mut emitted = vec![hold_chord(arpeggiator, &chord, 0.0)[0].0];
            for step in 1..32 {
                let step_events = step_at(arpeggiator, 0.25 * f64::from(step));
                emitted.push(step_events.last().expect("step emits").0);
            }
            emitted
        };

        let mut first = Arpeggiator::default();
        first.set_param(MidiFxParam::Mode, 3.0);
        let mut second = Arpeggiator::default();
        second.set_param(MidiFxParam::Mode, 3.0);

        let first_run = sequence(&mut first);
        assert_eq!(first_run, sequence(&mut second));
        for note in chord {
            assert!(first_run.contains(&note), "note {note} never played");
        }

        // The sequence is a replay contract: pinned literally so any change
        // to the selection formula — including a revert to the old
        // `step * 17 % len` rotation, whose output for this chord is the
        // period-4 cycle starting 64,67,71,60 — fails here.
        assert_eq!(
            first_run,
            vec![
                71, 67, 67, 67, 71, 60, 60, 60, 64, 71, 71, 60, 60, 64, 60, 60, 71, 60, 67, 71, 67,
                60, 71, 60, 60, 71, 60, 60, 60, 71, 71, 71
            ]
        );
    }

    /// Regression (#1838 F7 adjacent): a rewind (loop wrap or relocate) left
    /// `last_beat_step` ahead of the playhead and the arp stalled silent
    /// until the position was passed again.
    #[test]
    fn a_rewind_retriggers_instead_of_stalling() {
        let mut arpeggiator = Arpeggiator::default();
        assert_eq!(
            hold_chord(&mut arpeggiator, &[60, 64], 4.0),
            vec![(60, true)]
        );

        let emitted = step_at(&mut arpeggiator, 0.0);
        assert_eq!(emitted, vec![(60, false), (64, true)]);
    }
}

#[cfg(test)]
mod deterministic_probability {
    use super::*;

    #[test]
    fn actual_evaluator_keeps_the_published_near_boundary_vector() {
        let mut events = MidiEventBuffer::new();
        assert!(events.try_push(MidiNoteEvent {
            probability_cutoff: probability_percent_to_cutoff(88.92774630813615),
            project_probability_seed: u32::MAX,
            clip_id_hash: hash_probability_id("loop-🎹"),
            event_id_hash: hash_probability_id("note-Ω"),
            absolute_occurrence_index: 4_294_967_297,
            ..note_on(60)
        }));

        ProbabilityEvaluator::default().process_midi(
            &mut events,
            &TransportState::default(),
            48_000.0,
            128,
        );

        assert_eq!(events.len(), 1);
    }

    #[test]
    fn does_not_shift_when_an_unrelated_event_is_inserted() {
        let target = MidiNoteEvent {
            probability_cutoff: probability_percent_to_cutoff(20.0),
            project_probability_seed: 0xdecafbad,
            clip_id_hash: hash_probability_id("clip-target"),
            event_id_hash: hash_probability_id("event-target"),
            absolute_occurrence_index: 7,
            ..note_on(60)
        };

        let mut isolated = MidiEventBuffer::new();
        assert!(isolated.try_push(target));
        ProbabilityEvaluator::default().process_midi(
            &mut isolated,
            &TransportState::default(),
            48_000.0,
            128,
        );

        let mut with_unrelated = MidiEventBuffer::new();
        assert!(with_unrelated.try_push(MidiNoteEvent {
            probability_cutoff: probability_percent_to_cutoff(50.0),
            project_probability_seed: 0x12345678,
            clip_id_hash: hash_probability_id("clip-unrelated"),
            event_id_hash: hash_probability_id("event-unrelated"),
            absolute_occurrence_index: 99,
            ..note_on(61)
        }));
        assert!(with_unrelated.try_push(target));
        ProbabilityEvaluator::default().process_midi(
            &mut with_unrelated,
            &TransportState::default(),
            48_000.0,
            128,
        );

        let isolated_kept_target = isolated.iter().any(|event| event.note == target.note);
        let inserted_kept_target = with_unrelated.iter().any(|event| event.note == target.note);
        assert_eq!(inserted_kept_target, isolated_kept_target);
    }

    #[test]
    fn matches_the_cross_runtime_tuple_corpus() {
        let corpus = [
            (0, "clip-0", "event-0", 0, 2_209_426_670, 50.0, false),
            (1, "clip-a", "event-alpha", 0, 1_901_562_438, 50.0, true),
            (
                0xdecafbad,
                "clip-1",
                "event-alpha",
                0,
                283_418_835,
                50.0,
                true,
            ),
            (
                0xdecafbad,
                "clip-1",
                "event-beta",
                0,
                3_377_534_636,
                50.0,
                false,
            ),
            (
                u32::MAX,
                "loop-🎹",
                "note-Ω",
                4_294_967_297,
                3_819_417_621,
                90.0,
                true,
            ),
            (
                0x12345678,
                "clip-shared",
                "event-stable",
                42,
                3_065_371_926,
                70.0,
                false,
            ),
        ];

        for (seed, clip_id, event_id, occurrence, expected_roll, probability, expected_decision) in
            corpus
        {
            let roll = deterministic_probability_roll(
                seed,
                hash_probability_id(clip_id),
                hash_probability_id(event_id),
                occurrence,
            );
            assert_eq!(roll, expected_roll);
            assert_eq!(
                u64::from(roll) < probability_percent_to_cutoff(probability),
                expected_decision
            );
        }
    }

    #[test]
    fn converts_percentages_to_the_shared_fixed_cutoff() {
        let corpus = [
            (0.0, 0),
            (50.0, 2_147_483_648),
            (88.92774630813615, 3_819_417_622),
            (100.0, PROBABILITY_CUTOFF_RANGE),
        ];

        for (probability_percent, expected_cutoff) in corpus {
            assert_eq!(
                probability_percent_to_cutoff(probability_percent),
                expected_cutoff
            );
        }
    }
}

#[cfg(test)]
mod probability_distribution {
    use super::*;

    #[test]
    fn has_exact_edges_and_binomial_balance() {
        let clip_id_hash = hash_probability_id("distribution-clip");
        let event_id_hash = hash_probability_id("distribution-event");
        let sample_count = 10_000_u64;
        let mut accepted_at_half = 0_i64;
        let half_cutoff = probability_percent_to_cutoff(50.0);

        for occurrence in 0..sample_count {
            let roll =
                deterministic_probability_roll(0x5eed1234, clip_id_hash, event_id_hash, occurrence);
            if u64::from(roll) < half_cutoff {
                accepted_at_half += 1;
            }
        }

        let expected = sample_count as i64 / 2;
        let three_sigma = 150_i64;
        assert_eq!(accepted_at_half, 5_009);
        assert!((accepted_at_half - expected).abs() <= three_sigma);

        let target = MidiNoteEvent {
            probability_cutoff: probability_percent_to_cutoff(25.0),
            project_probability_seed: 0x5eed1234,
            clip_id_hash,
            event_id_hash,
            absolute_occurrence_index: 17,
            ..note_on(62)
        };
        let mut isolated = MidiEventBuffer::new();
        assert!(isolated.try_push(target));
        ProbabilityEvaluator::default().process_midi(
            &mut isolated,
            &TransportState::default(),
            48_000.0,
            128,
        );

        let mut interleaved = MidiEventBuffer::new();
        assert!(interleaved.try_push(MidiNoteEvent {
            probability_cutoff: 0,
            ..note_on(60)
        }));
        assert!(interleaved.try_push(target));
        assert!(interleaved.try_push(MidiNoteEvent {
            probability_cutoff: PROBABILITY_CUTOFF_RANGE,
            ..note_on(61)
        }));
        ProbabilityEvaluator::default().process_midi(
            &mut interleaved,
            &TransportState::default(),
            48_000.0,
            128,
        );

        assert!(!interleaved.iter().any(|event| event.note == 60));
        assert!(interleaved.iter().any(|event| event.note == 61));
        assert_eq!(
            isolated.iter().any(|event| event.note == target.note),
            interleaved.iter().any(|event| event.note == target.note),
        );
    }
}
