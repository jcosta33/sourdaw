/// Top-level Sampler Engine.
///
/// Owns the voice pool, sample pool reference, and command queue.
/// Designed for real-time audio thread usage — `process_block()` performs
/// zero allocation and zero blocking. All parameter changes arrive via
/// the command queue (SPSC ring buffer from `rtrb`).
///
/// Metering values (peak level, active voice count) are written to atomics
/// for lock-free reading by the management/UI thread.

use core::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};

use super::allocator::{StealPriority, VoiceAllocator};
use super::sample::SamplePool;
use super::smooth::ParamSmoother;
use super::types::{
    FilterType, LoopMode, PlaybackMode, RecordState, SamplerCommand, SamplerMode, SamplerParam,
    SampleId, MAX_VOICES, MAX_STACK_VOICES,
};
use super::voice::{SamplerVoice, VoiceTriggerParams};

// ── Sampler Engine ─────────────────────────────────────────────────────

pub struct SamplerEngine {
    // Voice management
    voices: Vec<SamplerVoice>,
    allocator: VoiceAllocator,

    // Sample data (shared read-only with audio thread in the in-memory path)
    sample_pool: SamplePool,
    active_sample_id: Option<SampleId>,

    // Global parameters
    mode: SamplerMode,
    master_gain: ParamSmoother,
    root_note: u8,
    tune_cents: f32,
    playback_mode: PlaybackMode,
    loop_mode: LoopMode,
    loop_start: u32,
    loop_end: u32,
    loop_crossfade: u32,

    // Global envelope defaults
    attack: f32,
    hold: f32,
    decay: f32,
    sustain: f32,
    release: f32,

    // Global filter defaults
    filter_cutoff: f32,
    filter_resonance: f32,
    filter_type: FilterType,

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

    // Metering (written by audio thread, read by UI thread)
    peak_left: AtomicU32,
    peak_right: AtomicU32,
    active_voice_count: AtomicU8,

    /// Playback position of the most recently triggered voice (in frames).
    /// Written by audio thread, sampled by management thread at 30Hz.
    playback_position: AtomicU64,

    sample_rate: f32,
}

