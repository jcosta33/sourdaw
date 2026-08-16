/// Top-level Crumbs Engine.
///
/// Owns the voice pool, sample pool reference, and command queue.
/// Designed for real-time audio thread usage — `process_block()` performs
/// zero allocation and zero blocking. All parameter changes arrive via
/// the command queue (SPSC ring buffer from `rtrb`).
///
/// Metering values (peak level, active voice count) are written to atomics
/// for lock-free reading by the management/UI thread.
use core::sync::atomic::{AtomicU16, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

pub struct CrumbsMetering {
    pub peak_left: AtomicU32,
    pub peak_right: AtomicU32,
    /// Playable voices *plus* outgoing steal fades — see
    /// `CrumbsEngine::read_active_voice_count`. Both pools hold `MAX_VOICES`
    /// slots, so the honest range is 0..=256 and this is a `u16`: as a `u8` a
    /// full pool over a full set of fades reported 255 for a true 256, which is
    /// a silent clamp on the one number the device publishes about whether it
    /// is still making sound.
    pub active_voice_count: AtomicU16,
    pub playback_position: AtomicU64,
}

impl Default for CrumbsMetering {
    fn default() -> Self {
        Self {
            peak_left: AtomicU32::new(0),
            peak_right: AtomicU32::new(0),
            active_voice_count: AtomicU16::new(0),
            playback_position: AtomicU64::new(0),
        }
    }
}

use super::allocator::{StealPriority, VoiceAllocator};
use super::filter::normalized_resonance_from_q;
use super::modes::drum::DrumMode;
use super::modes::quick::QuickMode;
use super::modes::slice::SliceMode;
use super::sample::SamplePool;
use super::smooth::ParamSmoother;
use super::types::{
    CrumbsCommand, CrumbsMode, CrumbsParam, FilterType, LoopMode, PlaybackMode, RecordState,
    SampleId, MAX_STACK_VOICES, MAX_VOICES,
};
use super::voice::{resampling_work_units_for_pitch, CrumbsVoice, VoiceTriggerParams};

// ── Crumbs Engine ─────────────────────────────────────────────────────

/// One 49-tap octave-up voice costs 49 units, so this preserves the full
/// 128-voice pool at ordinary pitch-up while bounding more expensive ratios.
const MAX_RESAMPLING_WORK_UNITS: usize = 49 * MAX_VOICES;

/// A `CrumbsVoice` must own no heap storage, transitively.
///
/// Two audio-thread paths depend on it. `move_voice_to_steal_tail` swaps a
/// whole voice between the playable pool and a fade slot, and `trigger` then
/// configures the freshly pooled voice the swap handed back. Both are plain
/// field writes today; a `Vec`, `Box` or `String` anywhere inside the voice —
/// especially a buffer sized from a parameter, which `trigger` would grow on
/// the audio thread — turns either into an allocation.
///
/// An allocation guard cannot be relied on to catch that: it would only fire if
/// the guard happened to drive the parameter that sizes the buffer away from
/// its default, which is exactly how the same trap stayed hidden in Fermenter's
/// unison oscillator. `needs_drop` is transitive and checked at compile time,
/// so it fails the build the moment such a field is added, whatever any test
/// happens to exercise.
const _: () = assert!(
    !core::mem::needs_drop::<CrumbsVoice>(),
    "CrumbsVoice gained a field with drop glue (Vec/Box/String/...). Voice \
     stealing swaps whole voices on the audio thread and `trigger` reconfigures \
     a pooled one, so owned heap storage there allocates in `process`. Preallocate \
     it to its full range outside the voice, or size it as a fixed-length array."
);

pub struct CrumbsEngine {
    // Voice management
    voices: Vec<CrumbsVoice>,
    allocator: VoiceAllocator,

    /// Preallocated outgoing voices that carry a stolen note through its
    /// de-click fade. A steal swaps the displaced voice in here and starts the
    /// incoming note on the freed playable slot immediately, so no note is
    /// delayed and the outgoing one is never jump-cut.
    ///
    /// One slot per playable voice: a burst of steals can displace the whole
    /// pool before the first fade has finished, and reusing a slot that is
    /// still sounding is the very click this exists to remove. `CrumbsVoice`
    /// owns no heap storage, so the swap is a plain memory move and allocates
    /// nothing — enforced by the `needs_drop` assertion above this struct
    /// rather than assumed.
    ///
    /// A tail is a dying note, so `note_off`, `all_notes_off` and the
    /// choke pass deliberately pass over it: it renders with the settings it
    /// was carrying and is gone within `FADE_STOLEN_SECS`. Releasing or
    /// re-tuning a voice that is already on its way out would only put a
    /// discontinuity back into the fade.
    steal_tails: Vec<CrumbsVoice>,
    /// Dense indices of the fades currently running. Capacity is fixed with the
    /// tail pool, so activating and retiring tails neither scans all 128 idle
    /// slots per sample nor grows storage on the audio thread.
    active_steal_tails: Vec<usize>,

    // Sample data (shared read-only with audio thread in the in-memory path)
    sample_pool: SamplePool,
    active_sample_id: Option<SampleId>,

    // Per-mode note mapping. Each owns the settings its mode is defined by and
    // builds the `VoiceTriggerParams` for a note in that mode, so these are the
    // storage for the voice settings the engine used to duplicate: `quick` and
    // `slice` carry the shared envelope/filter/loop settings `set_param`
    // writes, and `drum` carries them per pad.
    quick: QuickMode,
    drum: DrumMode,
    slice: SliceMode,

    // Global parameters
    mode: CrumbsMode,
    master_gain: ParamSmoother,
    tune_cents: f32,

    // Voice stacking (unison)
    stack_count: u8,
    detune_spread: f32,
    stack_spread: f32,

    // Recording (SP-404 style threshold-triggered capture)
    // Buffers are pre-allocated at engine init to the maximum recording
    // duration. arm_recording() only resets len to 0 — no RT allocation.
    record_state: RecordState,
    record_buffer_left: Vec<f32>,
    record_buffer_right: Vec<f32>,
    record_threshold: f32,
    record_target_pad: u8,
    record_max_samples: usize,
    // Off-thread commit handoff (ledger #568 / audit F4 follow-up). When
    // enabled, commit_recording moves the filled buffers into
    // `pending_commit` in O(1) — no clone, no pool insertion on the audio
    // thread. The host slot forwards them over an SPSC ring to the command
    // side, which clones/builds the SampleData off-thread and mirrors it
    // back through CrumbsCommand::AddSample/SetActiveSample; the emptied
    // buffers are recycled via return_record_buffers.
    commit_handoff: bool,
    pending_commit: Option<(Vec<f32>, Vec<f32>)>,

    // Metering (shared with UI thread)
    metering: Arc<CrumbsMetering>,

    sample_rate: f32,
}

impl CrumbsEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_metering(sample_rate, Arc::new(CrumbsMetering::default()))
    }

    pub fn with_metering(sample_rate: f32, metering: Arc<CrumbsMetering>) -> Self {
        let mut voices = Vec::with_capacity(MAX_VOICES);
        let mut steal_tails = Vec::with_capacity(MAX_VOICES);
        for _ in 0..MAX_VOICES {
            voices.push(CrumbsVoice::new(sample_rate));
            steal_tails.push(CrumbsVoice::new(sample_rate));
        }

        Self {
            voices,
            allocator: VoiceAllocator::new(),
            steal_tails,
            active_steal_tails: Vec::with_capacity(MAX_VOICES),
            sample_pool: SamplePool::new(),
            active_sample_id: None,
            // `QuickMode::default` releases in 50 ms; the engine has always
            // shipped 10 ms, and moving the storage must not move the sound.
            quick: QuickMode {
                release: 0.01,
                ..QuickMode::default()
            },
            drum: DrumMode::new(),
            slice: SliceMode::default(),
            mode: CrumbsMode::Quick,
            master_gain: ParamSmoother::with_value(sample_rate, 0.01, 1.0),
            tune_cents: 0.0,
            stack_count: 1,
            detune_spread: 0.0,
            stack_spread: 0.0,
            record_state: RecordState::Idle,
            record_buffer_left: {
                let max = (60.0 * sample_rate) as usize;
                let mut v = Vec::with_capacity(max);
                v.resize(max, 0.0);
                v.clear();
                v
            },
            record_buffer_right: {
                let max = (60.0 * sample_rate) as usize;
                let mut v = Vec::with_capacity(max);
                v.resize(max, 0.0);
                v.clear();
                v
            },
            record_threshold: 0.01,
            record_target_pad: 0,
            record_max_samples: (60.0 * sample_rate) as usize,
            commit_handoff: false,
            pending_commit: None,
            metering,
            sample_rate,
        }
    }

    // ── Recording commit handoff ───────────────────────────────────────

    /// Enable the off-thread commit handoff. In handoff mode,
    /// commit_recording performs only O(1) pointer moves (no clone, no pool
    /// insertion) and the take is retrieved via take_pending_commit.
    pub fn enable_commit_handoff(&mut self) {
        self.commit_handoff = true;
    }

    /// Retrieve a committed take awaiting off-thread processing. The host
    /// slot drains this after every process call and forwards the buffers
    /// over its SPSC ring. O(1), allocation-free.
    pub fn take_pending_commit(&mut self) -> Option<(Vec<f32>, Vec<f32>)> {
        self.pending_commit.take()
    }

    /// Reinstall an emptied buffer pair returned by the command side after
    /// it cloned the take off-thread. Adopted only when the take buffers
    /// are currently checked out (capacity 0); a spare pair that arrives
    /// while buffers are installed is dropped (off-thread dealloc).
    /// O(1), allocation-free on the audio thread.
    pub fn return_record_buffers(&mut self, left: Vec<f32>, right: Vec<f32>) {
        if self.record_buffer_left.capacity() == 0 {
            self.record_buffer_left = left;
            self.record_buffer_right = right;
        }
    }

    // ── Sample Management ──────────────────────────────────────────────

    /// Add a sample to the pool, allocating its id.
    ///
    /// Decoding the PCM and wrapping it in an `Arc` is the management thread's
    /// work; this only files the pointer. Storing is an in-place write into a
    /// pre-sized slot, so the audio thread reaching this through
    /// `commit_recording` allocates nothing here.
    pub fn add_sample(&mut self, sample: std::sync::Arc<super::sample::SampleData>) -> SampleId {
        self.sample_pool.add(sample)
    }

    /// Set a sample at a specific ID (useful for synced pools across threads).
    ///
    /// This is the audio-thread path: `CrumbsCommand::AddSample` is drained
    /// inside the process callback, so it must not allocate. Pinned by
    /// `crumbs_add_sample_command_does_not_allocate` in
    /// `tests/device_process_rt.rs`.
    pub fn set_sample(&mut self, id: SampleId, sample: std::sync::Arc<super::sample::SampleData>) {
        self.sample_pool.set(id, sample);
    }

    /// Get a reference to the sample pool.
    pub fn sample_pool(&self) -> &SamplePool {
        &self.sample_pool
    }

    /// Mutable access to the Drum-mode pad grid.
    ///
    /// Pad assignment is setup work reached from the integration layer the same
    /// way `set_sample` is, rather than through a `CrumbsCommand` — nothing here
    /// is safe to call from the audio thread.
    pub fn drum_mode_mut(&mut self) -> &mut DrumMode {
        &mut self.drum
    }

    /// Mutable access to the Slice-mode marker map. Setup-time, like
    /// `drum_mode_mut`: `set_markers_from_onsets` allocates.
    pub fn slice_mode_mut(&mut self) -> &mut SliceMode {
        &mut self.slice
    }

    /// Set the active sample for playback.
    pub fn set_active_sample(&mut self, sample_id: SampleId) {
        self.select_sample(sample_id);
    }

    /// The one place the active sample is chosen.
    ///
    /// Every mode needs telling: Quick and Slice build trigger params from the
    /// id they hold, Slice additionally needs the length to divide for its
    /// default chop, and Drum needs the sample its unassigned pads fall back to
    /// so that loading a sample gives a playable kit. A selection that only
    /// wrote `active_sample_id` left all three pointed at the previous one.
    ///
    /// Runs on the audio thread (`CrumbsCommand::SetActiveSample`): a pool
    /// lookup is a `Vec` index and the rest are field writes.
    fn select_sample(&mut self, sample_id: SampleId) {
        self.active_sample_id = Some(sample_id);
        self.quick.sample_id = sample_id;

        let frame_count = match self.sample_pool.get(sample_id) {
            Some(sample) => sample.frame_count() as u32,
            None => 0,
        };
        self.slice.set_sample(sample_id, frame_count);
        self.drum.set_default_sample(sample_id);
    }

    // ── Command Processing ─────────────────────────────────────────────

    /// Process a single command. Called from the audio thread after
    /// draining the command queue.
    pub fn handle_command(&mut self, command: CrumbsCommand) {
        match command {
            CrumbsCommand::NoteOn { note, velocity } => {
                self.note_on(note, velocity);
            }
            CrumbsCommand::NoteOff { note } => {
                self.note_off(note);
            }
            CrumbsCommand::SetMode(mode) => {
                self.mode = mode;
            }
            CrumbsCommand::SetParam { param, value } => {
                self.set_param(param, value);
            }
            CrumbsCommand::AddSample { id, data } => {
                self.set_sample(id, data);
            }
            CrumbsCommand::SetActiveSample(sample_id) => {
                self.select_sample(sample_id);
            }
            CrumbsCommand::AllNotesOff => {
                self.all_notes_off();
            }
            CrumbsCommand::AllSoundOff => {
                self.all_sound_off();
            }
            CrumbsCommand::ArmRecording {
                threshold,
                target_pad,
                max_duration_secs,
            } => {
                // Handoff mode: after a commit the take buffers are checked
                // out (capacity 0) until the command side returns them.
                // Never allocate replacements on the audio thread — refuse
                // to arm instead; the next arm succeeds once the emptied
                // pair has been recycled.
                if self.commit_handoff && self.record_buffer_left.capacity() == 0 {
                    return;
                }
                self.record_threshold = threshold.clamp(0.0, 1.0);
                self.record_target_pad = target_pad;
                let requested = if max_duration_secs > 0.0 {
                    (max_duration_secs * self.sample_rate) as usize
                } else {
                    (60.0 * self.sample_rate) as usize
                };
                // Clamp to pre-allocated capacity — never allocate on RT thread.
                self.record_max_samples = requested.min(self.record_buffer_left.capacity());
                // Reset length without freeing or reallocating.
                self.record_buffer_left.clear();
                self.record_buffer_right.clear();
                self.record_state = RecordState::Armed;
            }
            CrumbsCommand::StopRecording => {
                self.commit_recording();
            }
        }
    }

    // ── Note On / Off ──────────────────────────────────────────────────

    /// Build the trigger parameters this note maps to under the active mode.
    ///
    /// `None` means the note maps to nothing in this mode — an unassigned or
    /// out-of-range pad, or a note with no slice marker behind it — and the
    /// caller must not fall back to a default voice. Playing the active sample
    /// chromatically in that case is what made Drum and Slice aliases of Quick.
    fn mode_trigger_params(&self, note: u8, velocity: u8) -> Option<VoiceTriggerParams> {
        match self.mode {
            CrumbsMode::Drum => self.drum.trigger_params(note, velocity),
            CrumbsMode::Slice => self.slice.trigger_params(note, velocity),
            // Warp and Record have no mapping of their own: Warp's stretching
            // happens downstream of the note, and Record's notes audition the
            // take. Both play the selected sample chromatically, which is
            // exactly Quick.
            CrumbsMode::Quick | CrumbsMode::Warp | CrumbsMode::Record => {
                // Nothing selected means there is no sample for Quick to map
                // the keyboard onto. `select_sample` holds `quick.sample_id`
                // equal to this id, so this only gates.
                self.active_sample_id?;
                Some(self.quick.trigger_params(note, velocity))
            }
        }
    }

    /// MPC choke: a pad that names a choke group silences everything already
    /// sounding in that group. Group 0 means "no group" and cuts nothing.
    ///
    /// Only the de-click fade is started — the allocator slot is freed by
    /// `process_block` once the voice goes inactive. Releasing it here would
    /// let `allocate` hand the same slot straight back and overwrite a voice
    /// mid-fade, which is an audible click rather than a choke.
    fn choke_voices_in_group(&mut self, choke_group: u8) {
        if choke_group == 0 {
            return;
        }
        for voice in &mut self.voices {
            if voice.active && voice.choke_group == choke_group {
                voice.begin_steal_fade();
            }
        }
    }

    fn note_on(&mut self, note: u8, velocity: u8) {
        let params = match self.mode_trigger_params(note, velocity) {
            Some(params) => params,
            None => return,
        };

        // Check the sample this note actually maps to exists. In Drum mode
        // that is the pad's sample, not the engine's selection.
        if self.sample_pool.get(params.sample_id).is_none() {
            return;
        }

        let count = self.stack_count.max(1);
        let mut requested_work = 0_usize;
        for stack_idx in 0..count {
            let detune_cents = if count > 1 {
                let t = stack_idx as f32 / (count - 1) as f32;
                self.detune_spread * (t - 0.5)
            } else {
                0.0
            };
            requested_work = requested_work.saturating_add(resampling_work_units_for_pitch(
                params.note,
                params.root_note,
                self.tune_cents + detune_cents,
            ));
        }
        if self.resampling_work_units().saturating_add(requested_work) > MAX_RESAMPLING_WORK_UNITS {
            return;
        }

        // Reserve the whole stack before choking or triggering anything. Free
        // slots are claimed in the allocator; steal targets remain live but
        // are excluded from later reservations. If the complete stack cannot
        // land, release only the newly claimed free slots and leave every
        // sounding voice untouched.
        let mut claimed = [0_usize; MAX_STACK_VOICES as usize];
        let mut reserved_steals = [false; MAX_STACK_VOICES as usize];
        let mut claimed_len = 0_usize;
        while claimed_len < count as usize {
            let reservation = match self.allocator.allocate() {
                Some(index) => Some((index, false)),
                None => self
                    .find_steal_target(note, params.choke_group, &claimed[..claimed_len])
                    .map(|index| (index, true)),
            };
            let Some((voice_index, will_steal)) = reservation else {
                for reserved_index in 0..claimed_len {
                    if !reserved_steals[reserved_index] {
                        self.allocator.release(claimed[reserved_index]);
                    }
                }
                return;
            };
            claimed[claimed_len] = voice_index;
            reserved_steals[claimed_len] = will_steal;
            claimed_len += 1;
        }

        // Choke once per note after both the work and slot preflights. A
        // rejected note must not silence an existing choke group.
        self.choke_voices_in_group(params.choke_group);

        for stack_idx in 0..count {
            let (detune_cents, stack_pan) = if count > 1 {
                let t = stack_idx as f32 / (count - 1) as f32;
                let detune = self.detune_spread * (t - 0.5);
                let pan = self.stack_spread * (t * 2.0 - 1.0);
                (detune, pan)
            } else {
                (0.0, 0.0)
            };
            let reservation_index = stack_idx as usize;
            let voice_index = claimed[reservation_index];
            if reserved_steals[reservation_index] {
                self.move_voice_to_steal_tail(voice_index);
            }

            self.voices[voice_index].trigger(&params);

            // Pitch lives on the voice, not on the engine: `trigger` derives
            // `speed` from the voice's *own* `tune_cents`, and this loop is the
            // only thing that ever writes that field. So the global Tune has to
            // be pushed down here — and unconditionally.
            //
            // Under the old `if count > 1` guard it never was: `set_param`
            // stored `CrumbsParam::Tune` in `self.tune_cents` and nothing read
            // it back, so at the shipped stack count of 1 the Tune knob was
            // inert at every setting. The same guard left a second hole —
            // `trigger` does not reset the voice's `tune_cents`, so a voice last
            // used by a stacked note carried that note's detune into its next
            // trigger at stack count 1. One unconditional write closes both.
            self.voices[voice_index].set_tune(self.tune_cents + detune_cents);

            // Stack pan stays conditional. Unlike tune there is no engine-wide
            // pan behind it — `CrumbsParam::Pan` is a separate matter — so this
            // is only the spread across a stack and means nothing at count 1.
            if count > 1 {
                self.voices[voice_index].set_pan(stack_pan);
            }
        }
    }

    fn resampling_work_units(&self) -> usize {
        let playable = self
            .voices
            .iter()
            .filter(|voice| voice.active)
            .map(CrumbsVoice::resampling_work_units)
            .sum::<usize>();
        let tails = self
            .active_steal_tails
            .iter()
            .map(|&index| self.steal_tails[index].resampling_work_units())
            .sum::<usize>();
        playable.saturating_add(tails)
    }

    fn note_off(&mut self, note: u8) {
        for (idx, voice) in self.voices.iter_mut().enumerate() {
            if voice.active && voice.note == note {
                voice.release();
                // If the voice becomes inactive after release (e.g., zero release time),
                // free the slot.
                if !voice.active {
                    self.allocator.release(idx);
                }
            }
        }
    }

    fn all_notes_off(&mut self) {
        for voice in &mut self.voices {
            if voice.active {
                voice.release();
            }
        }
    }

    /// Silence everything, on the de-click fade rather than as a jump-cut.
    ///
    /// Every sounding voice moves aside into a fade slot first. Starting the
    /// fade in place and then releasing the allocator was the same
    /// release-then-reallocate defect the steal path carries a fix for: the
    /// next `allocate` handed back a slot whose voice was still fading, and
    /// `trigger` overwrote it in the same sample. One `crumbs_all_sound_off`
    /// followed by a note-on inside the 3 ms fade — an ordinary panic-then-play
    /// — cut a voice at over half its amplitude.
    fn all_sound_off(&mut self) {
        for index in 0..self.voices.len() {
            if self.voices[index].active {
                self.move_voice_to_steal_tail(index);
            }
        }
        self.allocator.release_all();
    }

    // ── Voice Stealing ─────────────────────────────────────────────────

    /// Move the voice at `index` into a fade slot and start its de-click fade,
    /// leaving `self.voices[index]` **silent** and free for the incoming note
    /// on the same sample.
    ///
    /// Silent is part of the contract, not a side effect of the callers: only
    /// `note_on` follows this with a `trigger`, and `all_sound_off` does not
    /// follow it with anything. What comes back into `self.voices[index]` is
    /// whatever occupied the fade slot, so an occupied slot has to be silenced
    /// before the swap or `all_sound_off` would leave a half-faded voice
    /// sounding in a pool slot it has just handed back to the allocator.
    ///
    /// The tails are a pool, not a per-voice pairing: pairing tail `i` with
    /// voice `i` would truncate an unrelated fade whenever the same slot is
    /// stolen twice in quick succession while other tails sit idle.
    fn move_voice_to_steal_tail(&mut self, index: usize) {
        let (tail_index, tail_was_idle) = self.select_steal_tail_slot();
        if !tail_was_idle {
            // Reached when all 128 fades are in flight at once — the whole pool
            // displaced inside one 3 ms fade, or an `all_sound_off` on top of a
            // pool that was already fading. Cutting the quietest of them is the
            // least audible bounded loss available, and it is also what leaves
            // the struct about to be swapped back into the pool silent.
            self.steal_tails[tail_index].kill();
        }
        core::mem::swap(&mut self.voices[index], &mut self.steal_tails[tail_index]);
        self.steal_tails[tail_index].begin_steal_fade();
        if tail_was_idle {
            self.active_steal_tails.push(tail_index);
        }
    }

    /// Pick a fade slot: an idle one if there is one, otherwise the fade that
    /// has decayed furthest. The scan is bounded by the tail pool and allocates
    /// nothing.
    fn select_steal_tail_slot(&self) -> (usize, bool) {
        let mut quietest_index = 0;
        let mut quietest_fade = f32::INFINITY;
        for (index, tail) in self.steal_tails.iter().enumerate() {
            if !tail.active {
                return (index, true);
            }
            if tail.steal_fade() < quietest_fade {
                quietest_fade = tail.steal_fade();
                quietest_index = index;
            }
        }
        (quietest_index, false)
    }

    /// Render one sample of every fade still running and retire the ones that
    /// have reached silence.
    fn render_steal_tails(&mut self, mix_l: &mut f32, mix_r: &mut f32) {
        let mut position = 0;
        while position < self.active_steal_tails.len() {
            let tail_index = self.active_steal_tails[position];
            let sample_id = self.steal_tails[tail_index].sample_id;
            let still_active = match self.sample_pool.get(sample_id) {
                Some(sample_data) => {
                    self.steal_tails[tail_index].render_sample(sample_data, mix_l, mix_r)
                }
                None => {
                    // Sample gone from under a dying note — nothing left to
                    // fade into, so drop it rather than render silence forever.
                    self.steal_tails[tail_index].active = false;
                    false
                }
            };

            if still_active {
                position += 1;
            } else {
                self.active_steal_tails.swap_remove(position);
            }
        }
    }

    /// How many fade slots are still sounding.
    ///
    /// Crumbs has no `ProcessLifecycle`; the metered voice count is the only
    /// thing it publishes about whether it is still making sound, and
    /// `process_block` adds this to the playable count so a caller gating on it
    /// cannot conclude the device fell silent while a steal fade is still
    /// audible.
    pub fn fading_steal_tail_count(&self) -> usize {
        self.active_steal_tails.len()
    }

    /// Find the best voice to steal. Zero-allocation — scans voices inline.
    ///
    /// `target_choke` is the incoming note's choke group. Passing 0 here
    /// unconditionally made `StealPriority::ChokeGroup` unreachable, so a
    /// saturated pool stole by age instead of taking the group that was about
    /// to be cut anyway.
    ///
    /// `claimed` are the slots the current `note_on` has already handed to this
    /// note's stack. They are live but not yet fading, and they play exactly
    /// `target_note`, so without excluding them a stacked note-on steals itself.
    /// At most `MAX_STACK_VOICES` entries — a borrowed stack array, not storage
    /// this function owns.
    fn find_steal_target(
        &self,
        target_note: u8,
        target_choke: u8,
        claimed: &[usize],
    ) -> Option<usize> {
        let mut best_idx: Option<usize> = None;
        let mut best_priority = StealPriority::None;
        let mut quietest_idx: Option<usize> = None;
        let mut quietest_level = f32::INFINITY;
        let mut quietest_age = 0u32;

        for (idx, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                continue;
            }
            // Skip voices already fading out. This has to be here rather than in
            // `steal_priority`: a fading voice still reports whatever tier its
            // note and envelope put it in, and taking its slot back is exactly
            // how a just-choked voice was getting handed straight to the note
            // that choked it.
            //
            // Its slot returns from `process_block` within the 3 ms fade, so
            // passing over it costs at most one block. If every voice is fading,
            // the note is dropped rather than clicked, which is the right trade
            // in a pool that is by then 128 voices deep.
            if voice.is_stealing() {
                continue;
            }
            // Skip slots this same `note_on` already gave to the stack, for the
            // same reason: they are sounding, they are not fading, and taking
            // one back would silence a note the caller asked for.
            if claimed.contains(&idx) {
                continue;
            }

            let priority = voice.steal_priority(target_note, target_choke);

            // The bottom tier is decided across voices, not per voice: every
            // ordinary sustaining note comes back `Oldest`, so the choice among
            // them is made here. Take the quietest, which is what a sampler is
            // expected to do once no retrigger, choke group or releasing note is
            // available — the least audible cut in the pool. Age breaks a tie so
            // a pool of identically-loud voices still gives up its longest-held
            // one rather than the lowest slot index.
            if priority == StealPriority::Oldest {
                let level = voice.audible_level();
                let age = voice.age();
                let quieter = quietest_idx.is_none()
                    || level < quietest_level
                    || (level == quietest_level && age > quietest_age);
                if quieter {
                    quietest_level = level;
                    quietest_age = age;
                    quietest_idx = Some(idx);
                }
                continue;
            }

            // Track the highest-priority (lowest enum value) candidate among the
            // tiers that identify a single voice on their own.
            if priority < best_priority {
                best_priority = priority;
                best_idx = Some(idx);
            }
        }

        best_idx.or(quietest_idx)
    }

    // ── Parameter Setting ──────────────────────────────────────────────

    /// Apply an engine-wide parameter.
    ///
    /// The envelope, filter and loop settings are the *shared* voice settings:
    /// they belong to Quick and to Slice, which are the two modes where one set
    /// of values governs every note. Drum is absent on purpose — a pad carries
    /// its own envelope and filter, and having a global control silently
    /// overwrite 128 pads is not a sampler anyone would ship.
    fn set_param(&mut self, param: CrumbsParam, value: f32) {
        match param {
            CrumbsParam::MasterGain => self.master_gain.set(value),
            CrumbsParam::Attack => {
                let attack = value.max(0.0);
                self.quick.attack = attack;
                self.slice.attack = attack;
            }
            CrumbsParam::Hold => {
                let hold = value.max(0.0);
                self.quick.hold = hold;
                self.slice.hold = hold;
            }
            CrumbsParam::Decay => {
                let decay = value.max(0.0);
                self.quick.decay = decay;
                self.slice.decay = decay;
            }
            CrumbsParam::Sustain => {
                let sustain = value.clamp(0.0, 1.0);
                self.quick.sustain = sustain;
                self.slice.sustain = sustain;
            }
            CrumbsParam::Release => {
                let release = value.max(0.0);
                self.quick.release = release;
                self.slice.release = release;
            }
            CrumbsParam::FilterCutoff => {
                let cutoff = value.clamp(20.0, 20000.0);
                self.quick.filter_cutoff = cutoff;
                self.slice.filter_cutoff = cutoff;
            }
            CrumbsParam::FilterResonance => {
                // Arrives in Q, the unit every surface that writes it carries —
                // the `Reso` knob (0.5–20, shipping at 1), `CrumbsDescriptor`'s
                // automation lane, and Toaster's identical pad field. The mode
                // structs hold the SVF's normalised 0–1 instead, so the two have
                // to be converted between; this used to `clamp(0.0, 1.0)` a Q
                // reading, which pinned every knob position from the default
                // upward — 19 of its 19.5 units — onto identical coefficients and
                // left the shipped default self-oscillating at Q 20.
                let resonance = normalized_resonance_from_q(value);
                self.quick.filter_resonance = resonance;
                self.slice.filter_resonance = resonance;
            }
            CrumbsParam::FilterType => {
                let filter_type = match value as u8 {
                    0 => FilterType::Lowpass,
                    1 => FilterType::Highpass,
                    2 => FilterType::Bandpass,
                    3 => FilterType::Notch,
                    _ => FilterType::Lowpass,
                };
                self.quick.filter_type = filter_type;
                self.slice.filter_type = filter_type;
            }
            CrumbsParam::LoopMode => {
                let loop_mode = match value as u8 {
                    0 => LoopMode::Off,
                    1 => LoopMode::Forward,
                    2 => LoopMode::PingPong,
                    3 => LoopMode::Reverse,
                    _ => LoopMode::Off,
                };
                self.quick.loop_mode = loop_mode;
                self.slice.loop_mode = loop_mode;
            }
            // Loop bounds are Quick-only: a slice's bounds come from its own
            // markers, and a global override would collapse every slice onto
            // the same region.
            CrumbsParam::LoopStart => self.quick.loop_start = value as u32,
            CrumbsParam::LoopEnd => self.quick.loop_end = value as u32,
            CrumbsParam::LoopCrossfade => {
                let crossfade = value as u32;
                self.quick.loop_crossfade = crossfade;
                self.slice.loop_crossfade = crossfade;
            }
            CrumbsParam::PlaybackMode => {
                let playback_mode = match value as u8 {
                    0 => PlaybackMode::OneShot,
                    1 => PlaybackMode::Sustain,
                    _ => PlaybackMode::Sustain,
                };
                self.quick.playback_mode = playback_mode;
                self.slice.playback_mode = playback_mode;
            }
            // Slice mode has no root note — a slice plays at the pitch it was
            // recorded at, whichever key it is mapped to.
            CrumbsParam::RootNote => self.quick.root_note = (value as u8).min(127),
            // The wire value is **semitones**, which is what the Crumbs knob
            // shows ("st", ±24) and the unit Toaster's `tune` already carries
            // through this same parameter pipeline. ±24 st is exactly the
            // ±2400 cents this arm has always bounded; only the conversion is
            // new. Stored in cents because that is what `CrumbsVoice::set_tune`
            // takes and what the field is named for.
            //
            // **This changes what an existing automation lane sounds like.**
            // `tune` has been `automatable: true` since the descriptor was
            // written, so a Tune lane could always be drawn, saved and
            // reloaded — and until this commit it was inaudible in every
            // configuration, because nothing read the field it fed. Any such
            // lane starts sounding now, which is the first time its author
            // hears what they drew. A lane authored against the old ±100
            // "cents" declaration is additionally re-bounded: points past ±24
            // flatten onto the two-octave limit instead of the ±100 the
            // descriptor used to permit. ADR 0016 ruling 3 governs — there are
            // no users, correctness wins outright, and no version-gated branch
            // preserves the silent reading — but the change is real and is
            // stated here rather than discovered.
            CrumbsParam::Tune => {
                if value.is_finite() {
                    self.tune_cents = value.clamp(-24.0, 24.0) * 100.0;
                }
            }
            CrumbsParam::Pan => {
                // Pan is set per-voice; this sets the default for new voices.
                // Existing voices are not affected.
            }
            CrumbsParam::StackCount => {
                self.stack_count = (value as u8).clamp(1, MAX_STACK_VOICES);
            }
            CrumbsParam::DetuneSpread => {
                self.detune_spread = value.clamp(0.0, 100.0);
            }
            CrumbsParam::StackSpread => {
                self.stack_spread = value.clamp(0.0, 1.0);
            }
        }
    }

    // ── Recording ────────────────────────────────────────────────────

    /// Record input samples into the recording buffer.
    /// Called per-sample from process_block when in Record mode.
    fn record_sample(&mut self, left: f32, right: f32) {
        match self.record_state {
            RecordState::Armed => {
                // Check threshold to start recording.
                if left.abs() >= self.record_threshold || right.abs() >= self.record_threshold {
                    self.record_state = RecordState::Recording;
                    self.record_buffer_left.push(left);
                    self.record_buffer_right.push(right);
                }
            }
            RecordState::Recording => {
                if self.record_buffer_left.len() < self.record_max_samples {
                    self.record_buffer_left.push(left);
                    self.record_buffer_right.push(right);
                } else {
                    // Max length reached — auto-commit.
                    self.commit_recording();
                }
            }
            RecordState::Idle => {}
        }
    }

    /// Commit the recording buffer as a new sample in the pool.
    fn commit_recording(&mut self) {
        if self.record_buffer_left.is_empty() {
            self.record_state = RecordState::Idle;
            return;
        }

        if self.commit_handoff {
            // Off-thread commit (ledger #568): move the filled buffers out in
            // O(1) — no clone, no pool insertion, no active-sample write on
            // the audio thread. The host slot forwards the pair over its
            // SPSC ring; the command side clones/builds the SampleData and
            // mirrors it back via AddSample/SetActiveSample, then recycles
            // the emptied buffers through return_record_buffers. Once-per-
            // take semantics and the "is_empty means nothing recorded since
            // the last commit" invariant are preserved: mem::take leaves the
            // buffers empty, exactly like the clear-after-clone below.
            let left = std::mem::take(&mut self.record_buffer_left);
            let right = std::mem::take(&mut self.record_buffer_right);
            self.pending_commit = Some((left, right));
            self.record_state = RecordState::Idle;
            let _ = self.record_target_pad;
            return;
        }

        // Clone, not take: the record buffers are pre-allocated once at
        // construction and must keep their capacity across takes — taking
        // them left capacity 0, so the next arm clamped record_max_samples
        // to 0 and auto-committed a 1-frame sample (audit F1).
        let left = self.record_buffer_left.clone();
        let right = self.record_buffer_right.clone();
        // Clear after cloning (keeps capacity): the is_empty() guard above
        // must mean "nothing recorded since the last commit". Without this,
        // a double StopRecording — or an auto-commit at capacity followed
        // by a user Stop — re-committed the same take as a duplicate pool
        // entry and re-hijacked active_sample_id.
        self.record_buffer_left.clear();
        self.record_buffer_right.clear();

        // RT-ALLOC (audit F4): this clone+insert path allocates and memcpies
        // len frames × 2 channels on the calling thread. It remains the
        // fallback for engines without a commit handoff (unit tests and
        // non-wired hosts); production crumbs instances run with
        // enable_commit_handoff, which never reaches this code.
        let sample_data =
            super::sample::SampleData::from_stereo(left, right, self.sample_rate as u32);

        let sample_id = self.sample_pool.add(std::sync::Arc::new(sample_data));
        self.select_sample(sample_id);
        self.record_state = RecordState::Idle;

        // The target_pad is stored for integration code to pick up,
        // but in-engine we just add to the pool and set as active.
        let _ = self.record_target_pad;
    }

    /// Get the current recording state.
    pub fn record_state(&self) -> RecordState {
        self.record_state
    }

    // ── Audio Processing ───────────────────────────────────────────────

    /// Process a block of audio. This is the main RT entry point.
    ///
    /// `left` and `right` are output buffers that will be filled with
    /// mixed audio from all active voices. Buffers are NOT zeroed first —
    /// the caller must zero them if needed, or this method will add to them.
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let block_size = left.len().min(right.len());
        let mut peak_l: f32 = 0.0;
        let mut peak_r: f32 = 0.0;
        let mut voice_count: u16 = 0;

        for sample_idx in 0..block_size {
            let master = self.master_gain.tick();
            let mut mix_l: f32 = 0.0;
            let mut mix_r: f32 = 0.0;

            for voice_idx in 0..MAX_VOICES {
                if !self.voices[voice_idx].active {
                    continue;
                }

                // Get sample data for this voice
                let sample_id = self.voices[voice_idx].sample_id;
                if let Some(sample_data) = self.sample_pool.get(sample_id) {
                    let still_active =
                        self.voices[voice_idx].render_sample(sample_data, &mut mix_l, &mut mix_r);

                    if !still_active {
                        self.allocator.release(voice_idx);
                    }
                } else {
                    // Sample not found — kill voice.
                    self.voices[voice_idx].active = false;
                    self.allocator.release(voice_idx);
                }
            }

            // Stolen voices are no longer in the playable pool, so the loop
            // above cannot reach them. They are still sounding until their fade
            // runs out, and a fade that is not rendered is a jump-cut.
            self.render_steal_tails(&mut mix_l, &mut mix_r);

            left[sample_idx] += mix_l * master;
            right[sample_idx] += mix_r * master;

            peak_l = peak_l.max(left[sample_idx].abs());
            peak_r = peak_r.max(right[sample_idx].abs());
        }

        // Count active voices (after processing, some may have finished).
        for voice in &self.voices {
            if voice.active {
                voice_count = voice_count.saturating_add(1);
            }
        }
        // A stolen voice fading out in a tail slot is still audible output.
        // Counting only the playable pool would report silence to a caller that
        // gates on this while the fade is still running. The sum can exceed
        // `MAX_VOICES` — an `all_sound_off` moves the whole pool into fades and
        // the notes that follow refill it — so the atomic is a `u16` and the
        // full 0..=256 range is reported rather than clamped.
        for _ in &self.active_steal_tails {
            voice_count = voice_count.saturating_add(1);
        }

        // Track playback position from the youngest active voice.
        let mut youngest_age = u32::MAX;
        let mut youngest_pos: u64 = 0;
        for voice in &self.voices {
            if voice.active && voice.age() < youngest_age {
                youngest_age = voice.age();
                youngest_pos = voice.position_frames();
            }
        }
        self.metering
            .playback_position
            .store(youngest_pos, Ordering::Relaxed);

        // Write metering to atomics (Relaxed is fine for metering).
        self.metering
            .peak_left
            .store(peak_l.to_bits(), Ordering::Relaxed);
        self.metering
            .peak_right
            .store(peak_r.to_bits(), Ordering::Relaxed);
        self.metering
            .active_voice_count
            .store(voice_count, Ordering::Relaxed);
    }

    // ── Metering Accessors (read from UI/management thread) ────────────

    /// Read the peak level for the left channel (last block).
    pub fn read_peak_left(&self) -> f32 {
        f32::from_bits(self.metering.peak_left.load(Ordering::Relaxed))
    }

    /// Read the peak level for the right channel (last block).
    pub fn read_peak_right(&self) -> f32 {
        f32::from_bits(self.metering.peak_right.load(Ordering::Relaxed))
    }

    /// Read the number of voices sounding as of the last rendered block.
    ///
    /// This is **playable voices plus outgoing steal fades**, not pool
    /// occupancy: a stolen note keeps sounding for `FADE_STOLEN_SECS` after it
    /// has left the pool, and this number is the only thing Crumbs publishes
    /// about whether it is still making sound. It therefore ranges over
    /// 0..=2 * `MAX_VOICES` and legitimately exceeds the pool size — a caller
    /// wanting occupancy wants `playable_voice_count`, and a caller gating on
    /// silence wants this.
    pub fn read_active_voice_count(&self) -> u16 {
        self.metering.active_voice_count.load(Ordering::Relaxed)
    }

    /// Playable slots currently sounding, read straight from the pool rather
    /// than from the metering atomic.
    ///
    /// `read_active_voice_count` reports the state of the *last rendered
    /// block*, so it is stale before the first `process_block` and it cannot
    /// separate the playable pool from the outgoing steal fades it also counts.
    /// Both matter when asserting allocation behaviour. Not on any audio-thread
    /// path.
    pub fn playable_voice_count(&self) -> usize {
        self.voices.iter().filter(|voice| voice.active).count()
    }

    /// Whether any live voice is playing `note`.
    ///
    /// Exists so allocation behaviour can be asserted by note identity rather
    /// than by level: a summed pool cannot show whether one particular voice
    /// was overwritten, and a test that measured the sum passed with the bug
    /// reverted. Read-only, and not on any audio-thread path.
    pub fn any_active_voice_has_note(&self, note: u8) -> bool {
        self.voices
            .iter()
            .any(|voice| voice.active && voice.note == note)
    }

    /// How many live voices are playing `note`.
    ///
    /// A stacked note-on puts several voices on one note, so "is the note
    /// there" cannot tell a whole stack from a single survivor. Read-only, and
    /// not on any audio-thread path.
    pub fn active_voices_with_note(&self, note: u8) -> usize {
        self.voices
            .iter()
            .filter(|voice| voice.active && voice.note == note)
            .count()
    }

    /// Feed input audio for recording (called from audio thread).
    /// Only captures when in Record mode and armed/recording.
    pub fn process_record_input(&mut self, input_left: &[f32], input_right: &[f32]) {
        if self.mode != CrumbsMode::Record {
            return;
        }
        let len = input_left.len().min(input_right.len());
        for i in 0..len {
            self.record_sample(input_left[i], input_right[i]);
        }
    }

    /// Read the playback position of the most recently triggered voice (frames).
    pub fn read_playback_position(&self) -> u64 {
        self.metering.playback_position.load(Ordering::Relaxed)
    }

    /// Get the current crumbs mode.
    pub fn mode(&self) -> CrumbsMode {
        self.mode
    }

    /// Get the active sample ID.
    pub fn active_sample_id(&self) -> Option<SampleId> {
        self.active_sample_id
    }

    /// Get the sample rate.
    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Arm, feed `frames` over-threshold samples, stop — one full take.
    fn record_take(engine: &mut CrumbsEngine, frames: usize) {
        engine.handle_command(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        });
        let left = vec![0.5f32; frames];
        let right = vec![0.5f32; frames];
        engine.process_record_input(&left, &right);
        engine.handle_command(CrumbsCommand::StopRecording);
    }

    /// Regression (audit F1): `commit_recording` consumed the record
    /// buffers with `mem::take`, leaving capacity 0. The next arm clamped
    /// `record_max_samples` to 0, so take 2 auto-committed a 1-frame
    /// sample on its second input sample and hijacked `active_sample_id`.
    #[test]
    fn second_take_commits_full_buffer() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        record_take(&mut engine, 1000);
        assert_eq!(engine.record_state(), RecordState::Idle);
        assert_eq!(engine.sample_pool().count(), 1);
        let first_id = engine.active_sample_id().expect("take 1 sets active");
        assert_eq!(
            engine.sample_pool().get(first_id).unwrap().meta.frame_count,
            1000
        );

        record_take(&mut engine, 2000);
        assert_eq!(engine.record_state(), RecordState::Idle);
        assert_eq!(
            engine.sample_pool().count(),
            2,
            "take 2 must add its own pool entry"
        );
        let second_id = engine.active_sample_id().expect("take 2 sets active");
        let second = engine.sample_pool().get(second_id).unwrap();
        assert_eq!(
            second.meta.frame_count, 2000,
            "take 2 committed a {}-frame artifact (capacity was consumed by take 1)",
            second.meta.frame_count
        );
        assert_eq!(second.left.len(), 2000);
        assert_eq!(second.right.len(), 2000);
    }

    /// A third take must keep working too — the record buffers keep their
    /// pre-allocated capacity across any number of commits.
    #[test]
    fn recording_capacity_survives_repeated_takes() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        for take in 1..=3usize {
            record_take(&mut engine, 500 * take);
            let id = engine.active_sample_id().expect("take sets active");
            assert_eq!(
                engine.sample_pool().get(id).unwrap().meta.frame_count as usize,
                500 * take,
                "take {take} frame count"
            );
        }
        assert_eq!(engine.sample_pool().count(), 3);
    }

    #[test]
    fn non_finite_tune_preserves_the_last_finite_engine_value() {
        let mut engine = CrumbsEngine::new(44_100.0);
        engine.set_param(CrumbsParam::Tune, 12.0);

        engine.set_param(CrumbsParam::Tune, f32::NAN);
        engine.set_param(CrumbsParam::Tune, f32::INFINITY);

        assert_eq!(engine.tune_cents, 1_200.0);
    }
}

