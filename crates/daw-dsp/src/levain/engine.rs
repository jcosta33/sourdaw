//! Top-level levain engine.
//!
//! Manages instrument state, voice pool, expression, articulations,
//! legato, mic mixing, and humanization. The section + voice engine
//! processes MIDI events and renders audio blocks.

use super::articulation::ArticulationState;
use super::expression::ExpressionState;
use super::fallback::FallbackToneEngine;
use super::humanize::Humanizer;
use super::legato::{LegatoEngine, LegatoResult};
use super::mic::MicMixer;
use super::performance::{AutoArticulation, AutoDivisi, EnsembleTiming};
use super::realism::RealismEngine;
use super::release::{PedalDeferredRelease, ReleaseTracker};
use super::types::*;
use super::voice::VoicePool;
use super::zone::{SamplePool, ZoneMap};

// ---------------------------------------------------------------------------
// LevainEngine
// ---------------------------------------------------------------------------

pub struct LevainEngine {
    /// Voice pool for sample playback.
    voice_pool: VoicePool,
    /// Zone map for O(1) sample lookup.
    zone_map: ZoneMap,
    /// Sample pool (in-memory PCM data).
    sample_pool: SamplePool,
    /// Member channel a channel-narrowed note-off is currently running for
    /// (audit MD-2). `note_off` has a long body — keyswitches, release
    /// triggers, pedal deferral — so `note_off_on_channel` sets this for the
    /// duration of one call rather than duplicating that body.
    pending_note_off_channel: Option<u8>,
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
    /// Orchestral realism augmentation layer.
    realism: RealismEngine,

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

impl LevainEngine {
    pub fn new(sample_rate: f32, max_voices: usize) -> Self {
        let config = ExpressionConfig::default();

        Self {
            voice_pool: VoicePool::new(max_voices, sample_rate),
            zone_map: ZoneMap::new(),
            sample_pool: SamplePool::new(),
            pending_note_off_channel: None,
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
            realism: RealismEngine::new(sample_rate),
            sample_rate,
            master_gain: 0.8,
            num_articulations: 1,
            num_mics: 1,
            layer_gains: [0.0; MAX_VEL_LAYERS],
        }
    }

    pub fn clear_zones(&mut self) {
        self.zone_map.clear();
        self.sample_pool.clear();
        for voice in &mut self.voice_pool.voices {
            voice.active = false;
        }
        self.auto_divisi.clear();
        self.fallback.enabled = true;
        self.realism.reset();
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
        self.sample_pool
            .add(data, frame_count, channels, sample_rate)
    }

    /// Add a zone to the zone map. Call `build_zone_map()` after all zones are added.
    pub fn add_zone(&mut self, zone: Zone) {
        self.zone_map.add_zone(zone);
    }

    /// Tell the engine which instrument id (e.g. `violin-1`, `cello`,
    /// `trumpet`) is now loaded. The realism layer uses this to pick its
    /// body modes, sympathetic strings, and breath/bow noise colour.
    pub fn set_instrument(&mut self, instrument_id: &str) {
        self.realism.configure_for(instrument_id);
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
        self.note_on_with_channel(note, velocity, 0);
    }

    /// Note-on carrying the MPE member channel that owns the note.
    /// Channel 0 is the non-MPE default and what `note_on` uses.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        // Check if this is a keyswitch.
        if self.articulation.handle_note_on(note, velocity) {
            return; // consumed as keyswitch
        }

        let art = self.articulation.current;

        // Realism layer transient (bow scrape onset, etc).
        self.realism.note_on(note);

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
        let legato_result = self
            .legato
            .note_on(note, velocity, voice_idx, current_dynamic);

        // Per-voice vibrato init — independent phase + rate scale for
        // ensemble decorrelation (spec §4.2). Captured once so each arm
        // below can apply them after triggering.
        let vibrato_phase = humanize.vibrato_phase;
        let vibrato_rate_scale = humanize.vibrato_rate_scale;

