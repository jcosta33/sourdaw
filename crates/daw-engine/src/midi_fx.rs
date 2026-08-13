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

    /// Set a parameter by name and value.
    fn set_param(&mut self, name: &str, value: f32);

    /// Reset internal state (e.g. arpeggiator step counter).
    fn reset(&mut self);
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

    fn set_param(&mut self, name: &str, value: f32) {
        // min/max are independently settable but must stay ordered: `process_midi`
        // calls `i16::clamp(min, max)` every note-on, and that panics on the
        // audio thread the moment min > max. Restoring the invariant here,
        // rather than at the call site, keeps every caller safe by construction.
        match name {
            "min" => {
                self.min = value.clamp(0.0, 127.0) as u8;
                if self.min > self.max {
                    self.max = self.min;
                }
            }
            "max" => {
                self.max = value.clamp(0.0, 127.0) as u8;
                if self.max < self.min {
                    self.min = self.max;
                }
            }
            "scale" => self.scale = value,
            "offset" => self.offset = value as i16,
            _ => {}
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

struct ActiveNoteBuffer {
    notes: [u8; ARPEGGIATOR_ACTIVE_NOTE_CAPACITY],
    len: usize,
}

impl ActiveNoteBuffer {
    fn new() -> Self {
        Self {
            notes: [0; ARPEGGIATOR_ACTIVE_NOTE_CAPACITY],
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
        self.notes[..self.len].contains(note)
    }

    fn get(&self, index: usize) -> Option<u8> {
        if index >= self.len {
            return None;
        }

        Some(self.notes[index])
    }

    fn try_insert_sorted(&mut self, note: u8) -> bool {
        if self.contains(&note) {
            return true;
        }

        if self.len >= ARPEGGIATOR_ACTIVE_NOTE_CAPACITY {
            return false;
        }

        let mut insert_index = 0;
        while insert_index < self.len && self.notes[insert_index] < note {
            insert_index += 1;
        }

        let mut shift_index = self.len;
        while shift_index > insert_index {
            self.notes[shift_index] = self.notes[shift_index - 1];
            shift_index -= 1;
        }

        self.notes[insert_index] = note;
        self.len += 1;
        true
    }

    fn remove(&mut self, note: u8) {
        let mut remove_index = None;

        for index in 0..self.len {
            if self.notes[index] == note {
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

pub struct Arpeggiator {
    pub mode: ArpMode,
    pub rate_beats: f64,
    pub octave_range: u8,
    active_notes: ActiveNoteBuffer,
    current_step: usize,
    last_beat_step: f64,
    step_trigger_count: u64,
}

impl Default for Arpeggiator {
    fn default() -> Self {
        Self {
            mode: ArpMode::Up,
            rate_beats: 0.25, // 1/16th note
            octave_range: 1,
            active_notes: ActiveNoteBuffer::new(),
            current_step: 0,
            last_beat_step: -1.0,
            step_trigger_count: 0,
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
                if !self.active_notes.try_insert_sorted(event.note) {
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
            self.reset();
            return;
        }
        if self.current_step >= self.active_notes.len() {
            self.current_step = self.active_notes.len() - 1;
        }

        // 2. Determine if it's time for a new step
        let beat = transport.song_pos_beats;
        let step_count_exact = beat / self.rate_beats;
        let step_beat = step_count_exact.floor();

        if step_beat > self.last_beat_step {
            self.last_beat_step = step_beat;
            self.step_trigger_count += 1;

            // 3. Select next note based on mode
            if !self.active_notes.is_empty() {
                match self.mode {
                    ArpMode::Up => {
                        self.current_step = (self.current_step + 1) % self.active_notes.len();
                    }
                    ArpMode::Down => {
                        if self.current_step == 0 {
                            self.current_step = self.active_notes.len() - 1;
                        } else {
                            self.current_step -= 1;
                        }
                    }
                    ArpMode::UpDown => {
                        let n = self.active_notes.len();
                        if n > 1 {
                            let total_steps = n * 2 - 2;
                            let i = (self.step_trigger_count as usize) % total_steps;
                            if i < n {
                                self.current_step = i;
                            } else {
                                self.current_step = total_steps - i;
                            }
                        } else {
                            self.current_step = 0;
                        }
                    }
                    ArpMode::Random => {
                        self.current_step =
                            (self.step_trigger_count as usize * 17) % self.active_notes.len();
                    }
                }

                // 4. Emit the note
                if let Some(note) = self.active_notes.get(self.current_step) {
                    let _ = events.try_push(MidiNoteEvent {
                        note,
                        velocity: 100, // Default for now
                        channel: 0,
                        is_note_on: true,
                        probability_cutoff: PROBABILITY_CUTOFF_RANGE,
                        project_probability_seed: 0,
                        clip_id_hash: 0,
                        event_id_hash: 0,
                        absolute_occurrence_index: 0,
                    });
                }
            }
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "rate" => self.rate_beats = value as f64,
            "mode" => {
                self.mode = match value as i32 {
                    0 => ArpMode::Up,
                    1 => ArpMode::Down,
                    2 => ArpMode::UpDown,
                    _ => ArpMode::Random,
                };
            }
            "octaves" => self.octave_range = value as u8,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.current_step = 0;
        self.last_beat_step = -1.0;
        self.step_trigger_count = 0;
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

    fn set_param(&mut self, _name: &str, _value: f32) {}

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
        scaler.set_param("min", 100.0);
        scaler.set_param("max", 50.0);

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
        scaler.set_param("max", 30.0);
        scaler.set_param("min", 90.0);
        assert!(scaler.min <= scaler.max);

        scaler.set_param("min", 10.0);
        scaler.set_param("max", 5.0);
        assert!(scaler.min <= scaler.max);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
