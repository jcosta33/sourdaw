//! Top-level orchestral engine.
//!
//! Manages instrument state, voice pool, expression, articulations,
//! legato, mic mixing, and humanization. The section + voice engine
//! processes MIDI events and renders audio blocks.

use crate::articulation::ArticulationState;
use crate::expression::ExpressionState;
use crate::fallback::FallbackToneEngine;
use crate::humanize::Humanizer;
use crate::legato::{LegatoEngine, LegatoResult};
use crate::mic::MicMixer;
use crate::performance::{AutoDivisi, AutoArticulation, EnsembleTiming};
use crate::release::{ReleaseTracker, PedalDeferredRelease};
use crate::types::*;
use crate::voice::VoicePool;
use crate::zone::{SamplePool, ZoneMap};

// ---------------------------------------------------------------------------
// OrchestraEngine
// ---------------------------------------------------------------------------

pub struct OrchestraEngine {
    /// Voice pool for sample playback.
    voice_pool: VoicePool,
    /// Zone map for O(1) sample lookup.
    zone_map: ZoneMap,
    /// Sample pool (in-memory PCM data).
    sample_pool: SamplePool,
    /// Expression state (CC1/CC11/velocity/vibrato).
    expression: ExpressionState,
    /// Articulation state machine.
    articulation: ArticulationState,
    /// Legato engine.
    legato: LegatoEngine,
    /// Mic mixer.
    mic_mixer: MicMixer,
    /// Humanizer.
    humanizer: Humanizer,
    /// Release trigger tracker.
    release_tracker: ReleaseTracker,
    /// Deferred releases during sustain pedal hold.
    pedal_deferred: PedalDeferredRelease,
    /// Auto-divisi for ensemble patches.
    auto_divisi: AutoDivisi,
    /// Auto-articulation selection.
    auto_articulation: AutoArticulation,
    /// Ensemble timing simulation.
    ensemble_timing: EnsembleTiming,
    /// Fallback tone generator (used when no samples are loaded).
    fallback: FallbackToneEngine,

    /// Audio settings.
    sample_rate: f32,

    /// Master gain.
    master_gain: f32,

    /// Number of configured articulations.
    num_articulations: usize,
    /// Number of configured mic positions.
    num_mics: usize,

    /// Scratch buffer for dynamic layer gains.
    layer_gains: [f32; MAX_VEL_LAYERS],
}

impl OrchestraEngine {
    pub fn new(sample_rate: f32, max_voices: usize) -> Self {
        let config = ExpressionConfig::default();

        Self {
            voice_pool: VoicePool::new(max_voices, sample_rate),
            zone_map: ZoneMap::new(),
            sample_pool: SamplePool::new(),
            expression: ExpressionState::new(sample_rate, &config),
            articulation: ArticulationState::new(),
            legato: LegatoEngine::new(sample_rate),
            mic_mixer: MicMixer::new(1), // default single mic
            humanizer: Humanizer::new(HumanizeConfig::default()),
            release_tracker: ReleaseTracker::new(sample_rate),
            pedal_deferred: PedalDeferredRelease::new(),
            auto_divisi: AutoDivisi::new(16),
            auto_articulation: AutoArticulation::new(),
            ensemble_timing: EnsembleTiming::new(42),
            fallback: FallbackToneEngine::new(sample_rate),
            sample_rate,
            master_gain: 0.8,
            num_articulations: 1,
            num_mics: 1,
            layer_gains: [0.0; MAX_VEL_LAYERS],
        }
    }

    // -----------------------------------------------------------------------
    // Sample loading (call from main thread before audio starts)
    // -----------------------------------------------------------------------

    /// Add a sample to the pool. Returns its SampleId.
    pub fn add_sample(
        &mut self,
        data: Vec<f32>,
        frame_count: u32,
        channels: u8,
        sample_rate: f32,
    ) -> SampleId {
        self.sample_pool.add(data, frame_count, channels, sample_rate)
    }

    /// Add a zone to the zone map. Call `build_zone_map()` after all zones are added.
    pub fn add_zone(&mut self, zone: Zone) {
        self.zone_map.add_zone(zone);
    }

    /// Build the zone lookup table. Must be called after all zones and samples are loaded.
    /// Disables the fallback tone since real samples are now available.
    pub fn build_zone_map(&mut self, num_articulations: usize, num_mics: usize) {
        self.num_articulations = num_articulations;
        self.num_mics = num_mics;
        self.zone_map.build_lut(num_articulations, num_mics);
        self.mic_mixer = MicMixer::new(num_mics);
        // Disable fallback — real samples are loaded
        self.fallback.enabled = false;
        self.expression
            .crossfader
            .configure(3, ExpressionConfig::default().cc1_curve);
    }

