//! Orchestral Suite — Sourdaw's orchestral sample playback engine.
//!
//! A section + voice engine for cinematic multi-mic sampling, deep articulation
//! scripting (legato, portamento, vibrato), expression mapping (CC1/CC11/velocity),
//! and humanization. Compiles to both native (Rust library) and WASM (AudioWorklet).
//!
//! All DSP is lock-free, allocation-free in the audio hot path.

pub mod types;
pub mod zone;
pub mod voice;
pub mod expression;
pub mod articulation;
pub mod legato;
pub mod humanize;
pub mod mic;
pub mod release;
pub mod performance;
pub mod fallback;
pub mod engine;

use engine::OrchestraEngine;
use wasm_bindgen::prelude::*;

/// WASM-exported Orchestral instance for AudioWorklet.
#[wasm_bindgen]
pub struct OrchestraInstance {
    engine: OrchestraEngine,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
}

#[wasm_bindgen]
impl OrchestraInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, max_voices: u32) -> Self {
        let max_block = 1024; // pre-allocate for max supported block size
        Self {
            engine: OrchestraEngine::new(sample_rate, max_voices as usize),
            left_buf: vec![0.0; max_block],
            right_buf: vec![0.0; max_block],
        }
    }

    /// Set a named parameter value.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    /// Process a MIDI note on event.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.engine.note_on(note, velocity);
    }

    /// Process a MIDI note off event.
    pub fn note_off(&mut self, note: u8) {
        self.engine.note_off(note);
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
        self.engine.add_sample(data, frame_count, channels, sample_rate)
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
        use crate::types::*;
        let lm = match loop_mode {
            1 => LoopMode::Forward,
            2 => LoopMode::PingPong,
            _ => LoopMode::NoLoop,
        };
        let zone = Zone {
            id: zone_id,
            key: KeyRange { lo: lo_key, hi: hi_key },
            vel: VelRange { lo: lo_vel, hi: hi_vel },
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
            amp_env: AdsrParams { attack, decay, sustain, release },
            gain_db,
        };
        self.engine.add_zone(zone);
    }

    /// Build the zone lookup table after all zones and samples are loaded.
    pub fn build_zone_map(&mut self, num_articulations: u32, num_mics: u32) {
        self.engine
            .build_zone_map(num_articulations as usize, num_mics as usize);
    }

    /// Process a block of audio. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = block_size as usize;
        // Clamp to max 1024 to avoid audio-thread allocation.
        let size = size.min(1024);
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        self.engine
            .process_block(&mut self.left_buf[..size], &mut self.right_buf[..size], &[]);

        self.left_buf.as_ptr()
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
