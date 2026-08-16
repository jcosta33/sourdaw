/// Unified Crumbs Suite — core engine module.
///
/// Provides a four-mode crumbs (Quick, Drum, Slice, Warp) with:
///   - Lock-free voice allocation (128 voices, AtomicU64 bitfield)
///   - 6-state AHDSR envelope with configurable curve shape
///   - Windowed-sinc interpolation playback
///   - Cytomic TPT SVF filter with simultaneous multi-output
///   - One-pole parameter smoothing with denormal prevention
///   - In-memory sample pool
///   - Command-queue driven engine with atomic metering
pub mod allocator;
pub mod analysis;
pub mod engine;
pub mod envelope;
pub mod filter;
pub mod modes;
pub mod sample;
pub mod smooth;
pub mod streaming;
pub mod types;
pub mod voice;
pub mod warp;

use std::sync::Arc;

use wasm_bindgen::prelude::*;

use crate::primitives::sanitize_block;

use engine::CrumbsEngine;
use sample::SampleData;
use types::{parse_crumbs_mode, parse_crumbs_param, CrumbsCommand, SampleId};

const MAX_BLOCK_SIZE: usize = 4096;

/// WASM-exported Crumbs instance for AudioWorklet rendering.
///
/// Crumbs' native host reaches `CrumbsEngine` over an SPSC command ring from
/// the Tauri command layer. A worklet has no such ring — messages already
/// arrive one at a time on the port — so this wrapper calls `handle_command`
/// directly, which is the same entry point the native host's drain loop calls.
///
/// ## Disk streaming is deliberately absent
///
/// `crumbs::streaming` schedules reads the native integration layer performs;
/// an `AudioWorkletGlobalScope` has no file or network API at all, so nothing
/// inside a worklet could service those reads. For rendering that costs
/// nothing: an `OfflineAudioContext` has no realtime deadline to stream
/// against, so the correct answer is a preloaded in-memory pool, which is
/// exactly what `add_sample` builds. Sample sets larger than the worklet's heap
/// are the limit of this build, not a bug in it.
#[wasm_bindgen]
pub struct CrumbsInstance {
    engine: CrumbsEngine,
    /// Left channel occupies `[0, MAX_BLOCK_SIZE)`, right the following block.
    output_buf: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl CrumbsInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        Self {
            engine: CrumbsEngine::new(sample_rate),
            output_buf: vec![0.0; 2 * MAX_BLOCK_SIZE],
            nan_flush_count: 0,
        }
    }

    /// Trigger a note. Pitch is derived from the active sample's root note.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.engine
            .handle_command(CrumbsCommand::NoteOn { note, velocity });
    }

    /// Release every voice sounding at `note`.
    pub fn note_off(&mut self, note: u8) {
        self.engine.handle_command(CrumbsCommand::NoteOff { note });
    }

    /// Release all held voices into their amp-envelope release stage.
    pub fn all_notes_off(&mut self) {
        self.engine.handle_command(CrumbsCommand::AllNotesOff);
    }

    /// Cut every voice immediately with a short de-click fade.
    pub fn all_sound_off(&mut self) {
        self.engine.handle_command(CrumbsCommand::AllSoundOff);
    }

    /// Set a global parameter by its `CrumbsDescriptor` id. Unknown ids are
    /// ignored rather than trapping — a project may carry a parameter this
    /// build no longer has.
    pub fn set_param(&mut self, name: &str, value: f32) {
        let Some(param) = parse_crumbs_param(name) else {
            return;
        };
        self.engine
            .handle_command(CrumbsCommand::SetParam { param, value });
    }

    /// Set the operating mode by name (`quick`, `drum`, `slice`, `warp`,
    /// `record`).
    pub fn set_mode(&mut self, mode: &str) {
        let Some(mode) = parse_crumbs_mode(mode) else {
            return;
        };
        self.engine.handle_command(CrumbsCommand::SetMode(mode));
    }

    /// Copy interleaved PCM into the in-memory pool and return its sample id.
    ///
    /// Mirrors `LevainInstance::add_sample`: the caller transfers a
    /// `Float32Array` across the worklet port because a wasm instance cannot
    /// read a file. De-interleaving it into per-channel storage allocates, so
    /// call this during setup, never from `process`. Filing the finished
    /// `Arc` in the pool — which is what `CrumbsCommand::AddSample` does on the
    /// audio thread — allocates nothing.
    pub fn add_sample(&mut self, data: Vec<f32>, channels: u32, sample_rate: u32) -> u32 {
        let sample = SampleData::from_interleaved(&data, sample_rate, channels.max(1));
        self.engine.add_sample(Arc::new(sample))
    }

    /// Select which pooled sample subsequent notes play.
    pub fn set_active_sample(&mut self, sample_id: u32) {
        self.engine
            .handle_command(CrumbsCommand::SetActiveSample(sample_id as SampleId));
    }

    /// Render a block. Returns a pointer to the left channel; the right channel
    /// is at `get_right_ptr()`.
    ///
    /// `CrumbsEngine::process_block` *adds* into its output slices, so the
    /// block is zeroed first — the native host slot does the same. Skipping it
    /// would accumulate the previous block forever.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(MAX_BLOCK_SIZE);
        let (left_buf, right_buf) = self.output_buf.split_at_mut(MAX_BLOCK_SIZE);

        left_buf[..size].fill(0.0);
        right_buf[..size].fill(0.0);

        self.engine
            .process_block(&mut left_buf[..size], &mut right_buf[..size]);

        let mut scrubbed = sanitize_block(&mut left_buf[..size]);
        scrubbed += sanitize_block(&mut right_buf[..size]);
        self.nan_flush_count += scrubbed as u64;

        self.output_buf.as_ptr()
    }

    /// Pointer to the right channel buffer (valid after `process`).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_buf.as_ptr().wrapping_add(MAX_BLOCK_SIZE)
    }

    /// Non-finite output samples scrubbed to silence since construction.
    /// Non-zero means a poisoned block was caught at the wasm boundary.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Voices sounding as of the last rendered block, counting stolen notes
    /// that are still running their de-click fade. Can exceed the 128-slot
    /// pool; see `CrumbsEngine::read_active_voice_count`.
    pub fn active_voices(&self) -> u32 {
        u32::from(self.engine.read_active_voice_count())
    }
}
