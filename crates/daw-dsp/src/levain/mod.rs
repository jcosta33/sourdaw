//! Levain — Sourdaw's levain sample playback engine.
//!
//! A section + voice engine for cinematic multi-mic sampling, deep articulation
//! scripting (legato, portamento, vibrato), expression mapping (CC1/CC11/velocity),
//! and humanization. Compiles to both native (Rust library) and WASM (AudioWorklet).
//!
//! All DSP is lock-free, allocation-free in the audio hot path.

pub mod articulation;
pub mod engine;
pub mod expression;
pub mod fallback;
pub mod humanize;
pub mod legato;
pub mod mic;
pub mod performance;
pub mod realism;
pub mod release;
pub mod types;
pub mod voice;
pub mod zone;

use crate::primitives::sanitize_block;
use engine::LevainEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Levain instance for AudioWorklet.
#[wasm_bindgen]
pub struct LevainInstance {
    engine: LevainEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl LevainInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, max_voices: u32) -> Self {
        let max_block = 4096; // pre-allocate for max supported block size
        Self {
            engine: LevainEngine::new(sample_rate, max_voices as usize),
            left_buf: vec![0.0; max_block],
            right_buf: vec![0.0; max_block],
            nan_flush_count: 0,
        }
    }

    /// Set a named parameter value.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Tell the engine which instrument id is now loaded (e.g. `violin-1`,
    /// `cello`, `trumpet`). The realism layer uses this to pick its body
    /// resonance modes, sympathetic strings, and breath/bow noise colour.
    pub fn set_instrument(&mut self, instrument_id: &str) {
        self.engine.set_instrument(instrument_id);
    }

    /// Process a MIDI note on event.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.engine.note_on(note, velocity);
    }

    /// Process a MIDI note off event.
    pub fn note_off(&mut self, note: u8) {
        self.engine.note_off(note);
    }

    /// Process a MIDI note on carrying its MPE member channel.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        self.engine.note_on_with_channel(note, velocity, channel);
    }

    /// Note-off narrowed to one MPE member channel, so releasing a note on one
    /// member channel cannot silence a different note sounding the same pitch
    /// on another (audit MD-2).
    pub fn note_off_on_channel(&mut self, note: u8, channel: u8) {
        self.engine.note_off_on_channel(note, channel);
    }

    /// Apply MPE per-note expression to the voices held on `channel` at `note`
    /// (audit MD-2).
    ///
    /// `bend_semitones` is the member-channel pitch bend already resolved
    /// against the controller's bend range; `pressure` is 0..1; `slide` is the
    /// CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
    /// on the TypeScript side so the live and scheduled paths share one
    /// conversion.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.engine
            .note_expression(note, channel, bend_semitones, pressure, slide);
    }

    /// Silent all-notes-off. Releases every active voice without firing
    /// per-note realism release transients. Used by the transport on stop
    /// so we don't spawn a 128-note bow-lift noise burst.
    pub fn all_notes_off(&mut self) {
        self.engine.all_notes_off();
    }

    pub fn all_sounds_off(&mut self) {
        self.engine.all_sounds_off();
    }

    /// Process a MIDI CC event.
    pub fn handle_cc(&mut self, cc: u8, value: u8) {
        self.engine.handle_cc(cc, value);
    }

    /// Add a sample to the pool. `data` is interleaved f32 PCM.
    /// Returns the SampleId.
    pub fn add_sample(
        &mut self,
        data: Vec<f32>,
        frame_count: u32,
        channels: u8,
        sample_rate: f32,
    ) -> u32 {
        self.engine
            .add_sample(data, frame_count, channels, sample_rate)
    }

    /// Add a zone to the zone map. Call build_zone_map() after all zones are added.
    #[allow(clippy::too_many_arguments)]
    pub fn add_zone(
        &mut self,
        zone_id: u32,
        sample_id: u32,
        articulation_id: u16,
        root_note: u8,
        lo_key: u8,
        hi_key: u8,
        lo_vel: u8,
        hi_vel: u8,
        rr_pos: u8,
        rr_len: u8,
        mic_id: u8,
        is_release: bool,
        loop_mode: u8,
        loop_start: u32,
        loop_end: u32,
        loop_crossfade: u32,
        gain_db: f32,
        attack: f32,
        decay: f32,
        sustain: f32,
        release: f32,
    ) {
        use self::types::*;
        let lm = match loop_mode {
            1 => LoopMode::Forward,
            2 => LoopMode::PingPong,
            _ => LoopMode::NoLoop,
        };
        let zone = Zone {
            id: zone_id,
            key: KeyRange {
                lo: lo_key,
                hi: hi_key,
            },
            vel: VelRange {
                lo: lo_vel,
                hi: hi_vel,
            },
            articulation: articulation_id,
            rr_pos,
            rr_len,
            mic: mic_id,
            is_release,
            sample: SampleRef {
                sample_id,
                root_key: root_note,
                tune_cents: 0,
                start: 0,
                end: 0, // will use full sample if 0
                loop_mode: lm,
                loop_start,
                loop_end,
                loop_crossfade,
            },
            amp_env: AdsrParams {
                attack,
                decay,
                sustain,
                release,
            },
            gain_db,
        };
        self.engine.add_zone(zone);
    }

    /// Build the zone lookup table after all zones and samples are loaded.
    pub fn build_zone_map(&mut self, num_articulations: u32, num_mics: u32) {
        self.engine
            .build_zone_map(num_articulations as usize, num_mics as usize);
    }

    /// Clear all loaded zones and samples from the engine.
    pub fn clear_zones(&mut self) {
        self.engine.clear_zones();
    }

    /// Process a block of audio. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        // Clamp to max 4096 to avoid audio-thread allocation.
        let size = size.min(4096);
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.engine
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size], &[]);

        self.nan_flush_count += sanitize_block(&mut self.left_buf[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.right_buf[..size]) as u64;

        self.left_buf.as_ptr()
    }

    /// Advance control-rate state while the processor is DSP-owned asleep.
    pub fn advance_silence(&mut self, block_size: u32) {
        self.engine.advance_silent_block(block_size as usize);
    }

    /// Stable numeric lifecycle code consumed by the AudioWorklet host.
    pub fn lifecycle_state(&self) -> u32 {
        self.engine.lifecycle().code()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Get number of currently sounding voices.
    pub fn active_voices(&self) -> u32 {
        self.engine.active_voice_count() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::LevainInstance;
    use crate::primitives::ProcessLifecycle;
    use assert_no_alloc::assert_no_alloc;

    #[test]
    fn lifecycle_sleeps_cold_wakes_for_note_and_preserves_release_tail() {
        let mut instance = LevainInstance::new(48_000.0, 64);
        let sample_id = instance.add_sample(vec![0.25; 48_000], 48_000, 1, 48_000.0);
        instance.add_zone(
            0, sample_id, 0, 76, 0, 127, 0, 127, 0, 1, 0, false, 1, 0, 48_000, 0, 0.0, 0.001,
            0.001, 1.0, 0.02,
        );
        instance.build_zone_map(1, 1);
        instance.set_instrument("violin-1");

        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.note_on(76, 100);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
        instance.process(128);
        instance.note_off(76);

        let mut observed_tail_without_voices = false;
        for _ in 0..20_000 {
            instance.process(128);
            let state = instance.lifecycle_state();
            if instance.active_voices() == 0 && state != ProcessLifecycle::SLEEP_CODE {
                observed_tail_without_voices = true;
            }
            if state == ProcessLifecycle::SLEEP_CODE {
                break;
            }
        }

        assert!(
            observed_tail_without_voices,
            "the realism tail must outlive the last sample/fallback voice"
        );
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        let left_ptr = instance.process(128);
        let right_ptr = instance.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(left_ptr, 128) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, 128) };
        let post_sleep_peak = left
            .iter()
            .chain(right)
            .fold(0.0f32, |peak, sample| peak.max(sample.abs()));
        assert!(
            post_sleep_peak <= 3.162_277_6e-8,
            "post-sleep peak {post_sleep_peak} exceeded the lifecycle quiet threshold"
        );

        instance.note_on(79, 90);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
        let left_ptr = instance.process(128);
        let left = unsafe { std::slice::from_raw_parts(left_ptr, 128) };
        assert!(left.iter().any(|sample| sample.abs() > 1e-5));
    }

    #[test]
    fn silent_advance_keeps_control_time_moving_without_rendering_audio() {
        let mut instance = LevainInstance::new(48_000.0, 64);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        for _ in 0..128 {
            instance.advance_silence(128);
        }

        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
        assert_eq!(instance.active_voices(), 0);
    }

    #[test]
    fn lifecycle_queries_and_silent_advance_do_not_allocate() {
        let mut instance = LevainInstance::new(48_000.0, 64);

        assert_no_alloc(|| {
            assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
            instance.advance_silence(128);
        });
    }

    #[test]
    fn all_sounds_off_hard_stops_bypass_state_and_allows_a_clean_wake() {
        let mut instance = LevainInstance::new(48_000.0, 64);
        instance.clear_zones();
        instance.note_on(60, 100);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);

        assert_no_alloc(|| {
            instance.all_sounds_off();
        });

        assert_eq!(instance.active_voices(), 0);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);
        instance.note_on(67, 90);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
    }
}