#[cfg(test)]
mod duplicate_commit_tests {
    use super::*;

    fn arm(engine: &mut CrumbsEngine, max_duration_secs: f32) {
        engine.handle_command(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs,
        });
    }

    fn feed(engine: &mut CrumbsEngine, frames: usize) {
        let left = vec![0.5f32; frames];
        let right = vec![0.5f32; frames];
        engine.process_record_input(&left, &right);
    }

    /// Regression (PR #552 review): cloning at commit left the record
    /// buffers full, and the commit guards only on is_empty() — a second
    /// StopRecording re-committed the same take as a duplicate pool entry
    /// and re-hijacked active_sample_id (measured: pool count 2).
    #[test]
    fn double_stop_does_not_recommit_take() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        arm(&mut engine, 10.0);
        feed(&mut engine, 1000);
        engine.handle_command(CrumbsCommand::StopRecording);
        let first_id = engine.active_sample_id().expect("take 1 sets active");
        assert_eq!(engine.sample_pool().count(), 1);

        // User hits Stop again with no re-arm in between.
        engine.handle_command(CrumbsCommand::StopRecording);

        assert_eq!(
            engine.sample_pool().count(),
            1,
            "double stop duplicated the take"
        );
        assert_eq!(
            engine.active_sample_id(),
            Some(first_id),
            "double stop re-hijacked the active sample"
        );
        assert_eq!(engine.record_state(), RecordState::Idle);
    }

    /// Regression (PR #552 review): same duplicate-commit trigger via the
    /// auto-commit path — recording hits max_duration (auto-commit), then
    /// the StopRecording ending the user gesture must be a no-op.
    #[test]
    fn auto_commit_at_capacity_then_stop_does_not_recommit() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        arm(&mut engine, 0.01); // 441 frames at 44.1 kHz
        feed(&mut engine, 2000);

        // Capacity reached mid-input: auto-committed, back to Idle.
        assert_eq!(engine.record_state(), RecordState::Idle);
        assert_eq!(engine.sample_pool().count(), 1);
        let first_id = engine.active_sample_id().expect("auto-commit sets active");
        assert_eq!(
            engine.sample_pool().get(first_id).unwrap().meta.frame_count,
            441,
            "auto-commit must cap the take at record_max_samples"
        );

        engine.handle_command(CrumbsCommand::StopRecording);

        assert_eq!(
            engine.sample_pool().count(),
            1,
            "stop after auto-commit duplicated the take"
        );
        assert_eq!(engine.active_sample_id(), Some(first_id));
        assert_eq!(engine.record_state(), RecordState::Idle);
    }
}