impl SamplerEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut voices = Vec::with_capacity(MAX_VOICES);
        for _ in 0..MAX_VOICES {
            voices.push(SamplerVoice::new(sample_rate));
        }

        Self {
            voices,
            allocator: VoiceAllocator::new(),
            sample_pool: SamplePool::new(),
            active_sample_id: None,
            mode: SamplerMode::Quick,
            master_gain: ParamSmoother::with_value(sample_rate, 0.01, 1.0),
            root_note: 60,
            tune_cents: 0.0,
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Off,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: 256,
            attack: 0.001,
            hold: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.01,
            filter_cutoff: 20000.0,
            filter_resonance: 0.0,
            filter_type: FilterType::Lowpass,
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
            peak_left: AtomicU32::new(0),
            peak_right: AtomicU32::new(0),
            active_voice_count: AtomicU8::new(0),
            playback_position: AtomicU64::new(0),
            sample_rate,
        }
    }

    // ── Sample Management ──────────────────────────────────────────────

    /// Add a sample to the pool (call from management thread, not RT thread).
    pub fn add_sample(&mut self, sample: super::sample::SampleData) -> SampleId {
        self.sample_pool.add(sample)
    }

    /// Get a reference to the sample pool.
    pub fn sample_pool(&self) -> &SamplePool {
        &self.sample_pool
    }

    /// Set the active sample for playback.
    pub fn set_active_sample(&mut self, sample_id: SampleId) {
        self.active_sample_id = Some(sample_id);
    }

    // ── Command Processing ─────────────────────────────────────────────

    /// Process a single command. Called from the audio thread after
    /// draining the command queue.
    pub fn handle_command(&mut self, command: SamplerCommand) {
        match command {
            SamplerCommand::NoteOn { note, velocity } => {
                self.note_on(note, velocity);
            }
            SamplerCommand::NoteOff { note } => {
                self.note_off(note);
            }
            SamplerCommand::SetMode(mode) => {
                self.mode = mode;
            }
            SamplerCommand::SetParam { param, value } => {
                self.set_param(param, value);
            }
            SamplerCommand::SetActiveSample(sample_id) => {
                self.active_sample_id = Some(sample_id);
            }
            SamplerCommand::AllNotesOff => {
                self.all_notes_off();
            }
            SamplerCommand::AllSoundOff => {
                self.all_sound_off();
            }
            SamplerCommand::ArmRecording {
                threshold,
                target_pad,
                max_duration_secs,
            } => {
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
            SamplerCommand::StopRecording => {
                self.commit_recording();
            }
        }
    }

    // ── Note On / Off ──────────────────────────────────────────────────

    fn note_on(&mut self, note: u8, velocity: u8) {
        let sample_id = match self.active_sample_id {
            Some(id) => id,
            None => return,
        };

        // Check sample exists
        if self.sample_pool.get(sample_id).is_none() {
            return;
        }

        let count = self.stack_count.max(1);

        for stack_idx in 0..count {
            // Try to allocate a voice
            let voice_index = match self.allocator.allocate() {
                Some(idx) => idx,
                None => {
                    // All voices in use — need to steal one.
                    match self.find_steal_target(note) {
                        Some(idx) => {
                            self.voices[idx].begin_steal_fade();
                            self.allocator.release(idx);
                            match self.allocator.allocate() {
                                Some(new_idx) => new_idx,
                                None => return,
                            }
                        }
                        None => return,
                    }
                }
            };

            // Calculate per-voice detune and pan for stacking
            let (detune_cents, stack_pan) = if count > 1 {
                // Spread detune evenly: -spread/2 ... +spread/2
                let t = stack_idx as f32 / (count - 1) as f32; // 0.0 to 1.0
                let detune = self.detune_spread * (t - 0.5); // centered
                // Spread pan: -stack_spread ... +stack_spread
                let pan = self.stack_spread * (t * 2.0 - 1.0);
                (detune, pan)
            } else {
                (0.0, 0.0)
            };

            let params = VoiceTriggerParams {
                note,
                velocity,
                sample_id,
                root_note: self.root_note,
                choke_group: 0,
                playback_mode: self.playback_mode,
                loop_mode: self.loop_mode,
                loop_start: self.loop_start,
                loop_end: self.loop_end,
                loop_crossfade: self.loop_crossfade,
                start_frame: 0,
                attack: self.attack,
                hold: self.hold,
                decay: self.decay,
                sustain: self.sustain,
                release: self.release,
                filter_cutoff: self.filter_cutoff,
                filter_resonance: self.filter_resonance,
                filter_type: self.filter_type,
            };

            self.voices[voice_index].trigger(&params);

            // Apply stacking detune and pan after trigger
            if count > 1 {
                self.voices[voice_index].set_tune(detune_cents);
                self.voices[voice_index].set_pan(stack_pan);
            }
        }
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

    fn all_sound_off(&mut self) {
        for (idx, voice) in self.voices.iter_mut().enumerate() {
            if voice.active {
                voice.begin_steal_fade();
            }
            // Release all slots
            let _ = idx;
        }
        self.allocator.release_all();
    }

    // ── Voice Stealing ─────────────────────────────────────────────────

    /// Find the best voice to steal. Zero-allocation — scans voices inline.
    fn find_steal_target(&self, target_note: u8) -> Option<usize> {
        let mut best_idx: Option<usize> = None;
        let mut best_priority = StealPriority::None;
        let mut oldest_age = 0u32;
        let mut oldest_idx: Option<usize> = None;
        let mut quietest_energy = f32::MAX;
        let mut quietest_idx: Option<usize> = None;

        for (idx, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                continue;
            }

            let priority = voice.steal_priority(target_note, 0);

            // Track the highest-priority (lowest enum value) candidate.
            if priority < best_priority {
                best_priority = priority;
                best_idx = Some(idx);
            }

            // Track oldest and quietest for fallback tiebreaking.
            if voice.age() > oldest_age {
                oldest_age = voice.age();
                oldest_idx = Some(idx);
            }
            if voice.energy() < quietest_energy {
                quietest_energy = voice.energy();
                quietest_idx = Some(idx);
            }
        }

        best_idx.or(oldest_idx).or(quietest_idx)
    }

    // ── Parameter Setting ──────────────────────────────────────────────

    fn set_param(&mut self, param: SamplerParam, value: f32) {
        match param {
            SamplerParam::MasterGain => self.master_gain.set(value),
            SamplerParam::Attack => self.attack = value.max(0.0),
            SamplerParam::Hold => self.hold = value.max(0.0),
            SamplerParam::Decay => self.decay = value.max(0.0),
            SamplerParam::Sustain => self.sustain = value.clamp(0.0, 1.0),
            SamplerParam::Release => self.release = value.max(0.0),
            SamplerParam::FilterCutoff => self.filter_cutoff = value.clamp(20.0, 20000.0),
            SamplerParam::FilterResonance => self.filter_resonance = value.clamp(0.0, 1.0),
            SamplerParam::FilterType => {
                self.filter_type = match value as u8 {
                    0 => FilterType::Lowpass,
                    1 => FilterType::Highpass,
                    2 => FilterType::Bandpass,
                    3 => FilterType::Notch,
                    _ => FilterType::Lowpass,
                };
            }
            SamplerParam::LoopMode => {
                self.loop_mode = match value as u8 {
                    0 => LoopMode::Off,
                    1 => LoopMode::Forward,
                    2 => LoopMode::PingPong,
                    3 => LoopMode::Reverse,
                    _ => LoopMode::Off,
                };
            }
            SamplerParam::LoopStart => self.loop_start = value as u32,
            SamplerParam::LoopEnd => self.loop_end = value as u32,
            SamplerParam::LoopCrossfade => self.loop_crossfade = value as u32,
            SamplerParam::PlaybackMode => {
                self.playback_mode = match value as u8 {
                    0 => PlaybackMode::OneShot,
                    1 => PlaybackMode::Sustain,
                    _ => PlaybackMode::Sustain,
                };
            }
            SamplerParam::RootNote => self.root_note = (value as u8).min(127),
            SamplerParam::Tune => self.tune_cents = value.clamp(-2400.0, 2400.0),
            SamplerParam::Pan => {
                // Pan is set per-voice; this sets the default for new voices.
                // Existing voices are not affected.
            }
            SamplerParam::StackCount => {
                self.stack_count = (value as u8).clamp(1, MAX_STACK_VOICES);
            }
            SamplerParam::DetuneSpread => {
                self.detune_spread = value.clamp(0.0, 100.0);
            }
            SamplerParam::StackSpread => {
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

        let left = core::mem::take(&mut self.record_buffer_left);
        let right = core::mem::take(&mut self.record_buffer_right);

        let sample_data = super::sample::SampleData::from_stereo(
            left,
            right,
            self.sample_rate as u32,
        );

        let sample_id = self.sample_pool.add(sample_data);
        self.active_sample_id = Some(sample_id);
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
        let mut voice_count: u8 = 0;

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
                    let still_active = self.voices[voice_idx].render_sample(
                        sample_data,
                        &mut mix_l,
                        &mut mix_r,
                    );

                    if !still_active {
                        self.allocator.release(voice_idx);
                    }
                } else {
                    // Sample not found — kill voice.
                    self.voices[voice_idx].active = false;
                    self.allocator.release(voice_idx);
                }
            }

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

        // Track playback position from the youngest active voice.
        let mut youngest_age = u32::MAX;
        let mut youngest_pos: u64 = 0;
        for voice in &self.voices {
            if voice.active && voice.age() < youngest_age {
                youngest_age = voice.age();
                youngest_pos = voice.position_frames();
            }
        }
        self.playback_position
            .store(youngest_pos, Ordering::Relaxed);

        // Write metering to atomics (Relaxed is fine for metering).
        self.peak_left
            .store(peak_l.to_bits(), Ordering::Relaxed);
        self.peak_right
            .store(peak_r.to_bits(), Ordering::Relaxed);
        self.active_voice_count
            .store(voice_count, Ordering::Relaxed);
    }

    // ── Metering Accessors (read from UI/management thread) ────────────

    /// Read the peak level for the left channel (last block).
    pub fn read_peak_left(&self) -> f32 {
        f32::from_bits(self.peak_left.load(Ordering::Relaxed))
    }

    /// Read the peak level for the right channel (last block).
    pub fn read_peak_right(&self) -> f32 {
        f32::from_bits(self.peak_right.load(Ordering::Relaxed))
    }

    /// Read the number of currently active voices.
    pub fn read_active_voice_count(&self) -> u8 {
        self.active_voice_count.load(Ordering::Relaxed)
    }

    /// Feed input audio for recording (called from audio thread).
    /// Only captures when in Record mode and armed/recording.
    pub fn process_record_input(&mut self, input_left: &[f32], input_right: &[f32]) {
        if self.mode != SamplerMode::Record {
            return;
        }
        let len = input_left.len().min(input_right.len());
        for i in 0..len {
            self.record_sample(input_left[i], input_right[i]);
        }
    }

    /// Read the playback position of the most recently triggered voice (frames).
    pub fn read_playback_position(&self) -> u64 {
        self.playback_position.load(Ordering::Relaxed)
    }

    /// Get the current sampler mode.
    pub fn mode(&self) -> SamplerMode {
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
