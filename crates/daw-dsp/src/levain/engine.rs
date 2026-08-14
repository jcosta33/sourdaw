//! Top-level levain engine.
//!
//! Manages instrument state, voice pool, expression, articulations,
//! legato, mic mixing, and humanization. The section + voice engine
//! processes MIDI events and renders audio blocks.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Weak};

use super::articulation::ArticulationState;
use super::expression::ExpressionState;
use super::fallback::FallbackToneEngine;
use super::humanize::Humanizer;
use super::legato::{LegatoEngine, LegatoResult, LegatoTransitionStore};
use super::mic::MicMixer;
use super::performance::{AutoArticulation, AutoDivisi, EnsembleTiming};
use super::realism::RealismEngine;
use super::release::{PedalDeferredRelease, ReleaseTracker};
use super::tone::ToneTilt;
use super::types::*;
use super::voice::VoicePool;
use super::zone::{SamplePool, ZoneMap, ZoneMapBuildError};

thread_local! {
    static SHARED_SAMPLE_BANKS: RefCell<HashMap<String, Weak<SamplePool>>> =
        RefCell::new(HashMap::new());
}

/// Maximum staggered pedal releases in flight at once (matches
/// `PedalDeferredRelease`'s own `MAX_DEFERRED`).
const MAX_STAGGERED_RELEASES: usize = 128;

struct PendingSampleBank {
    zone_map: ZoneMap,
    sample_pool: Arc<SamplePool>,
    instrument_id: String,
    num_articulations: usize,
    num_mics: usize,
    built: bool,
    /// Legato transition samples staged alongside the zone map so a bank
    /// reload can't have transitions from the new bank pointing at zones (or
    /// sample ids) still belonging to the sounding one.
    legato_transitions: Vec<LegatoTransition>,
}