#[cfg(test)]
mod commit_handoff_tests {
    use super::*;
    use assert_no_alloc::assert_no_alloc;

    fn arm(engine: &mut CrumbsEngine) {
        engine.handle_command(CrumbsCommand::ArmRecording {
            threshold: 0.01,
            target_pad: 0,
            max_duration_secs: 10.0,
        });
    }

    /// The RT commit path in handoff mode: arm, feed, stop, and the O(1)
    /// take retrieval must perform ZERO allocations (the ~21 MB clone moves
    /// to the command side), and the pool/active sample must be untouched
    /// until the command side mirrors the take back.
    #[test]
    fn handoff_commit_does_no_rt_alloc_and_defers_pool_insert() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.enable_commit_handoff();
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        let left = vec![0.5f32; 256];
        let right = vec![0.5f32; 256];
        let mut pending = None;

        assert_no_alloc(|| {
            arm(&mut engine);
            engine.process_record_input(&left, &right);
            engine.handle_command(CrumbsCommand::StopRecording);
            pending = engine.take_pending_commit();
        });

        assert_eq!(engine.record_state(), RecordState::Idle);
        assert_eq!(
            engine.sample_pool().count(),
            0,
            "handoff commit must not insert into the pool on the RT thread"
        );
        assert_eq!(engine.active_sample_id(), None);