        match legato_result {
            LegatoResult::Normal => {
                let voice = &mut self.voice_pool.voices[voice_idx];
                voice.trigger(note, channel, velocity, &zone, art, gain, &self.sample_pool);
                voice.vibrato_phase = vibrato_phase;
                voice.vibrato_rate_scale = vibrato_rate_scale;
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
                let voice = &mut self.voice_pool.voices[voice_idx];
                voice.trigger(note, channel, velocity, &zone, art, gain, &self.sample_pool);
                voice.vibrato_phase = vibrato_phase;
                voice.vibrato_rate_scale = vibrato_rate_scale;
                voice.start_crossfade(
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
                // The reused voice keeps its existing vibrato state (it's
                // a continuous slur, not a fresh attack).
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
                    // A synthetic glide reuses the sounding voice, so it
                    // must inherit the new note's expression address.
                    self.voice_pool.voices[from_voice].channel = channel;
                    self.voice_pool.voices[from_voice].held = true;
                } else {
                    let voice = &mut self.voice_pool.voices[voice_idx];
                    voice.trigger(note, channel, velocity, &zone, art, gain, &self.sample_pool);
                    voice.vibrato_phase = vibrato_phase;
                    voice.vibrato_rate_scale = vibrato_rate_scale;
                }
            }
        }
    }

    pub fn note_off(&mut self, note: u8) {
        // Check if this was a keyswitch release.
        if self.articulation.handle_note_off(note) {
            return;
        }

        // Realism release transient (bow lift noise burst).
        self.realism.note_off(note);

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
        self.voice_pool.release_note_matching(note, self.pending_note_off_channel);
    }

    /// Note-off narrowed to one MPE member channel, so releasing a note on
    /// one member channel cannot silence a different note sounding the same
    /// pitch on another (audit MD-2).
    pub fn note_off_on_channel(&mut self, note: u8, channel: u8) {
        self.pending_note_off_channel = Some(channel);
        self.note_off(note);
        self.pending_note_off_channel = None;
    }

    /// Silent all-notes-off used by the transport on stop. Releases every
    /// active voice without firing per-note realism release transients —
    /// sending a `note_off` for all 128 MIDI notes to clear state would
    /// otherwise retrigger the bow-lift noise burst 128 times and sum into
    /// an audible "ksshh" on every stop.
    /// Keyswitch articulation selection is intentionally preserved.
    pub fn all_notes_off(&mut self) {
        self.voice_pool.release_all();
        self.fallback.release_all();
        self.legato.all_notes_off();
        self.auto_divisi.clear();
        self.release_tracker.clear_all();
        // Drop any note-offs queued behind a still-held sustain pedal.
        // Their voices are being released above anyway, so firing the
        // callbacks later would be no-ops at best; at worst, stale
        // entries would pile up at MAX_DEFERRED and drop real deferred
        // note-offs on the next pedal-up.
        self.pedal_deferred.clear();
    }