impl PendingSampleBank {
    fn new(instrument_id: &str) -> Self {
        Self {
            zone_map: ZoneMap::new(),
            sample_pool: Arc::new(SamplePool::new()),
            instrument_id: instrument_id.to_owned(),
            num_articulations: 0,
            num_mics: 0,
            built: false,
            legato_transitions: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// LevainEngine
// ---------------------------------------------------------------------------

pub struct LevainEngine {
    /// Voice pool for sample playback.
    voice_pool: VoicePool,
    /// Zone map for O(1) sample lookup.
    zone_map: ZoneMap,
    /// Sample pool (in-memory PCM data).
    sample_pool: Arc<SamplePool>,
    pending_sample_bank: Option<PendingSampleBank>,
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
    /// Tone macro — a brightness tilt over the whole instrument output.
    tone: ToneTilt,
    /// Attack/Release macro scaling applied over each zone's own ADSR.
    envelope_scaling: EnvelopeScaling,
    /// Modelled-release scaling for the loaded instrument's family, held apart
    /// from `envelope_scaling` so the Release macro and the family model
    /// compose instead of overwriting one another
    /// (`InstrumentFamily::release_scale`).
    family_release_scale: f32,

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

    /// Pedal-release note-offs waiting for their staggered delay to elapse:
    /// (note, cc1_at_noteoff, remaining_samples). Fixed-size so staggering
    /// costs no audio-thread allocation.
    pending_staggered_releases: [(u8, f32, u32); MAX_STAGGERED_RELEASES],
    pending_staggered_count: usize,
}

impl LevainEngine {
    pub fn new(sample_rate: f32, max_voices: usize) -> Self {
        let config = ExpressionConfig::default();

        Self {
            voice_pool: VoicePool::new(max_voices, sample_rate),
            zone_map: ZoneMap::new(),
            sample_pool: Arc::new(SamplePool::new()),
            pending_sample_bank: None,
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
            tone: ToneTilt::new(sample_rate),
            envelope_scaling: EnvelopeScaling::IDENTITY,
            family_release_scale: 1.0,
            sample_rate,
            master_gain: 0.8,
            num_articulations: 1,
            num_mics: 1,
            layer_gains: [0.0; MAX_VEL_LAYERS],
            pending_staggered_releases: [(0, 0.0, 0); MAX_STAGGERED_RELEASES],
            pending_staggered_count: 0,
        }
    }

    pub fn clear_zones(&mut self) {
        self.pending_sample_bank = None;
        self.zone_map.clear();
        self.sample_pool = Arc::new(SamplePool::new());
        for voice in &mut self.voice_pool.voices {
            voice.active = false;
        }
        self.auto_divisi.clear();
        self.fallback.enabled = true;
        self.realism.reset();
        // Legato transitions reference sample ids from the bank being
        // cleared; carrying them into whatever loads next would let a
        // transition resolve to the wrong (or now-invalid) sample.
        self.legato.transitions = LegatoTransitionStore::new();
        self.pending_staggered_count = 0;
    }

    // -----------------------------------------------------------------------
    // Sample loading (call from main thread before audio starts)
    // -----------------------------------------------------------------------

    /// Add a sample to the uniquely-owned loading bank. Returns `None` once
    /// the bank is shared or its identifiers/byte count exceed the ABI.
    pub fn add_sample(
        &mut self,
        data: Vec<f32>,
        frame_count: u32,
        channels: u8,
        sample_rate: f32,
    ) -> Option<SampleId> {
        let sample_pool = match self.pending_sample_bank.as_mut() {
            Some(pending) => &mut pending.sample_pool,
            None => &mut self.sample_pool,
        };
        Arc::get_mut(sample_pool)?.add(data, frame_count, channels, sample_rate)
    }

    pub fn begin_sample_bank(&mut self, instrument_id: &str) {
        self.pending_sample_bank = Some(PendingSampleBank::new(instrument_id));
    }

    pub fn abort_sample_bank(&mut self) {
        self.pending_sample_bank = None;
    }

    /// Attach immutable PCM already published by another instance in this
    /// rendering thread. Zones, voices, parameters, and realism stay local.
    pub fn attach_sample_bank(&mut self, bank_key: &str) -> bool {
        let shared = SHARED_SAMPLE_BANKS.with(|banks| {
            let mut banks = banks.borrow_mut();
            banks.retain(|_, bank| bank.strong_count() > 0);
            let shared = banks.get(bank_key).and_then(Weak::upgrade);
            shared
        });
        let Some(shared) = shared else {
            return false;
        };
        let Some(pending) = self.pending_sample_bank.as_mut() else {
            return false;
        };
        pending.sample_pool = shared;
        true
    }

    /// Publish this instance's complete immutable PCM pool under `bank_key`.
    /// The registry stores a weak reference so it never owns bank lifetime.
    pub fn publish_sample_bank(&self, bank_key: &str) -> bool {
        let sample_pool = self
            .pending_sample_bank
            .as_ref()
            .map_or(&self.sample_pool, |pending| &pending.sample_pool);
        if bank_key.is_empty() || sample_pool.len() == 0 {
            return false;
        }
        SHARED_SAMPLE_BANKS.with(|banks| {
            let mut banks = banks.borrow_mut();
            banks.retain(|_, bank| bank.strong_count() > 0);
            if let Some(existing) = banks.get(bank_key).and_then(Weak::upgrade) {
                return Arc::ptr_eq(&existing, sample_pool);
            }
            banks.insert(bank_key.to_owned(), Arc::downgrade(sample_pool));
            true
        })
    }

    pub fn commit_sample_bank(&mut self) -> bool {
        let Some(pending) = self.pending_sample_bank.take() else {
            return false;
        };
        if !pending.built || pending.sample_pool.len() == 0 {
            self.pending_sample_bank = Some(pending);
            return false;
        }

        for voice in &mut self.voice_pool.voices {
            voice.active = false;
        }
        self.auto_divisi.clear();
        self.zone_map = pending.zone_map;
        self.sample_pool = pending.sample_pool;
        self.num_articulations = pending.num_articulations;
        self.num_mics = pending.num_mics;
        self.mic_mixer = MicMixer::new(pending.num_mics);
        self.apply_instrument(&pending.instrument_id);
        self.fallback.enabled = false;
        self.expression
            .crossfader
            .configure(3, ExpressionConfig::default().cc1_curve);
        self.legato.transitions = LegatoTransitionStore::new();
        for transition in pending.legato_transitions {
            self.legato.transitions.add(transition);
        }
        true
    }

    pub fn sample_bank_bytes(&self) -> usize {
        self.sample_pool.decoded_bytes()
    }

    /// Add a zone to the zone map. Call `build_zone_map()` after all zones are added.
    pub fn add_zone(&mut self, zone: Zone) {
        if let Some(pending) = self.pending_sample_bank.as_mut() {
            pending.zone_map.add_zone(zone);
            return;
        }
        self.zone_map.add_zone(zone);
    }

    /// Register a legato transition sample so `note_on`'s true-legato lookup
    /// (audit F7) can find it by `(interval, dynamic, transition_type)`.
    /// Staged alongside a pending bank the same way `add_zone` is, so a
    /// reload can't leave a transition pointing at the previous bank's
    /// zones. Call from the main thread while loading, like `add_zone`.
    pub fn add_legato_transition(&mut self, transition: LegatoTransition) {
        if let Some(pending) = self.pending_sample_bank.as_mut() {
            pending.legato_transitions.push(transition);
            return;
        }
        self.legato.transitions.add(transition);
    }

    /// Tell the engine which instrument id (e.g. `violin-1`, `cello`,
    /// `trumpet`) is now loaded. The realism layer uses this to pick its
    /// body modes, sympathetic strings, and breath/bow noise colour.
    /// It also selects the modelled release: with no recorded release samples
    /// in any shipped bank, how a note stops has to come from somewhere, and
    /// the instrument id is the only thing that knows a marimba from a horn.
    pub fn set_instrument(&mut self, instrument_id: &str) {
        self.apply_instrument(instrument_id);
    }

    /// Everything the loaded instrument id decides. `commit_sample_bank` calls
    /// this rather than `realism.configure_for` directly, because committing a
    /// staged bank is the only route the worklet drives — nothing in `src/`
    /// calls the `set_instrument` export, so anything wired only to that would
    /// be dead on arrival.
    fn apply_instrument(&mut self, instrument_id: &str) {
        self.realism.configure_for(instrument_id);
        self.family_release_scale =
            InstrumentFamily::from_instrument_id(instrument_id).release_scale();
        self.voice_pool
            .set_envelope_scaling(self.effective_envelope_scaling());
    }

    /// The Attack/Release macros and the family release model, composed into
    /// the one scaling a voice applies over its zone's ADSR.
    fn effective_envelope_scaling(&self) -> EnvelopeScaling {
        EnvelopeScaling {
            attack: self.envelope_scaling.attack,
            release: self.envelope_scaling.release * self.family_release_scale,
        }
    }

    /// Build the zone lookup table. Must be called after all zones and samples are loaded.
    /// Disables the fallback tone since real samples are now available.
    pub fn build_zone_map(
        &mut self,
        num_articulations: usize,
        num_mics: usize,
    ) -> Result<(), ZoneMapBuildError> {
        if let Some(pending) = self.pending_sample_bank.as_mut() {
            pending.zone_map.build_lut(num_articulations, num_mics)?;
            pending.num_articulations = num_articulations;
            pending.num_mics = num_mics;
            pending.built = true;
            return Ok(());
        }
        self.zone_map.build_lut(num_articulations, num_mics)?;
        self.num_articulations = num_articulations;
        self.num_mics = num_mics;
        self.mic_mixer = MicMixer::new(num_mics);
        // Disable fallback — real samples are loaded
        self.fallback.enabled = false;
        self.expression
            .crossfader
            .configure(3, ExpressionConfig::default().cc1_curve);
        Ok(())
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

        self.note_on_with_channel_and_articulation(note, velocity, channel, self.articulation.current);
    }

    /// Note-on with an immutable per-note articulation selected by project truth.
    pub fn note_on_with_channel_and_articulation(
        &mut self,
        note: u8,
        velocity: u8,
        channel: u8,
        articulation: u16,
    ) {
        let art = articulation;

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
                self.attach_dynamic_layer(voice_idx, art, note, zone_id, velocity);
            }
            LegatoResult::TrueTransition {
                from_voice,
                transition,
                crossfade_out,
                ..
            } => {
                // Fade out the old voice. Its own release curve is the
                // "into the transition" ramp `crossfade_in` names — this
                // voice pool has no independent stream to apply a second,
                // separately-timed crossfade to that departing voice.
                if from_voice < self.voice_pool.voices.len() {
                    self.voice_pool.voices[from_voice].release();
                }
                let voice = &mut self.voice_pool.voices[voice_idx];
                voice.trigger(note, channel, velocity, &zone, art, gain, &self.sample_pool);
                voice.vibrato_phase = vibrato_phase;
                voice.vibrato_rate_scale = vibrato_rate_scale;
                // Audit F7: play the looked-up transition sample and
                // crossfade into the sustain zone `trigger()` just set up,
                // instead of crossfading that zone against itself.
                // `root_key: note` plays it at its recorded pitch —
                // transition samples are captured per interval, unlike a
                // single-note zone that needs root-key pitch correction.
                let transition_sample = SampleRef {
                    sample_id: transition.sample_id,
                    root_key: note,
                    tune_cents: 0,
                    start: 0,
                    end: 0,
                    loop_mode: LoopMode::NoLoop,
                    loop_start: 0,
                    loop_end: 0,
                    loop_crossfade: 0,
                };
                voice.start_legato_transition(
                    &transition_sample,
                    note,
                    crossfade_out,
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
                    // The incoming zone enters at the outgoing stream's own
                    // playhead, so the slur adds no second attack. This is
                    // the fallback for an interval the bank has no recorded
                    // transition for; a registered transition takes the
                    // `TrueTransition` arm above and never reaches here.
                    let outgoing_position = self.voice_pool.voices[from_voice].playback.position;
                    self.voice_pool.voices[from_voice].start_crossfade(
                        &zone,
                        note,
                        glide_time,
                        self.sample_rate,
                        &self.sample_pool,
                        outgoing_position,
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

        // Fire release trigger if available (audit F5).
        self.trigger_release_if_available(note, cc1);
        self.fallback.note_off(note);
        self.voice_pool
            .release_note_matching(note, self.pending_note_off_channel);
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
            let mut notes_to_release = [(0u8, 0.0f32, 0u32); 128];
            let mut release_count = 0usize;
            self.pedal_deferred
                .release_pedal(self.sample_rate, |note, cc1, stagger| {
                    if release_count < 128 {
                        notes_to_release[release_count] = (note, cc1, stagger);
                        release_count += 1;
                    }
                });
            // Audit F14: `stagger` used to be discarded (`_stagger`), so
            // every deferred note released in the same instant the pedal
            // lifted regardless of the timing `PedalDeferredRelease`
            // computed. A zero stagger (always the first note) still fires
            // synchronously; the rest queue into `pending_staggered_releases`
            // and fire from `process_block` once their delay elapses.
            for &(note, cc1, stagger) in notes_to_release.iter().take(release_count) {
                if stagger == 0 {
                    self.fire_deferred_release(note, cc1);
                } else if self.pending_staggered_count < MAX_STAGGERED_RELEASES {
                    self.pending_staggered_releases[self.pending_staggered_count] =
                        (note, cc1, stagger);
                    self.pending_staggered_count += 1;
                }
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
            // All three take a 0..1 macro position whose centre, 0.5, is the
            // patch's own voicing — the panel's macro strip defaults them there
            // and resets them there, so a patch that never touches these knobs
            // renders exactly as it did before they existed.
            "tone" => self.tone.set_position(value),
            "attack" => {
                self.envelope_scaling.attack = macro_time_scale(value);
                self.voice_pool
                    .set_envelope_scaling(self.effective_envelope_scaling());
            }
            "release" => {
                self.envelope_scaling.release = macro_time_scale(value);
                self.voice_pool
                    .set_envelope_scaling(self.effective_envelope_scaling());
            }

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

        // Fire any staggered pedal releases whose delay has elapsed this
        // block (audit F14). Swap-remove so clearing an entry doesn't skip
        // the one that takes its place.
        let mut staggered_idx = 0;
        while staggered_idx < self.pending_staggered_count {
            let (note, cc1, remaining) = self.pending_staggered_releases[staggered_idx];
            if remaining as usize <= len {
                self.fire_deferred_release(note, cc1);
                self.pending_staggered_count -= 1;
                self.pending_staggered_releases[staggered_idx] =
                    self.pending_staggered_releases[self.pending_staggered_count];
            } else {
                self.pending_staggered_releases[staggered_idx].2 = remaining - len as u32;
                staggered_idx += 1;
            }
        }

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

        // CC1 mod-wheel dynamic-layer crossfade (audit F6): push this
        // block's gains into every voice that has a second, velocity-
        // adjacent zone attached by `attach_dynamic_layer`.
        for voice in self.voice_pool.voices.iter_mut() {
            if voice.layer_active {
                voice.update_dynamic_layer_gains(
                    self.layer_gains[voice.dynamic_layer_primary_idx],
                    self.layer_gains[voice.dynamic_layer_secondary_idx],
                );
            }
        }

        // Gate the realism layer's continuous bow/breath noise on whether
        // anything is actually sounding this block. A real instrument makes
        // no noise floor when nobody is playing it. Voices only flip active
        // state at block boundaries (MIDI events are drained at block start
        // and envelope-driven voice deactivations are picked up next
        // block), so block-granularity is sufficient.
        let voices_active = self.voice_pool.active_count() > 0 || self.fallback.active_count() > 0;

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

            // Tone macro. Last stage before the mic mix, so it voices the whole
            // instrument — the sampled body and the realism layer's bow, breath
            // and air alike — rather than only the sample content.
            mono_sum = self.tone.tick(mono_sum);

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

    // -----------------------------------------------------------------------
    // Release triggers, staggered pedal release, dynamic-layer crossfade
    // -----------------------------------------------------------------------

    /// Fire a note's release-trigger zone if the tracker judges one audible
    /// (audit F5). `should_trigger`/`release_vol` used to be computed and
    /// discarded; this looks up the matching `is_release` zone through the
    /// same lookup/trigger path `note_on` uses and plays it at
    /// `release_vol`, narrowed to this note's own current articulation and
    /// trigger velocity so the release layer matches what was sounding.
    fn trigger_release_if_available(&mut self, note: u8, cc1: f32) {
        let (should_trigger, release_vol) = self.release_tracker.note_off(note, cc1);
        if !should_trigger {
            return;
        }

        let articulation = self.articulation.current;
        let velocity = self
            .voice_pool
            .voices
            .iter()
            .find(|voice| voice.active && voice.note == note)
            .map_or(100, |voice| voice.velocity);

        let candidates = self.zone_map.lookup(articulation, 0, note, velocity);
        let release_zone_id = candidates.iter().copied().find(|&id| {
            self.zone_map
                .get_zone(id)
                .is_some_and(|zone| zone.is_release)
        });
        let Some(zone_id) = release_zone_id else {
            return;
        };
        let Some(zone) = self.zone_map.get_zone(zone_id).copied() else {
            return;
        };

        let voice_idx = self.voice_pool.allocate();
        let voice = &mut self.voice_pool.voices[voice_idx];
        voice.trigger(
            note,
            0,
            velocity,
            &zone,
            articulation,
            release_vol,
            &self.sample_pool,
        );
        // A release trigger is a decorative one-shot, not a held note: it
        // must not be addressable by per-note (MPE) expression or bent by a
        // later legato transition at the same pitch.
        voice.held = false;
    }

    /// Run the note-off steps a pedal release defers, once fired — either
    /// immediately (zero stagger) or from `process_block` once a staggered
    /// entry's delay elapses (audit F14).
    fn fire_deferred_release(&mut self, note: u8, cc1: f32) {
        self.auto_divisi.note_off(note);
        self.trigger_release_if_available(note, cc1);
        self.voice_pool.release_note(note);
        self.legato.note_off(note);
    }

    /// Look up a velocity-adjacent zone for the CC1 dynamic-layer crossfade
    /// (audit F6). The engine's dynamic-layer count partitions 0..1 evenly
    /// the same way `DynamicCrossfader::configure` does, so the note's own
    /// trigger velocity names which partition it nominally belongs to, and
    /// the immediate neighbour — if a genuinely different zone exists there
    /// — is the zone CC1 can blend towards. Returns `None` when the bank
    /// only authored one zone across that neighbourhood (the common case),
    /// so behaviour is unchanged unless a bank genuinely offers more than
    /// one velocity layer.
    fn find_adjacent_layer_zone(
        &self,
        articulation: ArticulationId,
        note: u8,
        primary_zone_id: ZoneId,
        velocity: u8,
    ) -> Option<(usize, usize, ZoneId)> {
        let num_layers = self.expression.crossfader.num_layers;
        if num_layers < 2 {
            return None;
        }
        let vel_norm = velocity as f32 / 127.0;
        let primary_idx = ((vel_norm * num_layers as f32) as usize).min(num_layers - 1);

        let neighbours = [
            (primary_idx + 1 < num_layers).then_some(primary_idx + 1),
            (primary_idx > 0).then(|| primary_idx - 1),
        ];

        for neighbour_idx in neighbours.into_iter().flatten() {
            let representative_velocity =
                (((neighbour_idx as f32 + 0.5) / num_layers as f32) * 127.0)
                    .round()
                    .clamp(0.0, 127.0) as u8;
            let candidates =
                self.zone_map
                    .lookup(articulation, 0, note, representative_velocity);
            let found = candidates.iter().copied().find(|&id| {
                id != primary_zone_id
                    && self
                        .zone_map
                        .get_zone(id)
                        .is_some_and(|zone| !zone.is_release)
            });
            if let Some(zone_id) = found {
                return Some((primary_idx, neighbour_idx, zone_id));
            }
        }
        None
    }

    /// Attach the velocity-adjacent zone (if any) found by
    /// `find_adjacent_layer_zone` to a freshly triggered voice.
    fn attach_dynamic_layer(
        &mut self,
        voice_idx: usize,
        articulation: ArticulationId,
        note: u8,
        primary_zone_id: ZoneId,
        velocity: u8,
    ) {
        let Some((primary_idx, secondary_idx, adjacent_zone_id)) =
            self.find_adjacent_layer_zone(articulation, note, primary_zone_id, velocity)
        else {
            return;
        };
        let Some(adjacent_zone) = self.zone_map.get_zone(adjacent_zone_id).copied() else {
            return;
        };
        let voice = &mut self.voice_pool.voices[voice_idx];
        voice.set_dynamic_layer(&adjacent_zone, note, &self.sample_pool);
        voice.dynamic_layer_primary_idx = primary_idx;
        voice.dynamic_layer_secondary_idx = secondary_idx;
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
    use std::sync::Arc;

    use super::LevainEngine;
    use crate::levain::types::{
        AdsrParams, Dynamic, KeyRange, LegatoTransition, LoopMode, SampleRef, TransitionType,
        VelRange, Zone, MAX_ARTICULATIONS,
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
        engine_with_sawtooth_envelope(
            max_voices,
            AdsrParams {
                attack: 0.001,
                decay: 0.001,
                sustain: 1.0,
                release: 0.2,
            },
            SAMPLE_FRAMES,
        )
    }

    /// The same single-zone sawtooth engine with a caller-chosen amplitude
    /// envelope, so the Attack/Release macros have a per-zone ADSR to offset,
    /// and a caller-chosen sample length. A released voice leaves its sustain
    /// loop and plays out what is left of the recording (SFZ `loop_sustain`),
    /// so a fixture that measures the *envelope's* fall has to hold enough
    /// recording for the envelope, not the sample end, to be what ends the
    /// note.
    fn engine_with_sawtooth_envelope(
        max_voices: usize,
        amp_env: AdsrParams,
        frames: u32,
    ) -> LevainEngine {
        let mut engine = LevainEngine::new(SAMPLE_RATE, max_voices);
        let data: Vec<f32> = (0..frames)
            .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
            .collect();
        let sample_id = engine
            .add_sample(data, frames, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
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
                end: frames,
                loop_mode: LoopMode::Forward,
                loop_start: 0,
                loop_end: frames,
                loop_crossfade: 0,
            },
            amp_env,
            gain_db: 0.0,
        });
        engine
            .build_zone_map(1, 1)
            .expect("test zone map should build");
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

    // ── Macro-mapped Tone / Attack / Release ───────────────────────────────

    /// The share of the rendered energy sitting in the high band. The
    /// first-difference RMS is an HF-weighted measure, and dividing by the
    /// broadband RMS takes the *level* back out of it — so this number moves
    /// only when the spectral balance moves. A tilt that merely made the
    /// instrument louder or quieter would leave it exactly where it was, which
    /// is what makes it a claim about tone rather than about gain.
    fn brightness(samples: &[f32]) -> f32 {
        high_band_rms(samples) / rms(samples)
    }

    fn render_with_tone(tone: Option<f32>) -> Vec<f32> {
        let mut engine = engine_with_sawtooth_zone();
        if let Some(value) = tone {
            engine.set_param("tone", value);
        }
        engine.note_on(60, 100);
        render(&mut engine, 24)
    }

    /// The envelope tests play two octaves above the zone's root key, so the
    /// 200 Hz sawtooth runs at 800 Hz and one cycle is exactly 60 frames. That
    /// is the window the amplitude is measured over: a whole cycle, so each
    /// window's peak is the true amplitude at that instant rather than wherever
    /// the waveform happened to be sitting, and short enough (1.25 ms) that a
    /// 12 ms rise is still resolved to a tenth of itself.
    const ENVELOPE_NOTE: u8 = 84;
    const ENVELOPE_WINDOW: usize = 60;
    /// Two octaves up runs the sample at 4x, and the longest fall these tests
    /// measure is a 0.1 s release stretched fourfold and followed to a tenth
    /// of its held level — about 0.92 s, or 177 k sample frames. An exact
    /// multiple of `PERIOD_FRAMES` so the loop stays click-free while held.
    const ENVELOPE_SAMPLE_FRAMES: u32 = 240 * 833;

    fn window_peaks(samples: &[f32]) -> Vec<f32> {
        samples
            .chunks_exact(ENVELOPE_WINDOW)
            .map(|window| {
                window
                    .iter()
                    .fold(0.0_f32, |acc, value| acc.max(value.abs()))
            })
            .collect()
    }

    /// Seconds from note-on until the amplitude first reaches 90% of the level
    /// the note settles at — the envelope's measured rise time.
    fn rise_seconds(samples: &[f32]) -> f32 {
        let peaks = window_peaks(samples);
        let settled = peaks.iter().copied().fold(0.0_f32, f32::max);
        let index = peaks
            .iter()
            .position(|peak| *peak >= settled * 0.9)
            .expect("the note never reached its settled level");
        index as f32 * ENVELOPE_WINDOW as f32 / SAMPLE_RATE
    }

    /// Seconds from note-off until the amplitude falls to a tenth of the level
    /// it was holding — the envelope's measured fall time.
    fn fall_seconds(samples: &[f32]) -> f32 {
        let peaks = window_peaks(samples);
        let held = peaks[0];
        let index = peaks
            .iter()
            .position(|peak| *peak <= held * 0.1)
            .expect("the note never fell to a tenth of its held level");
        index as f32 * ENVELOPE_WINDOW as f32 / SAMPLE_RATE
    }

    fn render_attack(attack: Option<f32>) -> Vec<f32> {
        let mut engine = engine_with_sawtooth_envelope(
            8,
            AdsrParams {
                attack: 0.05,
                decay: 0.001,
                sustain: 1.0,
                release: 0.2,
            },
            ENVELOPE_SAMPLE_FRAMES,
        );
        if let Some(value) = attack {
            engine.set_param("attack", value);
        }
        engine.note_on(ENVELOPE_NOTE, 100);
        render(&mut engine, 96)
    }

    fn render_release(release: Option<f32>) -> Vec<f32> {
        let mut engine = engine_with_sawtooth_envelope(
            8,
            AdsrParams {
                attack: 0.001,
                decay: 0.001,
                sustain: 1.0,
                release: 0.1,
            },
            ENVELOPE_SAMPLE_FRAMES,
        );
        if let Some(value) = release {
            engine.set_param("release", value);
        }
        engine.note_on(ENVELOPE_NOTE, 100);
        render(&mut engine, 8);
        engine.note_off(ENVELOPE_NOTE);
        render(&mut engine, 400)
    }

    #[test]
    fn per_note_articulation_overrides_mutable_device_selection_at_voice_allocation() {
        let mut engine = engine_with_sawtooth_zone();
        engine.set_param("current_articulation", 8.0);

        engine.note_on_with_channel_and_articulation(60, 100, 3, 0);

        let voice = engine
            .voice_pool
            .voices
            .iter()
            .find(|voice| voice.active)
            .expect("the explicitly supported articulation should allocate a voice");
        assert_eq!(voice.articulation, 0);
        assert_eq!(voice.channel, 3);
    }

    #[test]
    fn the_tone_macro_tilts_the_spectrum_and_is_bit_identical_at_centre() {
        let baseline = render_with_tone(None);
        let centre = render_with_tone(Some(0.5));
        let bright = render_with_tone(Some(1.0));
        let dark = render_with_tone(Some(0.0));

        assert_eq!(
            centre, baseline,
            "a centred Tone macro is the patch's own voicing and must render bit-identically"
        );

        let flat = brightness(&baseline[1024..]);
        let raised = brightness(&bright[1024..]);
        let lowered = brightness(&dark[1024..]);

        assert!(
            raised > flat * 1.2,
            "Tone at its bright extreme must shift energy towards the high band: {flat} -> {raised}"
        );
        assert!(
            lowered < flat * 0.8,
            "Tone at its dark extreme must shift energy away from the high band: {flat} -> {lowered}"
        );
    }

    #[test]
    fn the_attack_macro_scales_the_patch_envelope_rise_time() {
        let baseline = render_attack(None);
        let centre = render_attack(Some(0.5));
        let slow = render_attack(Some(1.0));
        let fast = render_attack(Some(0.0));

        assert_eq!(
            centre, baseline,
            "a centred Attack macro must leave the patch's own envelope untouched"
        );

        let patch = rise_seconds(&baseline);
        let slowed = rise_seconds(&slow);
        let quickened = rise_seconds(&fast);

        assert!(
            (3.6..=4.4).contains(&(slowed / patch)),
            "Attack at its slow extreme must stretch the patch's 45 ms rise about fourfold, \
             got {patch} s -> {slowed} s"
        );
        assert!(
            (0.20..=0.30).contains(&(quickened / patch)),
            "Attack at its fast extreme must shorten the patch's 45 ms rise to about a quarter, \
             got {patch} s -> {quickened} s"
        );
    }

    #[test]
    fn the_release_macro_scales_the_patch_envelope_fall_time() {
        let baseline = render_release(None);
        let centre = render_release(Some(0.5));
        let long = render_release(Some(1.0));
        let short = render_release(Some(0.0));

        assert_eq!(
            centre, baseline,
            "a centred Release macro must leave the patch's own envelope untouched"
        );

        let patch = fall_seconds(&baseline);
        let lengthened = fall_seconds(&long);
        let shortened = fall_seconds(&short);

        assert!(
            (3.6..=4.4).contains(&(lengthened / patch)),
            "Release at its long extreme must stretch the patch's fall about fourfold, \
             got {patch} s -> {lengthened} s"
        );
        assert!(
            (0.20..=0.30).contains(&(shortened / patch)),
            "Release at its short extreme must shorten the patch's fall to about a quarter, \
             got {patch} s -> {shortened} s"
        );
    }

    #[test]
    fn the_release_macro_reaches_a_note_that_is_already_held() {
        // Note first, macro second — the order a player produces by holding a
        // chord and then reaching for the knob. A scaling that only landed at
        // trigger time would leave this chord on the patch's own release.
        let mut engine = engine_with_sawtooth_envelope(
            8,
            AdsrParams {
                attack: 0.001,
                decay: 0.001,
                sustain: 1.0,
                release: 0.1,
            },
            ENVELOPE_SAMPLE_FRAMES,
        );
        engine.note_on(ENVELOPE_NOTE, 100);
        render(&mut engine, 8);
        engine.set_param("release", 1.0);
        engine.note_off(ENVELOPE_NOTE);
        let held_through = render(&mut engine, 400);

        let patch = fall_seconds(&render_release(None));
        let lengthened = fall_seconds(&held_through);

        assert!(
            (3.6..=4.4).contains(&(lengthened / patch)),
            "a Release macro moved while the note was sounding must stretch that \
             note's fall, got {patch} s -> {lengthened} s"
        );
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
        assert_eq!(
            before.len(),
            2,
            "the release tail and the retrigger must both be active"
        );
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
        assert_eq!(
            voices[0].0, 3,
            "the surviving voice carries the newer channel"
        );

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

    /// The fallback's arming window, pinned at both ends.
    ///
    /// `clear_zones` is the only writer that arms it and `build_zone_map` the
    /// only one that disarms it, so the tone covers the interval between "a
    /// sample load has begun" and "zones exist" — and nothing wider. A bare
    /// engine is *outside* that window and must render digital silence.
    ///
    /// Arming at construction instead was tried and rejected: it makes an
    /// engine that never began a load sing a sine where the instrument's real
    /// content belongs, which is audible garbage that reads as working. The
    /// two halves are asserted together so neither can be "fixed" alone.
    #[test]
    fn the_fallback_is_armed_by_clear_zones_and_not_by_construction() {
        let mut bare = LevainEngine::new(SAMPLE_RATE, 8);
        bare.note_on(60, 100);
        let bare_level = rms(&render(&mut bare, 24));
        assert_eq!(
            bare_level, 0.0,
            "an engine that never began a sample load rendered RMS {bare_level:e}; \
             if the fallback is now armed at construction, note that a sine tone is \
             not a stand-in for missing sample content"
        );

        let mut loading = LevainEngine::new(SAMPLE_RATE, 8);
        loading.clear_zones();
        loading.note_on(60, 100);
        let loading_level = rms(&render(&mut loading, 24));
        assert!(
            loading_level > 1.0e-3,
            "once a load has begun the fallback must cover it, got RMS {loading_level:e}"
        );
    }

    #[test]
    fn published_sample_banks_are_shared_without_copying_pcm_between_engines() {
        let mut owner = LevainEngine::new(SAMPLE_RATE, 8);
        owner.begin_sample_bank("violin");
        assert_eq!(
            owner.add_sample(vec![0.25; 64], 64, 1, SAMPLE_RATE),
            Some(0)
        );
        owner
            .build_zone_map(0, 0)
            .expect("empty test zone map should build");
        assert!(owner.publish_sample_bank("levain-test-shared-bank"));
        assert!(owner.commit_sample_bank());

        let mut follower = LevainEngine::new(SAMPLE_RATE, 8);
        follower.begin_sample_bank("violin");
        assert!(follower.attach_sample_bank("levain-test-shared-bank"));
        follower
            .build_zone_map(0, 0)
            .expect("empty test zone map should build");
        assert!(follower.commit_sample_bank());

        assert!(std::sync::Arc::ptr_eq(
            &owner.sample_pool,
            &follower.sample_pool
        ));
        assert_eq!(owner.sample_bank_bytes(), 64 * std::mem::size_of::<f32>());
        assert_eq!(follower.sample_bank_bytes(), owner.sample_bank_bytes());
        assert_eq!(owner.add_sample(vec![0.5; 64], 64, 1, SAMPLE_RATE), None);

        owner.set_param("master_gain", 0.2);
        assert_eq!(owner.master_gain, 0.2);
        assert_eq!(follower.master_gain, 0.8);
    }

    #[test]
    fn shared_sample_bank_registry_does_not_retain_unused_pcm() {
        {
            let mut owner = LevainEngine::new(SAMPLE_RATE, 8);
            owner.begin_sample_bank("violin");
            owner
                .add_sample(vec![0.25; 64], 64, 1, SAMPLE_RATE)
                .expect("test sample should fit the bank");
            assert!(owner.publish_sample_bank("levain-test-weak-bank"));
        }

        let mut fresh = LevainEngine::new(SAMPLE_RATE, 8);
        assert!(!fresh.attach_sample_bank("levain-test-weak-bank"));
        assert_eq!(fresh.sample_bank_bytes(), 0);
    }

    #[test]
    fn rejected_staged_bank_preserves_the_sounding_bank_for_retry() {
        let mut engine = engine_with_sawtooth_zone();
        engine.set_instrument("violin");
        let sounding_pool = Arc::as_ptr(&engine.sample_pool);
        assert!(engine.realism.is_bowed_string_for_test());

        engine.begin_sample_bank("trumpet");
        engine
            .add_sample(vec![0.5; 64], 64, 1, SAMPLE_RATE)
            .expect("replacement sample should fit the staging bank");
        assert!(engine.build_zone_map(MAX_ARTICULATIONS + 1, 1).is_err());
        engine.abort_sample_bank();

        assert_eq!(Arc::as_ptr(&engine.sample_pool), sounding_pool);
        assert!(engine.realism.is_bowed_string_for_test());
        engine.note_on(60, 100);
        assert!(rms(&render(&mut engine, 24)) > 1.0e-3);
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

    // ── Audit #1833: release triggers, CC1 layer crossfade, true legato,
    //    loop-seam crossfade, staggered pedal release ─────────────────────

    fn wide_zone(id: u32, sample_id: u32, vel: VelRange, is_release: bool) -> Zone {
        Zone {
            id,
            key: KeyRange { lo: 0, hi: 127 },
            vel,
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release,
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
        }
    }

    /// F5 — release triggers were computed (`should_trigger`/`release_vol`)
    /// and immediately discarded, so a bank authored with a release-trigger
    /// zone (bow lift, damper noise, key-off breath) never sounded it.
    #[test]
    fn note_off_fires_the_matching_release_trigger_zone() {
        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
        let data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
            .collect();
        let sample_id = engine
            .add_sample(data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let full_vel = VelRange { lo: 0, hi: 127 };
        engine.add_zone(wide_zone(0, sample_id, full_vel, false));
        engine.add_zone(wide_zone(1, sample_id, full_vel, true));
        engine
            .build_zone_map(1, 1)
            .expect("zone map should build");

        engine.note_on(60, 100);
        // Hold long enough that `ReleaseTracker`'s duration scale clears its
        // 0.01 audibility floor at the engine's default CC1 (0.5).
        render(&mut engine, 400);
        let before = engine.active_voice_count();

        engine.note_off(60);

        // The sustain voice's own release tail keeps it active, so a fixed
        // voice count on its own wouldn't distinguish "released" from
        // "released and a new release-trigger voice fired". Comparing
        // against `before` does: a release trigger must add a voice, not
        // just change one already sounding.
        assert_eq!(
            engine.active_voice_count(),
            before + 1,
            "note_off on a held note with an is_release zone available must \
             allocate an additional voice for the release trigger"
        );
    }

    /// F6 — `get_layer_gains` was computed every block and never read, so
    /// the CC1 mod wheel never crossfaded between a note's velocity-adjacent
    /// dynamic layers; only CC7/CC11 reached audio.
    #[test]
    fn cc1_dynamic_layer_gains_blend_toward_the_velocity_adjacent_zone() {
        fn single_zone_engine(freq_hz: f32) -> LevainEngine {
            let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
            let data: Vec<f32> = (0..SAMPLE_FRAMES)
                .map(|frame| {
                    (std::f32::consts::TAU * freq_hz * frame as f32 / SAMPLE_RATE).sin()
                })
                .collect();
            let sample_id = engine
                .add_sample(data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
                .expect("test sample should fit the bank");
            engine.add_zone(wide_zone(0, sample_id, VelRange { lo: 0, hi: 127 }, false));
            engine
                .build_zone_map(1, 1)
                .expect("zone map should build");
            engine
        }

        let mut low_only = single_zone_engine(110.0);
        low_only.note_on(60, 32);
        let low_crossings = zero_crossings(&render(&mut low_only, 24)[1024..]);

        let mut high_only = single_zone_engine(440.0);
        high_only.note_on(60, 32);
        let high_crossings = zero_crossings(&render(&mut high_only, 24)[1024..]);
        assert!(
            low_crossings < high_crossings,
            "test fixture sanity: the reference tones must differ in zero-crossing \
             rate, got low {low_crossings} vs high {high_crossings}"
        );

        // Two velocity-layer zones at the same note: 110 Hz below velocity
        // 64, 440 Hz at or above it. A soft (velocity 32) trigger selects the
        // low zone alone under the pre-fix behaviour, regardless of CC1.
        let mut dual = LevainEngine::new(SAMPLE_RATE, 8);
        let low_data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| (std::f32::consts::TAU * 110.0 * frame as f32 / SAMPLE_RATE).sin())
            .collect();
        let high_data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| (std::f32::consts::TAU * 440.0 * frame as f32 / SAMPLE_RATE).sin())
            .collect();
        let low_sample = dual
            .add_sample(low_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("low sample should fit the bank");
        let high_sample = dual
            .add_sample(high_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("high sample should fit the bank");
        dual.add_zone(wide_zone(0, low_sample, VelRange { lo: 0, hi: 63 }, false));
        dual.add_zone(wide_zone(
            1,
            high_sample,
            VelRange { lo: 64, hi: 127 },
            false,
        ));
        dual.build_zone_map(1, 1).expect("zone map should build");

        dual.note_on(60, 32);
        let dual_crossings = zero_crossings(&render(&mut dual, 24)[1024..]);

        // CC1 is left at the engine's default (0.5) — dead centre of the mid
        // dynamic layer with 3 configured layers. That position gives the
        // low zone's own layer gain 0 and the high zone (its neighbour) a
        // full gain, so a working fix should render this soft-velocity note
        // sounding much closer to the high reference than the low one.
        let midpoint = (low_crossings + high_crossings) / 2;
        assert!(
            dual_crossings > midpoint,
            "CC1 left at its default position must blend in audible energy from \
             the velocity-adjacent dynamic layer: low-only {low_crossings}, \
             high-only {high_crossings}, dual-zone {dual_crossings}"
        );
    }

    /// F7 — a true-legato transition triggered the sustain zone and then
    /// crossfaded it against itself (`start_crossfade(&zone, ...)` with the
    /// same `zone` just triggered), so a recorded transition sample could
    /// never sound.
    #[test]
    fn true_legato_transition_plays_the_looked_up_transition_sample() {
        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);

        let sustain_data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
            .collect();
        // 8 kHz — far enough from the 200 Hz sustain tone that the two are
        // unmistakable by zero-crossing rate alone.
        let transition_period = 6u32;
        let transition_data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| {
                (frame % transition_period) as f32 / transition_period as f32 * 2.0 - 1.0
            })
            .collect();

        let sustain_sample = engine
            .add_sample(sustain_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("sustain sample should fit the bank");
        let transition_sample = engine
            .add_sample(transition_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("transition sample should fit the bank");

        engine.add_zone(wide_zone(
            0,
            sustain_sample,
            VelRange { lo: 0, hi: 127 },
            false,
        ));
        engine
            .build_zone_map(1, 1)
            .expect("zone map should build");

        engine.add_legato_transition(LegatoTransition {
            interval: 4, // 64 - 60
            transition_type: TransitionType::Slurred,
            dynamic: Dynamic::MF, // cc1_to_dynamic(0.5), the engine's default
            sample_id: transition_sample,
            crossfade_out_ms: 0.0, // unauthored: the adaptive default applies
        });

        // Hold 60, then slur into 64 well inside the legato engine's 100 ms
        // fast threshold at velocity 100 (>= the Slurred/Portamento split),
        // so `note_on` derives exactly the (interval, dynamic, type) this
        // transition was registered under.
        engine.note_on(60, 100);
        render(&mut engine, 4);
        engine.note_on(64, 100);

        let rendered = render(&mut engine, 1);
        let crossings = zero_crossings(&rendered);
        let self_crossfade_estimate = (2.0 * 200.0 * 128.0 / SAMPLE_RATE).round();
        assert!(
            crossings as f32 > self_crossfade_estimate * 4.0,
            "the true-legato transition sample must sound immediately after the \
             slur; got {crossings} zero crossings in the first block, versus \
             roughly {self_crossfade_estimate} for a 200 Hz sustain zone \
             crossfaded against itself"
        );
    }

    /// `crossfadeOutMs` is a manifest field this PR validates and documents,
    /// so it has to reach the audio. The hand-over from the transition
    /// recording into the new sustain zone is the one half of the authored
    /// pair this voice pool can actually time; an authored value replaces the
    /// speed-derived `crossfade_times` default, and `0.0` leaves that default
    /// alone so every bank shipped today behaves exactly as before.
    #[test]
    fn an_authored_crossfade_out_lengthens_the_transition_hand_over() {
        /// Blocks after the slur at which the 40 ms fast default is long over
        /// (15 blocks) but a 200 ms authored fade is barely a quarter through.
        const SETTLED_BLOCKS: usize = 20;

        fn crossings_after_the_default_would_have_finished(crossfade_out_ms: f32) -> usize {
            let mut engine = LevainEngine::new(SAMPLE_RATE, 8);

            let sustain_data: Vec<f32> = (0..SAMPLE_FRAMES)
                .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
                .collect();
            let transition_period = 6u32;
            let transition_data: Vec<f32> = (0..SAMPLE_FRAMES)
                .map(|frame| {
                    (frame % transition_period) as f32 / transition_period as f32 * 2.0 - 1.0
                })
                .collect();

            let sustain_sample = engine
                .add_sample(sustain_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
                .expect("sustain sample should fit the bank");
            let transition_sample = engine
                .add_sample(transition_data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
                .expect("transition sample should fit the bank");

            engine.add_zone(wide_zone(
                0,
                sustain_sample,
                VelRange { lo: 0, hi: 127 },
                false,
            ));
            engine
                .build_zone_map(1, 1)
                .expect("zone map should build");
            engine.add_legato_transition(LegatoTransition {
                interval: 4,
                transition_type: TransitionType::Slurred,
                dynamic: Dynamic::MF,
                sample_id: transition_sample,
                crossfade_out_ms,
            });

            engine.note_on(60, 100);
            render(&mut engine, 4);
            engine.note_on(64, 100);
            render(&mut engine, SETTLED_BLOCKS);
            zero_crossings(&render(&mut engine, 4))
        }

        // 0.0 is "unauthored": the fast-legato 40 ms default, finished well
        // before the measurement window, so this reads as the 200 Hz sustain.
        let default_fade = crossings_after_the_default_would_have_finished(0.0);
        // 200 ms: still roughly three quarters weighted onto the 8 kHz
        // transition recording when the window opens.
        let authored_fade = crossings_after_the_default_would_have_finished(200.0);

        assert!(
            authored_fade > default_fade * 4,
            "an authored crossfadeOutMs must lengthen the hand-over out of the \
             transition recording: {authored_fade} zero crossings against \
             {default_fade} for the speed-derived default, measured over the \
             same window {SETTLED_BLOCKS} blocks after the slur"
        );
    }

    /// F14 — `loop_crossfade` is stored on every voice and was never read, so
    /// a loop whose start and end aren't waveform-continuous clicks on every
    /// repeat despite the doc promising an equal-power seam crossfade.
    #[test]
    fn loop_crossfade_smooths_the_seam_instead_of_clicking() {
        fn render_stepped_loop(loop_crossfade: u32) -> Vec<f32> {
            let mut engine = LevainEngine::new(SAMPLE_RATE, 4);
            let loop_len = 480u32; // 10 ms at 48 kHz
            // A ramp that is continuous everywhere except the wrap from just
            // under +1.0 back to -1.0 isolates the loop-seam discontinuity:
            // it is the *only* click in the waveform, so `max_delta` below
            // measures the seam and nothing else.
            let data: Vec<f32> = (0..loop_len)
                .map(|i| (i as f32 / loop_len as f32) * 2.0 - 1.0)
                .collect();
            let sample_id = engine
                .add_sample(data, loop_len, 1, SAMPLE_RATE)
                .expect("test sample should fit the bank");
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
                    end: loop_len,
                    loop_mode: LoopMode::Forward,
                    loop_start: 0,
                    loop_end: loop_len,
                    loop_crossfade,
                },
                amp_env: AdsrParams {
                    attack: 0.0001,
                    decay: 0.0001,
                    sustain: 1.0,
                    release: 0.2,
                },
                gain_db: 0.0,
            });
            engine
                .build_zone_map(1, 1)
                .expect("zone map should build");
            engine.note_on(60, 100);
            render(&mut engine, 40)
        }

        fn max_delta(samples: &[f32]) -> f32 {
            samples
                .windows(2)
                .map(|pair| (pair[1] - pair[0]).abs())
                .fold(0.0_f32, f32::max)
        }

        let click_without = max_delta(&render_stepped_loop(0)[1024..]);
        let click_with = max_delta(&render_stepped_loop(96)[1024..]);

        assert!(
            click_with < click_without * 0.5,
            "loop_crossfade must smooth the seam discontinuity: \
             {click_without} -> {click_with}"
        );
    }

    /// F14 — `PedalDeferredRelease::release_pedal` computes staggered timing
    /// per note and the callback discarded it as `_stagger`, so every
    /// deferred note-off fired in the same instant the pedal lifted.
    #[test]
    fn pedal_release_staggers_deferred_note_offs() {
        let mut engine = engine_with_sawtooth_zone_voices(4);
        // Three overlapping notes on one zone would otherwise trigger the
        // (unrelated) legato engine's synthetic glide, which reuses a voice
        // rather than allocating one per note — isolate the pedal-stagger
        // behaviour this test targets.
        engine.set_param("legato_enabled", 0.0);
        engine.handle_cc(64, 127); // sustain pedal down
        engine.note_on(60, 100);
        engine.note_on(62, 100);
        engine.note_on(64, 100);
        engine.note_off(60);
        engine.note_off(62);
        engine.note_off(64);
        render(&mut engine, 1);

        let is_releasing = |engine: &LevainEngine, note: u8| {
            engine
                .voice_pool
                .voices
                .iter()
                .any(|v| v.active && v.note == note && v.amp_env.is_releasing())
        };
        assert!(!is_releasing(&engine, 60));
        assert!(!is_releasing(&engine, 62));
        assert!(!is_releasing(&engine, 64));

        engine.handle_cc(64, 0); // lift the pedal

        // The first deferred note-off (zero stagger) fires synchronously
        // with the CC message; the audit finding is that the others used to
        // as well, instead of waiting out their computed stagger.
        assert!(
            is_releasing(&engine, 60),
            "the first deferred note-off must fire immediately"
        );
        assert!(
            !is_releasing(&engine, 62) || !is_releasing(&engine, 64),
            "later deferred note-offs must be staggered rather than releasing \
             in the same instant as the first"
        );

        // The largest computed stagger is well under 30 ms; render past it.
        render(&mut engine, 20);
        assert!(is_releasing(&engine, 62));
        assert!(is_releasing(&engine, 64));
    }

    // ── #1848: modelled release and crossfade legato, for banks that ship
    //    no recorded release or interval samples ──────────────────────────

    fn peak(samples: &[f32]) -> f32 {
        samples
            .iter()
            .fold(0.0_f32, |acc, value| acc.max(value.abs()))
    }

    /// One zone whose sample is loud for `loud_frames` and then silent, looped
    /// over its whole length — the shape every shipped Levain sustain zone has
    /// (`loopStart` 0, `loopEnd` = frame count), with the silent half standing
    /// in for the point past which there is nothing left to play.
    fn engine_with_half_silent_loop(release: f32, loud_frames: u32) -> LevainEngine {
        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
        let data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| {
                if frame >= loud_frames {
                    return 0.0;
                }
                (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0
            })
            .collect();
        let sample_id = engine
            .add_sample(data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let mut zone = wide_zone(0, sample_id, VelRange { lo: 0, hi: 127 }, false);
        zone.amp_env.release = release;
        engine.add_zone(zone);
        engine
            .build_zone_map(1, 1)
            .expect("test zone map should build");
        engine
    }

    /// A forward loop is SFZ's `loop_sustain`, not `loop_continuous`: the loop
    /// runs while the note is held, and "during the release phase, there's no
    /// looping". Every shipped bank loops the *whole* sustain sample with a
    /// zero-frame seam crossfade, so a release that kept looping wraps the
    /// playhead back onto the recording's own attack under the release fade.
    #[test]
    fn release_leaves_the_sustain_loop_instead_of_wrapping_into_the_attack() {
        // Loud for the first eighth of the sample, silent after. A note-off
        // taken inside the silent part must stay silent; only a wrap back to
        // frame 0 can make it sound again.
        let loud_frames = SAMPLE_FRAMES / 8;
        let mut engine = engine_with_half_silent_loop(5.0, loud_frames);

        engine.note_on(60, 100);
        let held = render(&mut engine, 4);
        assert!(
            peak(&held) > 0.1,
            "the held note must sound before the release is measured; got {}",
            peak(&held)
        );

        engine.note_off(60);
        // Render past the loop end (SAMPLE_FRAMES = 4800 frames = 37.5 blocks),
        // then measure the window a wrap would land the loud eighth in.
        render(&mut engine, 34);
        let after_the_loop_end = render(&mut engine, 4);

        assert!(
            peak(&after_the_loop_end) < peak(&held) * 0.02,
            "a released voice must run out of the sustain loop and stop, not \
             wrap back onto the sample's own attack: peak after the loop end \
             is {} against {} while held",
            peak(&after_the_loop_end),
            peak(&held)
        );
    }

    /// Crossfade legato with no interval sample: the incoming zone must enter
    /// at the outgoing voice's own playhead, not at frame 0, or every slur
    /// re-articulates the target zone's recorded onset.
    #[test]
    fn crossfade_legato_enters_the_new_zone_past_its_recorded_onset() {
        // Loud onset over the first half, quiet body after — an exaggerated
        // stand-in for a sustain sample's attack transient.
        const ONSET_FRAMES: u32 = SAMPLE_FRAMES / 2;
        const BODY_LEVEL: f32 = 0.15;

        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
        let data: Vec<f32> = (0..SAMPLE_FRAMES)
            .map(|frame| {
                let level = if frame < ONSET_FRAMES { 1.0 } else { BODY_LEVEL };
                ((frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0) * level
            })
            .collect();
        let sample_id = engine
            .add_sample(data, SAMPLE_FRAMES, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        engine.add_zone(wide_zone(0, sample_id, VelRange { lo: 0, hi: 127 }, false));
        engine
            .build_zone_map(1, 1)
            .expect("test zone map should build");

        // Hold 60 until its playhead is well inside the quiet body (24 blocks
        // = 3072 frames, past the 2400-frame onset).
        engine.note_on(60, 100);
        render(&mut engine, 20);
        let body = render(&mut engine, 4);

        // Slur to 64. No transition sample is registered, so this is the
        // crossfade-legato fallback.
        engine.note_on(64, 100);
        // Eight blocks covers the 30 ms fast-legato crossfade almost entirely
        // while leaving the matched playhead short of the loop end.
        let slur = render(&mut engine, 8);

        assert!(
            peak(&slur) < peak(&body) * 3.0,
            "a crossfade slur must not re-articulate the target zone's onset: \
             peak across the transition is {} against {} for the body the \
             outgoing voice was already sounding, and the onset in this sample \
             is {:.1}x the body",
            peak(&slur),
            peak(&body),
            1.0 / BODY_LEVEL
        );
    }

    /// A long non-looping zone, so the release envelope — not the end of the
    /// sample — is what the tail measures.
    ///
    /// Loaded through the staged-bank path (`begin_sample_bank` …
    /// `commit_sample_bank`), because that is the only route the worklet
    /// actually drives: nothing in `src/` calls `LevainInstance::set_instrument`,
    /// so an instrument-derived behaviour wired only to that export would never
    /// reach a player.
    fn engine_with_long_dry_zone(instrument_id: &str) -> LevainEngine {
        const LONG_FRAMES: u32 = 96_000; // 2 s at 48 kHz
        let mut engine = LevainEngine::new(SAMPLE_RATE, 8);
        engine.begin_sample_bank(instrument_id);
        let data: Vec<f32> = (0..LONG_FRAMES)
            .map(|frame| (frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0)
            .collect();
        let sample_id = engine
            .add_sample(data, LONG_FRAMES, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let mut zone = wide_zone(0, sample_id, VelRange { lo: 0, hi: 127 }, false);
        zone.sample.end = LONG_FRAMES;
        zone.sample.loop_mode = LoopMode::NoLoop;
        // The release every shipped manifest carries for a sustaining
        // articulation, emitted by `scripts/download-levain-samples.ts` from
        // articulation type alone.
        zone.amp_env.release = 0.5;
        engine.add_zone(zone);
        engine
            .build_zone_map(1, 1)
            .expect("test zone map should build");
        assert!(
            engine.commit_sample_bank(),
            "the staged test bank should commit"
        );
        engine
    }

    /// A marimba is not a horn. Percussion and choir are the two families whose
    /// realism preset is neutral (`Instrument::Other` — no body, sympathetic,
    /// bow or breath contribution), so the difference between these two renders
    /// is the modelled release and nothing else.
    #[test]
    fn release_time_follows_the_instrument_family() {
        fn tail_rms(instrument_id: &str) -> f32 {
            let mut engine = engine_with_long_dry_zone(instrument_id);
            engine.note_on(60, 100);
            render(&mut engine, 4);
            engine.note_off(60);
            render(&mut engine, 320); // ~0.85 s of release
            rms(&render(&mut engine, 8))
        }

        let percussion = tail_rms("marimba");
        let choir = tail_rms("soprano");

        assert!(
            percussion > choir * 3.0,
            "an undamped percussion bar must ring on where a breath-stopped \
             voice does not: marimba tail RMS {percussion} against soprano \
             {choir} at the same point in the release"
        );
    }

    /// A struck bar: the whole natural ringdown is in the recording and there
    /// is no loop. All three shipped percussion banks are exactly this —
    /// marimba, glockenspiel and timpani each declare `sustain` zones with
    /// `loopMode: "none"` and `release: 0.5`, so they take the family scale on
    /// a zone whose sample stops of its own accord.
    fn engine_with_percussion_one_shot(
        instrument_id: &str,
        max_voices: usize,
        ring_frames: u32,
    ) -> LevainEngine {
        let mut engine = LevainEngine::new(SAMPLE_RATE, max_voices);
        engine.begin_sample_bank(instrument_id);
        let data: Vec<f32> = (0..ring_frames)
            .map(|frame| {
                let ringdown = 1.0 - frame as f32 / ring_frames as f32;
                ((frame % PERIOD_FRAMES) as f32 / PERIOD_FRAMES as f32 * 2.0 - 1.0) * ringdown
            })
            .collect();
        let sample_id = engine
            .add_sample(data, ring_frames, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let mut zone = wide_zone(0, sample_id, VelRange { lo: 0, hi: 127 }, false);
        zone.sample.end = ring_frames;
        zone.sample.loop_mode = LoopMode::NoLoop;
        zone.amp_env.release = 0.5;
        engine.add_zone(zone);
        engine
            .build_zone_map(1, 1)
            .expect("test zone map should build");
        assert!(
            engine.commit_sample_bank(),
            "the staged test bank should commit"
        );
        engine
    }

    /// The family model has to survive on the shape it was measured from. All
    /// three shipped percussion banks are non-looping one-shots, so a release
    /// model that only reached looping zones would leave the 4.6 tuned against
    /// recordings it can no longer affect. Freeing a run-dry voice does not
    /// cost this: the slot is reclaimed only once the recording has nothing
    /// left to read, which is after the whole window measured here.
    #[test]
    fn the_family_release_still_shapes_a_percussion_one_shot() {
        const RING_FRAMES: u32 = 110_400; // 2.3 s, the measured marimba ringdown
        const BLOCKS_AFTER_OFF: usize = 375; // 1.0 s, well inside the recording

        fn tail_rms(instrument_id: &str) -> f32 {
            let mut engine = engine_with_percussion_one_shot(instrument_id, 8, RING_FRAMES);
            engine.note_on(60, 100);
            render(&mut engine, 38);
            engine.note_off(60);
            render(&mut engine, BLOCKS_AFTER_OFF);
            rms(&render(&mut engine, 8))
        }

        let percussion = tail_rms("marimba");
        let choir = tail_rms("soprano");

        assert!(
            percussion > choir * 3.0,
            "letting go of a mallet must not damp the bar: marimba one-shot \
             tail RMS {percussion} against soprano {choir} one second after \
             note-off, with the recording still playing in both"
        );
    }

    /// A voice whose every stream has run dry can only emit zeros, so holding
    /// the pool with it costs polyphony and buys nothing. `VoicePool::allocate`
    /// cannot recover the slot either: `steal_priority` scores an inaudible
    /// release tail `1`, the *minimum* among active voices, while any sounding
    /// voice scores `2 + …` — so the allocator steals the note that is still
    /// ringing and leaves the silence in place.
    ///
    /// Pinned on an ordinary part rather than a stress case: 4 notes a second,
    /// each struck and let go like a mallet stroke.
    #[test]
    fn a_note_on_must_not_steal_a_sounding_voice_while_run_dry_ones_hold_the_pool() {
        /// Well above the `1e-4` `steal_priority` itself treats as past
        /// audibility, so nothing here turns on a borderline reading.
        const AUDIBLE_ENERGY: f32 = 1e-3;
        /// The pool `levainProcessor.ts` actually constructs. A smaller one
        /// exhausts at any release length and would convict every family.
        const POOL: usize = 64;
        const ONSETS: u8 = 120;
        const RING_FRAMES: u32 = 24_000; // 0.5 s at 48 kHz
        const BLOCKS_PER_ONSET: usize = 94; // 0.25 s at 48 kHz in 128-frame blocks
        const BLOCKS_HELD: usize = 38; // ~0.1 s, a struck bar released early

        fn audible_steals_over_a_part(instrument_id: &str) -> (u32, f32, usize) {
            let mut engine = engine_with_percussion_one_shot(instrument_id, POOL, RING_FRAMES);
            let mut steals = 0_u32;
            let mut worst_energy = 0.0_f32;

            for index in 0..ONSETS {
                let note = 60 + index % 12;
                let victim = engine.voice_pool.allocate();
                let voice = &engine.voice_pool.voices[victim];
                if voice.active && voice.energy > AUDIBLE_ENERGY {
                    steals += 1;
                    worst_energy = worst_energy.max(voice.energy);
                }
                engine.note_on(note, 100);
                render(&mut engine, BLOCKS_HELD);
                engine.note_off(note);
                render(&mut engine, BLOCKS_PER_ONSET - BLOCKS_HELD);
            }

            (steals, worst_energy, engine.voice_pool.active_count())
        }

        // Choir carries `release_scale() == 1.0`, so it is this same part
        // through this same code with the family model contributing nothing.
        // It is the control: if it ever stole, the fault would be the pool's
        // rather than the release model's.
        let (control_steals, _, control_active) = audible_steals_over_a_part("soprano");
        assert_eq!(
            control_steals, 0,
            "the control must not steal, or this test convicts the voice pool \
             rather than the release model: {control_steals} of {ONSETS} \
             onsets, pool ended {control_active}/{POOL} active"
        );

        let (steals, worst_stolen_energy, active) = audible_steals_over_a_part("marimba");
        assert_eq!(
            steals, 0,
            "a note-on must take a run-dry voice before a sounding one: \
             {steals} of {ONSETS} onsets stole a voice that was still audible \
             (worst energy stolen {worst_stolen_energy}), and the pool of \
             {POOL} ended with {active} voices active"
        );
    }
}