        let (take_left, take_right) = pending.expect("take handed off in O(1)");
        assert_eq!(take_left.len(), 256);
        assert_eq!(take_right.len(), 256);
        assert!(take_left.iter().all(|&s| (s - 0.5).abs() < 1.0e-6));
    }

    /// Once-per-take across cycles: the command side returns the emptied
    /// buffers, the next arm adopts them, and repeated takes keep working —
    /// the only way multi-hundred-frame takes fit is if the recycled pair
    /// kept its pre-allocated capacity (no RT re-allocation anywhere).
    #[test]
    fn handoff_repeated_takes_recycle_buffers_and_keep_semantics() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.enable_commit_handoff();
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        let left = vec![0.5f32; 1500];
        let right = vec![0.5f32; 1500];

        for take in 1..=3usize {
            let frames = 500 * take;
            arm(&mut engine);
            assert_eq!(
                engine.record_state(),
                RecordState::Armed,
                "take {take}: arm refused — recycled buffers were not adopted"
            );
            engine.process_record_input(&left[..frames], &right[..frames]);
            engine.handle_command(CrumbsCommand::StopRecording);

            let (mut take_left, mut take_right) = engine
                .take_pending_commit()
                .unwrap_or_else(|| panic!("take {take} handed off"));
            assert_eq!(take_left.len(), frames, "take {take} frame count");

            // Simulate the command side: clone into SampleData (off-RT in
            // production), mirror via commands, recycle the emptied pair.
            let sample = std::sync::Arc::new(super::super::sample::SampleData::from_stereo(
                take_left.clone(),
                take_right.clone(),
                44100,
            ));
            let id = take as u32;
            engine.handle_command(CrumbsCommand::AddSample { id, data: sample });
            engine.handle_command(CrumbsCommand::SetActiveSample(id));
            take_left.clear();
            take_right.clear();
            engine.return_record_buffers(take_left, take_right);

            assert_eq!(engine.sample_pool().count(), take);
            assert_eq!(engine.active_sample_id(), Some(id));
            assert_eq!(
                engine.sample_pool().get(id).unwrap().meta.frame_count as usize,
                frames
            );
        }
    }

    /// Arm between commit and buffer recycle must refuse safely (no RT
    /// allocation, no artifact take) instead of clamping max samples to 0.
    #[test]
    fn handoff_arm_without_recycled_buffers_is_refused_safely() {
        let mut engine = CrumbsEngine::new(44100.0);
        engine.enable_commit_handoff();
        engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Record));

        let left = vec![0.5f32; 256];
        let right = vec![0.5f32; 256];
        arm(&mut engine);
        engine.process_record_input(&left, &right);
        engine.handle_command(CrumbsCommand::StopRecording);
        let _pending = engine.take_pending_commit().expect("first take handed off");

        // Buffers still checked out: arm must no-op.
        arm(&mut engine);
        assert_eq!(
            engine.record_state(),
            RecordState::Idle,
            "arm without take buffers must be refused, not clamped to 0"
        );

        // A stop right after produces nothing (empty-buffer guard).
        engine.handle_command(CrumbsCommand::StopRecording);
        assert!(engine.take_pending_commit().is_none());
        assert_eq!(engine.sample_pool().count(), 0);

        // Once the pair is recycled the next arm works again.
        engine.return_record_buffers(
            Vec::with_capacity((60.0 * 44100.0) as usize),
            Vec::with_capacity((60.0 * 44100.0) as usize),
        );
        arm(&mut engine);
        assert_eq!(engine.record_state(), RecordState::Armed);
    }
}