    /// Apply MPE per-note expression to the voices held on `channel` at
    /// `note` (audit MD-2). A divisi or legato-crossfading note can own more
    /// than one voice, so every match is addressed rather than the first.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.voice_pool
            .set_note_expression(note, channel, bend_semitones, pressure, slide);
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
            self.pedal_deferred
                .release_pedal(self.sample_rate, |note, cc1, _stagger| {
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
            // ── Master ───────────────────────────────────────────────
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),

            // ── Humanization ─────────────────────────────────────────
            "humanize" | "humanize_amount" => self.humanizer.set_amount(value),
            "humanize_timing_max_ms" => self.humanizer.config.timing_max = value / 1000.0,
            "humanize_tuning_max_cents" => self.humanizer.config.tuning_max = value,
            "humanize_dynamic_max" => self.humanizer.config.dynamic_max = value.clamp(0.0, 1.0),
            "humanize_vibrato_var_max" => {
                self.humanizer.config.vibrato_var_max = value.clamp(0.0, 1.0)
            }

            // ── Articulation ─────────────────────────────────────────
            "current_articulation" => self.articulation.current = value as u16,

            // ── Legato ───────────────────────────────────────────────
            "legato_enabled" => self.legato.enabled = value > 0.5,
            "legato_adaptive_speed" => {
                // Not a separate flag currently — adaptive speed is always on when enabled
            }
            "legato_slow_threshold_ms" => self.legato.slow_threshold = (value / 1000.0).max(0.05),
            "legato_fast_threshold_ms" => self.legato.fast_threshold = (value / 1000.0).max(0.01),
            "legato_portamento_velocity_threshold" => {
                self.legato.portamento_velocity_threshold = (value as u8).clamp(0, 127)
            }

            // ── Expression / Vibrato ─────────────────────────────────
            "vibrato_depth" => self.expression.vibrato.set_depth_cc((value * 127.0) as u8),
            "expression_vibrato_depth_max" => {
                self.expression.vibrato.config.vibrato_depth_max = value.max(0.0)
            }
            "expression_vibrato_rate_max" => {
                self.expression.vibrato.config.vibrato_rate_max = value.clamp(0.0, 20.0)
            }
            "expression_vibrato_rate_min" => {
                self.expression.vibrato.config.vibrato_rate_min = value.clamp(0.0, 20.0)
            }
            "expression_vibrato_onset_delay" => {
                self.expression.vibrato.onset_delay = value.clamp(0.0, 2.0)
            }
            "expression_dynamic_crossfade_time" => {
                // Reconfigure the crossfader alpha — store crossfade_time and rebuild.
                let num_layers = self.expression.crossfader.num_layers;
                let curve = self.expression.crossfader.curve;
                self.expression.crossfader = super::expression::DynamicCrossfader::new(
                    self.sample_rate,
                    value.clamp(0.001, 2.0),
                );
                self.expression.crossfader.configure(num_layers, curve);
            }

            // ── Performance intelligence ─────────────────────────────
            "auto_divisi" => self.auto_divisi.enabled = value > 0.5,
            "auto_divisi_size" => self.auto_divisi.section_size = (value as u8).max(1),
            "auto_articulation" => self.auto_articulation.enabled = value > 0.5,
            "ensemble_timing" => self.ensemble_timing.enabled = value > 0.5,
            "attack_spread" => self.ensemble_timing.attack_spread_ms = value,
            "pitch_convergence" => self.ensemble_timing.initial_detune_cents = value,

            // ── Tone / Attack / Release (macro-mapped) ───────────────
            // "tone" maps to a simple brightness tilt — no EQ in the engine yet, no-op.
            "tone" => {}
            // "attack" / "release" would override per-zone ADSR but that
            // requires tracking a global override — stub for now.
            "attack" | "release" => {}

            // ── Mic positions ─────────────────────────────────────────
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

        // Push current expression state into the realism layer once per block
        // — bow noise scales with CC1, breath noise with CC11.
        let cc1 = self.expression.crossfader.current_cc1();
        let cc11 = self.expression.cc11 as f32 / 127.0;
        self.realism.update_expression(cc1, cc11);

        // Advance per-voice vibrato by one block. Each voice keeps its own
        // phase and rate-scale (set at trigger time from humanization), so
        // a section sounds like decorrelated players rather than one
        // chorused player (spec §4.2).
        let vibrato_depth = self.expression.vibrato.depth_cents();
        let vibrato_rate = self.expression.vibrato.rate_hz();
        let vibrato_onset = self.expression.vibrato.onset_delay;
        for voice in self.voice_pool.voices.iter_mut() {
            voice.update_vibrato_block(
                vibrato_depth,
                vibrato_rate,
                vibrato_onset,
                self.sample_rate,
                len,
            );
        }

        // Get dynamic layer gains.
        self.expression
            .crossfader
            .get_layer_gains(&mut self.layer_gains);

        // Gate the realism layer's continuous bow/breath noise on whether
        // anything is actually sounding this block. A real instrument makes
        // no noise floor when nobody is playing it. Voices only flip active
        // state at block boundaries (MIDI events are drained at block start
        // and envelope-driven voice deactivations are picked up next
        // block), so block-granularity is sufficient.
        let voices_active =
            self.voice_pool.active_count() > 0 || self.fallback.active_count() > 0;

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

            // Orchestral realism augmentation (body resonance, sympathetic
            // strings, bow/breath noise, frequency-dependent damping).
            mono_sum = self.realism.tick(mono_sum, voices_active);

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

#[cfg(test)]
mod tests {
    use super::LevainEngine;
    use crate::levain::types::{
        AdsrParams, KeyRange, LoopMode, SampleRef, VelRange, Zone,
    };

    const SAMPLE_RATE: f32 = 48_000.0;
    const SAMPLE_FRAMES: u32 = 4_800;
    /// Sawtooth period in frames — 200 Hz at 48 kHz, and an exact divisor of
    /// `SAMPLE_FRAMES` so the loop point is click-free.
    const PERIOD_FRAMES: u32 = 240;

    /// A Levain engine holding one looped 200 Hz sawtooth zone across the whole
    /// keyboard. Real sample playback, so bend/pressure/timbre are measurable
    /// on the rendered output rather than on the fallback tone.
    fn engine_with_sawtooth_zone() -> LevainEngine {
        engine_with_sawtooth_zone_voices(8)
    }

    fn engine_with_sawtooth_zone_voices(max_voices: usize) -> LevainEngine {
        let mut engine = LevainEngine::new(SAMPLE_RATE, max_voices);
        let data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
            .collect();
        let sample_id = engine.add_sample(data, SAMPLE_FRAMES, 1, SAMPLE_RATE);
        engine.add_zone(Zone {
            id: 0,
            key: KeyRange { lo: 0, hi: 127 },
            vel: VelRange { lo: 0, hi: 127 },
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release: false,
            sample: SampleRef {
                sample_id,
                root_key: 60,
                tune_cents: 0,
                start: 0,
                end: SAMPLE_FRAMES,
                loop_mode: LoopMode::Forward,
                loop_start: 0,
                loop_end: SAMPLE_FRAMES,
                loop_crossfade: 0,
            },
            amp_env: AdsrParams {
                attack: 0.001,
                decay: 0.001,
                sustain: 1.0,
                release: 0.2,
            },
            gain_db: 0.0,
        });
        engine.build_zone_map(1, 1);
        engine
    }

    fn render(engine: &mut LevainEngine, blocks: usize) -> Vec<f32> {
        let mut collected = Vec::with_capacity(blocks * 128);
        let mut left = [0.0f32; 128];
        let mut right = [0.0f32; 128];
        for _ in 0..blocks {
            left.fill(0.0);
            right.fill(0.0);
            engine.process_block(&mut left, &mut right, &[]);
            collected.extend_from_slice(&left);
        }
        collected
    }

    fn render_expressive_note(expression: Option<(f32, f32, f32)>) -> Vec<f32> {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on(60, 100);
        if let Some((bend, pressure, slide)) = expression {
            engine.note_expression(60, 0, bend, pressure, slide);
        }
        render(&mut engine, 24)
    }

    fn zero_crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
            .count()
    }

    fn rms(samples: &[f32]) -> f32 {
        let sum: f32 = samples.iter().map(|value| value * value).sum();
        (sum / samples.len() as f32).sqrt()
    }

    fn high_band_rms(samples: &[f32]) -> f32 {
        let differences: Vec<f32> = samples.windows(2).map(|pair| pair[1] - pair[0]).collect();
        rms(&differences)
    }

    // ── MPE per-note expression (audit MD-2) ───────────────────────────────

    #[test]
    fn per_note_pitch_bend_repitches_sample_playback() {
        let plain = render_expressive_note(None);
        let bent = render_expressive_note(Some((12.0, 0.0, 0.0)));

        let ratio = zero_crossings(&bent[1024..]) as f32 / zero_crossings(&plain[1024..]) as f32;
        assert!(
            (1.8..=2.2).contains(&ratio),
            "a +12 st per-note bend must double sample playback rate, got {ratio}x"
        );
    }

    #[test]
    fn per_note_pressure_raises_the_rendered_level() {
        let plain = render_expressive_note(None);
        let pressed = render_expressive_note(Some((0.0, 1.0, 0.0)));

        let ratio = rms(&pressed[2048..]) / rms(&plain[2048..]);
        assert!(
            (1.8..=2.1).contains(&ratio),
            "full pressure must roughly double the voice gain, got {ratio}x"
        );
    }

    #[test]
    fn per_note_slide_tilts_the_voice_spectrum() {
        let neutral = render_expressive_note(None);
        let bright = render_expressive_note(Some((0.0, 0.0, 1.0)));
        let dark = render_expressive_note(Some((0.0, 0.0, -1.0)));

        let neutral_high = high_band_rms(&neutral[1024..]);
        let bright_high = high_band_rms(&bright[1024..]);
        let dark_high = high_band_rms(&dark[1024..]);

        assert!(
            bright_high > neutral_high * 1.2,
            "positive slide must brighten the voice: {neutral_high} -> {bright_high}"
        );
        assert!(
            dark_high < neutral_high * 0.8,
            "negative slide must darken the voice: {neutral_high} -> {dark_high}"
        );
    }

    #[test]
    fn per_note_expression_only_reaches_the_addressed_note() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on(60, 100);
        engine.note_on(67, 100);
        // Address a note that is not sounding — nothing may change.
        engine.note_expression(72, 0, 12.0, 1.0, 1.0);
        let untouched = render(&mut engine, 24);

        let mut reference = engine_with_sawtooth_zone();
        reference.note_on(60, 100);
        reference.note_on(67, 100);
        let baseline = render(&mut reference, 24);

        assert_eq!(
            zero_crossings(&untouched[1024..]),
            zero_crossings(&baseline[1024..]),
            "expression addressed to a silent note must not touch sounding voices"
        );
    }