    // -----------------------------------------------------------------------
    // MIDI event processing
    // -----------------------------------------------------------------------

    pub fn note_on(&mut self, note: u8, velocity: u8) {
        // Check if this is a keyswitch.
        if self.articulation.handle_note_on(note, velocity) {
            return; // consumed as keyswitch
        }

        let art = self.articulation.current;

        // Track for release triggers.
        self.release_tracker.note_on(note);

        // Track for auto-divisi.
        self.auto_divisi.note_on(note);

        // Generate humanization for this note.
        let humanize = self.humanizer.generate();

        // Compute gain from velocity, expression, and divisi.
        let vel_gain = velocity as f32 / 127.0;
        let divisi_gain = self.auto_divisi.divisi_gain();
        let gain = vel_gain * humanize.dynamic_scale * divisi_gain;

        // Determine current dynamic from CC1 for legato transition lookup.
        let cc1_normalized = self.expression.crossfader.current_cc1();
        let current_dynamic = cc1_to_dynamic(cc1_normalized);

        // Look up zone BEFORE allocating a voice (avoid stealing a voice for nothing).
        let candidates_slice = self.zone_map.lookup(art, 0, note, velocity);
        if candidates_slice.is_empty() {
            // No samples loaded — use fallback sine tone so the instrument isn't silent.
            self.fallback.note_on(note, gain);
            return;
        }
        let mut candidates_buf = [0u32; 16];
        let candidate_count = candidates_slice.len().min(16);
        candidates_buf[..candidate_count].copy_from_slice(&candidates_slice[..candidate_count]);
        let candidates = &candidates_buf[..candidate_count];

        let zone_id = match self.zone_map.select_rr(art, note, candidates) {
            Some(id) => id,
            None => return,
        };

        let zone = match self.zone_map.get_zone(zone_id) {
            Some(z) => *z,
            None => return,
        };

        // Now allocate voice and check legato (after confirming we have a zone).
        let voice_idx = self.voice_pool.allocate();
        let legato_result =
            self.legato
                .note_on(note, velocity, voice_idx, current_dynamic);

        match legato_result {
            LegatoResult::Normal => {
                self.voice_pool.voices[voice_idx].trigger(note, velocity, &zone, art, gain, &self.sample_pool);
            }
            LegatoResult::TrueTransition {
                from_voice,
                crossfade_in,
                ..
            } => {
                // Fade out the old voice.
                if from_voice < self.voice_pool.voices.len() {
                    self.voice_pool.voices[from_voice].release();
                }
                // Trigger new voice with the sustain zone, then crossfade.
                // TODO: when transition sample zones are populated, look up the
                // transition zone by sample_id and play that instead of the sustain zone.
                self.voice_pool.voices[voice_idx].trigger(note, velocity, &zone, art, gain, &self.sample_pool);
                self.voice_pool.voices[voice_idx].start_crossfade(
                    &zone,
                    note,
                    crossfade_in,
                    self.sample_rate,
                    &self.sample_pool,
                );
            }
            LegatoResult::SyntheticGlide {
                from_voice,
                glide_time,
                ..
            } => {
                // Reuse the existing voice and crossfade to the new zone.
                if from_voice < self.voice_pool.voices.len()
                    && self.voice_pool.voices[from_voice].active
                {
                    self.voice_pool.voices[from_voice].start_crossfade(
                        &zone,
                        note,
                        glide_time,
                        self.sample_rate,
                        &self.sample_pool,
                    );
                    self.voice_pool.voices[from_voice].note = note;
                } else {
                    self.voice_pool.voices[voice_idx].trigger(note, velocity, &zone, art, gain, &self.sample_pool);
                }
            }
        }
    }

    pub fn note_off(&mut self, note: u8) {
        // Check if this was a keyswitch release.
        if self.articulation.handle_note_off(note) {
            return;
        }

        // Update legato tracking.
        self.legato.note_off(note);

        // Track auto-divisi.
        self.auto_divisi.note_off(note);

        // Check sustain pedal — defer release until pedal is lifted.
        let cc1 = self.expression.crossfader.current_cc1();
        if self.expression.sustain_pedal {
            self.pedal_deferred.defer_note_off(note, cc1);
            return;
        }

        // Fire release trigger if available.
        let (_should_trigger, _release_vol) = self.release_tracker.note_off(note, cc1);
        self.fallback.note_off(note);
        self.voice_pool.release_note(note);
    }