/// Voice stealing's bottom tier (audit F10).
#[cfg(test)]
mod steal_tier_tests {
    use super::*;

    const LOUD: u8 = 100;
    const QUIET: u8 = 4;
    /// The quiet voice sits well away from slot 0, which is what the previous
    /// index-ordered age scan returned.
    const QUIET_SLOT: usize = 100;
    /// Every pooled note is at or below the sample's root, so each voice costs
    /// the unity resampling budget and all 128 fit. Pitching up would spend the
    /// per-block work budget and `note_on` would start refusing notes, leaving
    /// the pool short of saturation and the steal path unreached.
    const ROOT_NOTE: u8 = 60;

    fn pooled_note(slot: usize) -> u8 {
        ROOT_NOTE - (slot % 24) as u8
    }

    /// A saturated pool of sustaining voices at mixed velocities.
    ///
    /// No note matches the incoming one, no choke group is set, and the block
    /// rendered at the end carries every envelope past its 1 ms attack into
    /// sustain — so `steal_priority` returns plain `Oldest` for all 128 and the
    /// choice is entirely the bottom tier's to make.
    fn saturated_mixed_velocity_engine() -> CrumbsEngine {
        let mut engine = CrumbsEngine::new(48_000.0);
        let pcm: Vec<f32> = (0..4_800)
            .map(|frame| (frame as f32 / 48_000.0 * 220.0 * std::f32::consts::TAU).sin() * 0.8)
            .collect();
        let sample_id = engine.add_sample(std::sync::Arc::new(
            super::super::sample::SampleData::from_mono(pcm, 48_000),
        ));
        engine.set_active_sample(sample_id);
        // Forward looping, so no voice runs off the end of a 100 ms sample and
        // frees its slot before the steal is asked for.
        engine.handle_command(CrumbsCommand::SetParam {
            param: CrumbsParam::LoopMode,
            value: 1.0,
        });

        for slot in 0..MAX_VOICES {
            engine.handle_command(CrumbsCommand::NoteOn {
                note: pooled_note(slot),
                velocity: if slot == QUIET_SLOT { QUIET } else { LOUD },
            });
        }
        assert_eq!(
            engine.playable_voice_count(),
            MAX_VOICES,
            "the pool is not saturated, so a further note would fill rather than steal"
        );

        let mut left = [0.0_f32; 256];
        let mut right = [0.0_f32; 256];
        engine.process_block(&mut left, &mut right);

        engine
    }