    // ── Per-note expression targeting (audit MD-2, review round 1) ─────────

    /// Every active voice at `note` as (channel, held, bend semitones).
    fn active_voices_at(engine: &LevainEngine, note: u8) -> Vec<(u8, bool, f32)> {
        engine
            .voice_pool
            .voices
            .iter()
            .filter(|voice| voice.active && voice.note == note)
            .map(|voice| (voice.channel, voice.held, voice.expr_bend_semitones))
            .collect()
    }

    #[test]
    fn expression_skips_a_still_ringing_voice_at_the_same_pitch() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on(60, 100);
        engine.note_off(60);
        engine.note_on(60, 100);

        let before = active_voices_at(&engine, 60);
        assert_eq!(before.len(), 2, "the release tail and the retrigger must both be active");
        assert_eq!((before[0].1, before[1].1), (false, true));

        engine.note_expression(60, 0, 12.0, 0.0, 0.0);

        assert_eq!(
            active_voices_at(&engine, 60),
            vec![(0, false, 0.0), (0, true, 12.0)],
            "only the held voice may take the bend; the ringing tail keeps its pitch"
        );
    }

    #[test]
    fn expression_addressed_to_another_member_channel_is_ignored() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on_with_channel(60, 100, 2);

        // Same pitch, wrong member channel — a note this voice does not own.
        engine.note_expression(60, 3, 12.0, 1.0, 1.0);

        assert_eq!(
            active_voices_at(&engine, 60),
            vec![(2, true, 0.0)],
            "a voice must only take expression addressed to its own channel"
        );

        engine.note_expression(60, 2, 12.0, 0.0, 0.0);
        assert_eq!(active_voices_at(&engine, 60), vec![(2, true, 12.0)]);
    }

    /// Levain collapses a second note-on at a pitch it is already sounding into
    /// a legato transition, so unlike Fermenter it never holds two voices at one
    /// pitch from two member channels — the surviving voice carries the newer
    /// channel. Recorded because it is the reason the cross-channel coexistence
    /// case is untestable here, not because it is desirable.
    #[test]
    fn a_same_pitch_note_on_hands_the_voice_to_the_new_member_channel() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on_with_channel(60, 100, 2);
        engine.note_on_with_channel(60, 100, 3);

        let voices = active_voices_at(&engine, 60);
        assert_eq!(voices.len(), 1, "legato collapses the pair into one voice");
        assert_eq!(voices[0].0, 3, "the surviving voice carries the newer channel");

        engine.note_expression(60, 3, 12.0, 0.0, 0.0);
        assert_eq!(active_voices_at(&engine, 60), vec![(3, true, 12.0)]);
    }

    #[test]
    fn note_off_can_be_narrowed_to_one_member_channel() {
        let mut engine = engine_with_sawtooth_zone();
        // A retrigger over a ringing tail is how Levain ends up with two voices
        // at one pitch; give them distinct channels to narrow against.
        engine.note_on_with_channel(60, 100, 2);
        engine.note_off_on_channel(60, 2);
        engine.note_on_with_channel(60, 100, 3);

        engine.note_off_on_channel(60, 3);

        let held: Vec<(u8, bool)> = active_voices_at(&engine, 60)
            .into_iter()
            .map(|(channel, held, _)| (channel, held))
            .collect();
        assert_eq!(held, vec![(2, false), (3, false)]);
    }

    #[test]
    fn channel_agnostic_note_off_still_releases_every_voice_at_the_pitch() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on_with_channel(60, 100, 2);
        engine.note_off(60);
        engine.note_on_with_channel(60, 100, 3);

        // Channel-unaware callers (scheduled playback, panic) must not be able
        // to leave a voice hanging.
        engine.note_off(60);

        let held: Vec<bool> = active_voices_at(&engine, 60)
            .into_iter()
            .map(|(_, held, _)| held)
            .collect();
        assert_eq!(held, vec![false, false]);
    }

    #[test]
    fn a_recycled_voice_starts_from_neutral_expression() {
        // One voice only, so the second note-on is guaranteed to steal and
        // re-trigger the very voice that carried the expression.
        let mut engine = engine_with_sawtooth_zone_voices(1);
        engine.note_on(60, 100);
        engine.note_expression(60, 0, 12.0, 1.0, 1.0);
        engine.note_off(60);
        engine.note_on(60, 100);
        let recycled = render(&mut engine, 24);

        let mut reference = engine_with_sawtooth_zone_voices(1);
        reference.note_on(60, 100);
        let baseline = render(&mut reference, 24);

        assert_eq!(
            zero_crossings(&recycled[2048..]),
            zero_crossings(&baseline[2048..]),
            "a stolen voice must not inherit the previous note's bend"
        );
        let ratio = rms(&recycled[2048..]) / rms(&baseline[2048..]);
        assert!(
            (0.95..=1.05).contains(&ratio),
            "a stolen voice must not inherit the previous note's pressure, got {ratio}x"
        );
    }

    /// `fallback.rs` opens with: "produces a simple sine wave when no samples
    /// are loaded. This ensures the instrument always makes sound in response
    /// to MIDI, even before sample content is available."
    ///
    /// This test holds that sentence to its word on the one state it names —
    /// an engine with no sample content — and it is deliberately written
    /// against a *bare* engine. It does not call `clear_zones()`. Waking the
    /// fallback with `clear_zones()` is the reflex that makes a Levain harness
    /// go green while leaving a default-constructed engine mute, and it is how
    /// this stayed invisible: every existing path happens to clear zones before
    /// playing, so nothing ever observed the constructed state.
    #[test]
    fn a_freshly_constructed_engine_sounds_without_being_cleared_first() {
        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
        engine.note_on(60, 100);
        let rendered = render(&mut engine, 24);

        let level = rms(&rendered);
        assert!(
            level > 1.0e-3,
            "a Levain engine that has never begun a sample load rendered RMS \
             {level:e} for a held note — silence. The fallback tone exists to \
             cover exactly this state and its own module header promises the \
             instrument 'always makes sound in response to MIDI'."
        );
    }

    /// The other half of the contract, so the fix above cannot be "leave the
    /// sine on forever". Once real zones exist the sampler must own the output
    /// and the fallback must be out of the path.
    #[test]
    fn loading_real_zones_takes_the_fallback_tone_back_out_of_the_path() {
        let mut engine = engine_with_sawtooth_zone();
        engine.note_on(60, 100);
        let rendered = render(&mut engine, 24);

        assert!(
            rms(&rendered) > 1.0e-3,
            "the sampler voice must sound once a zone is loaded"
        );
        // Both candidate sources are periodic, so the zero-crossing rate names
        // which one is sounding: the loaded zone is a 200 Hz sawtooth, while
        // the fallback would sing MIDI 60 at ~261.6 Hz. Neither pitch is close
        // to the other's tolerance, so this distinguishes them outright.
        let duration_seconds = 24.0 * 128.0 / SAMPLE_RATE;
        let implied_hz = zero_crossings(&rendered) as f32 / 2.0 / duration_seconds;
        assert!(
            (180.0..=225.0).contains(&implied_hz),
            "the rendered pitch is {implied_hz:.1} Hz. The loaded sawtooth zone \
             is 200 Hz and the fallback sine at MIDI 60 is 261.6 Hz, so this \
             output is not the sampler voice the zone map should have selected."
        );
    }
}