    pub fn handle_cc(&mut self, cc: u8, value: u8) {
        let was_pedal_held = self.expression.sustain_pedal;
        self.expression.handle_cc(cc, value);
        self.articulation.handle_cc(cc, value);

        // Update vibrato from CC2.
        if cc == 2 {
            self.expression.vibrato.set_depth_cc(value);
        }

        // Handle sustain pedal release: fire all deferred note-offs
        // with staggered timing to avoid coordinated stop.
        if cc == 64 && was_pedal_held && !self.expression.sustain_pedal {
            // Collect notes to release (can't borrow self mutably in the closure).
            let mut notes_to_release = [(0u8, 0.0f32); 128];
            let mut release_count = 0usize;
            self.pedal_deferred.release_pedal(self.sample_rate, |note, cc1, _stagger| {
                if release_count < 128 {
                    notes_to_release[release_count] = (note, cc1);
                    release_count += 1;
                }
            });
            for i in 0..release_count {
                let (note, cc1) = notes_to_release[i];
                self.auto_divisi.note_off(note);
                let _ = self.release_tracker.note_off(note, cc1);
                self.voice_pool.release_note(note);
                self.legato.note_off(note);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Parameter setting
    // -----------------------------------------------------------------------

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            "humanize" => self.humanizer.set_amount(value),
            "legato_enabled" => self.legato.enabled = value > 0.5,
            "vibrato_depth" => self.expression.vibrato.set_depth_cc((value * 127.0) as u8),
            "auto_divisi" => self.auto_divisi.enabled = value > 0.5,
            "auto_divisi_size" => self.auto_divisi.section_size = (value as u8).max(1),
            "auto_articulation" => self.auto_articulation.enabled = value > 0.5,
            "ensemble_timing" => self.ensemble_timing.enabled = value > 0.5,
            "attack_spread" => self.ensemble_timing.attack_spread_ms = value,
            "pitch_convergence" => self.ensemble_timing.initial_detune_cents = value,
            n if n.starts_with("mic_") => self.handle_mic_param(n, value),
            _ => {}
        }
    }

    fn handle_mic_param(&mut self, name: &str, value: f32) {
        // Parse "mic_N_param" format without allocating.
        let mut parts = name.splitn(4, '_');
        let _ = parts.next(); // "mic"
        let idx_str = match parts.next() {
            Some(s) => s,
            None => return,
        };
        let param = match parts.next() {
            Some(s) => s,
            None => return,
        };
        let mic_idx: usize = match idx_str.parse() {
            Ok(v) => v,
            Err(_) => return,
        };
        match param {
            "volume" => self.mic_mixer.set_mic_volume(mic_idx, value),
            "pan" => self.mic_mixer.set_mic_pan(mic_idx, value),
            "enabled" => self.mic_mixer.set_mic_enabled(mic_idx, value > 0.5),
            _ => {}
        }
    }

    // -----------------------------------------------------------------------
    // Audio processing
    // -----------------------------------------------------------------------

    /// Process a block of audio. Fills left and right buffers.
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], _midi: &[u8]) {
        let len = left.len().min(right.len());

        // Update counters.
        self.legato.advance(len);
        self.release_tracker.advance(len);

        // Get expression gain for this block.
        let expr_gain = self.expression.expression_gain();

        // Get dynamic layer gains.
        self.expression
            .crossfader
            .get_layer_gains(&mut self.layer_gains);

        for i in 0..len {
            let mut mono_sum = 0.0_f32;

            // Sum all active voices.
            for voice in self.voice_pool.voices.iter_mut() {
                if !voice.active {
                    continue;
                }
                mono_sum += voice.tick(&self.sample_pool);
            }

            // Add fallback tone (active when no samples loaded).
            mono_sum += self.fallback.tick();

            // Apply expression and master gain.
            mono_sum *= expr_gain * self.master_gain;

            // Mix through mic positions (single mic for now).
            let (l, r) = self.mic_mixer.mix_mono(mono_sum);

            left[i] = l;
            right[i] = r;
        }
    }

    /// Get the number of currently active voices.
    pub fn active_voice_count(&self) -> usize {
        self.voice_pool.active_count() + self.fallback.active_count()
    }

}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map CC1 normalized value (0.0-1.0) to a Dynamic enum.
fn cc1_to_dynamic(cc1: f32) -> Dynamic {
    if cc1 < 0.167 {
        Dynamic::PP
    } else if cc1 < 0.333 {
        Dynamic::P
    } else if cc1 < 0.5 {
        Dynamic::MP
    } else if cc1 < 0.667 {
        Dynamic::MF
    } else if cc1 < 0.833 {
        Dynamic::F
    } else {
        Dynamic::FF
    }
}