    /// With no same-note, choke or releasing candidate available, every voice
    /// reports `StealPriority::Oldest` and this scan decides between them. It
    /// used to return the first voice whose age exceeded the running maximum —
    /// under the equal ages of a pool struck together, slot 0 — so a sampler
    /// holding a sustained chord always cut the voice in the lowest slot,
    /// however loud it still was, while a near-inaudible one sat untouched.
    #[test]
    fn a_saturated_pool_of_sustaining_voices_gives_up_its_quietest() {
        let engine = saturated_mixed_velocity_engine();
        let incoming = ROOT_NOTE + 1;
        assert!(
            (0..MAX_VOICES).all(|slot| pooled_note(slot) != incoming),
            "the incoming note is already sounding, so this would be a same-note steal"
        );

        let target = engine
            .find_steal_target(incoming, 0, &[])
            .expect("a saturated pool of non-fading voices must offer a steal target");

        let stolen_velocity = (engine.voices[target].velocity * 127.0).round() as u8;
        assert_eq!(
            stolen_velocity, QUIET,
            "steal picked slot {target} at velocity {stolen_velocity}, not the pool's quietest \
             voice; the bottom tier is scanning by index or age instead of by level"
        );
        assert!(
            engine.voices[target].audible_level() < engine.voices[0].audible_level(),
            "the chosen voice is not quieter than slot 0, so this test cannot tell the level \
             scan and the index scan apart"
        );
    }

    /// The tiers above the bottom one are untouched: a retrigger of a pitch
    /// already sounding takes that voice, loud as it is against the quietest in
    /// the pool.
    #[test]
    fn a_same_note_retrigger_still_outranks_the_quietest_voice() {
        let engine = saturated_mixed_velocity_engine();
        let retriggered = pooled_note(7);
        assert_ne!(
            retriggered,
            pooled_note(QUIET_SLOT),
            "the retriggered pitch is the quiet voice's own, so the two tiers agree and this \
             test proves nothing"
        );

        let target = engine
            .find_steal_target(retriggered, 0, &[])
            .expect("a saturated pool must offer a steal target");

        assert_eq!(
            engine.voices[target].note, retriggered,
            "a same-note retrigger stole slot {target} (note {}) instead of a voice already \
             sounding that pitch",
            engine.voices[target].note
        );
    }
}
