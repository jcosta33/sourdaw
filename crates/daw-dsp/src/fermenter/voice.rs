/// Single synthesizer voice — owns oscillator, filter, envelopes, LFO.
use super::additive::AdditiveEngine;
use super::chaos::{LorenzMod, PerlinMod};
use super::envelope::Envelope;
use super::filter::{
    fast_tanh, DiodeLadder, FilterMode, FormantFilter, MoogLadder, Ms20Filter, SemFilter, SvfFilter,
};
use super::fm::FmEngine;
use super::granular::GranularEngine;
use super::lfo::{Lfo, LfoShape};
use super::modulation::ModMatrix;
use super::mseg::Mseg;
use super::noise::NoiseGen;
use super::oscillator::{PolyBlepOsc, UnisonOsc, Wavetable, WavetableOsc};
use super::physical::KarplusStrong;
use super::sampler::SamplerEngine;
use super::spectral::SpectralWarp;
use super::stepseq::StepSequencer;

/// Smallest `|osc_l| + |osc_r|` the stereo balance in `Voice::render` will
/// divide by. Purely a division-safety invariant — see the comment at the use
/// site for why it is unreachable in the current gate and why it is still here.
const MIN_BALANCE_SUM: f32 = 1e-6;

/// Equal-tempered frequency of a MIDI note, A4 = 440 Hz.
///
/// Shared so that the pitch a note glides *to* and the pitch a later note glides
/// *from* are computed by one expression: `Layer` records a played note's
/// frequency as the next glide's origin, and an origin that disagreed with the
/// destination formula by even a rounding step would put an audible sub-cent
/// ramp on a note that should have snapped.
pub fn note_frequency(note: u8) -> f32 {
    440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0)
}

/// All per-block parameters passed from MasterSynth to Voice::render.
pub struct VoiceParams<'a> {
    pub tables: &'a [Wavetable],
    pub base_cutoff: f32,
    pub resonance: f32,
    pub filter_mode: FilterMode,
    pub filter_drive: f32,
    pub filter_keytrack: f32,
    pub lfo_rate: f32,
    pub lfo_shape: u8,
    pub lfo_filter_amount: f32,
    pub mod_matrix: &'a ModMatrix,
    pub sample_rate: f32,
    pub osc_level: f32,
    pub osc_coarse: f32,
    pub osc_fine: f32,
    pub filter_model: u8,
    pub mseg_to_filter: f32,
    pub seq_rate: f32,
    pub seq_to_pitch: f32,
    pub per_voice_drive: f32,
    pub warp_mode: u8,
    pub warp_amount: f32,
    pub audio_mod_rate: f32,  // 0-5000 Hz
    pub audio_mod_depth: f32, // 0-1
    pub audio_mod_target: u8, // 0=off, 1=pitch(FM), 2=amplitude(AM), 3=filter
    pub chaos_amount: f32,    // 0-1, how much Lorenz/Perlin modulates
    pub chaos_speed: f32,     // 0.01-10, speed of chaos modulators
}

pub struct Voice {
    pub active: bool,
    pub note: u8,
    /// MIDI channel this voice was triggered on. Together with `note` and
    /// `held` this is the voice's per-note expression address (audit MD-2):
    /// under MPE each sounding note owns its own member channel, so two
    /// simultaneous voices at the same pitch are told apart by channel.
    pub channel: u8,
    /// True from note-on until note-off. A voice whose release tail is still
    /// ringing stays `active` but is no longer `held`, so a same-pitch
    /// retrigger cannot bend the note the player already let go.
    pub held: bool,
    pub velocity: f32,
    pub frequency: f32,

    osc: WavetableOsc,
    polyblep_osc: PolyBlepOsc,
    unison_osc: UnisonOsc,
    noise_gen: NoiseGen,
    filter: SvfFilter,
    moog_filter: MoogLadder,
    diode_filter: DiodeLadder,
    formant_filter: FormantFilter,
    ms20_filter: Ms20Filter,
    sem_filter: SemFilter,
    fm_engine: FmEngine,
    ks_engine: Option<Box<KarplusStrong>>,
    granular_engine: Option<Box<GranularEngine>>,
    additive: Option<Box<AdditiveEngine>>,
    sampler: Option<Box<SamplerEngine>>,
    amp_env: Envelope,
    filter_env: Envelope,
    lfo: Lfo,
    audio_lfo: Lfo, // Second LFO for audio-rate modulation (up to 5000 Hz)
    spectral_warp: SpectralWarp,
    mseg: Mseg,
    step_seq: StepSequencer,
    lorenz: LorenzMod,
    perlin: PerlinMod,

    // Engine selection: 0=wavetable, 1=polyblep, 2=FM, 3=karplus-strong, 4=granular, 5=additive, 6=sampler
    pub engine: u8,

    // Portamento / glide
    target_freq: f32,
    current_freq: f32,
    glide_coeff: f32,

    // Noise mix
    noise_level: f32,

    // Unison params
    unison_voices: usize,
    unison_detune: f32,
    unison_spread: f32,

    // Analog drift simulation
    drift_phase: f32,
    drift_value: f32,
    drift_amount: f32, // 0-1, maps to 0-5 cents of random drift

    // MPE per-note expression (audit MD-2). Continuous, per-voice, held for the
    // note's whole lifetime. Every neutral default is the identity, so a note
    // that carries no expression renders exactly as it did before.
    /// Member-channel pitch bend in semitones (MPE member default range ±48).
    expr_bend_semitones: f32,
    /// Channel pressure, 0..1. Adds gain on top of velocity.
    expr_pressure: f32,
    /// Timbre / CC74 slide, bipolar -1..1 with 0 neutral. Scales filter cutoff.
    expr_slide: f32,

    // Stealing fade
    steal_fade: f32,
    stealing: bool,
}

impl Voice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            active: false,
            note: 0,
            channel: 0,
            held: false,
            velocity: 0.0,
            frequency: 440.0,
            osc: WavetableOsc::new(),
            polyblep_osc: PolyBlepOsc::new(),
            unison_osc: UnisonOsc::new(),
            noise_gen: NoiseGen::new(),
            filter: SvfFilter::new(),
            moog_filter: MoogLadder::new(),
            diode_filter: DiodeLadder::new(),
            formant_filter: FormantFilter::new(),
            ms20_filter: Ms20Filter::new(),
            sem_filter: SemFilter::new(),
            fm_engine: FmEngine::new(),
            ks_engine: Some(Box::new(KarplusStrong::new(sample_rate))),
            granular_engine: Some(Box::new(GranularEngine::new())),
            additive: Some(Box::new(AdditiveEngine::new())),
            sampler: Some(Box::new(SamplerEngine::new())),
            amp_env: Envelope::new(sample_rate),
            filter_env: Envelope::new(sample_rate),
            lfo: Lfo::new(),
            audio_lfo: Lfo::new(),
            spectral_warp: SpectralWarp::new(),
            mseg: Mseg::new(sample_rate),
            step_seq: StepSequencer::new(),
            lorenz: LorenzMod::new(),
            perlin: PerlinMod::new(),
            engine: 0,
            // Both are overwritten by `note_on` before the voice can render a
            // sample — it is the only thing that sets `active` — so neither
            // value is ever heard. They are not a starting pitch.
            target_freq: 440.0,
            current_freq: 440.0,
            glide_coeff: 1.0,
            noise_level: 0.0,
            drift_phase: 0.0,
            drift_value: 0.0,
            drift_amount: 0.0,
            expr_bend_semitones: 0.0,
            expr_pressure: 0.0,
            expr_slide: 0.0,
            unison_voices: 1,
            unison_detune: 0.0,
            unison_spread: 0.5,
            steal_fade: 1.0,
            stealing: false,
        }
    }

    /// Start a note.
    ///
    /// `glide_origin` is the pitch the note's glide starts from, and it is a
    /// parameter rather than a separate setter so that **there is no way to
    /// start a note without stating it**. It used to be its own
    /// `set_glide_origin` call that `Layer::note_on_with_channel` made just
    /// before this one, which left `current_freq`'s 440 Hz construction seed
    /// reachable by any second call site that forgot the extra step — silently,
    /// only under glide, and only in the polyphonic cases nobody catches by ear.
    /// That is exactly how the original defect survived, so the shape that
    /// allowed it is gone rather than merely unused.
    pub fn note_on(
        &mut self,
        note: u8,
        channel: u8,
        velocity: f32,
        glide_origin: f32,
        sample_rate: f32,
    ) {
        // Before the snap check below, which overrides it when there is no
        // glide to run.
        self.current_freq = glide_origin;
        self.active = true;
        self.note = note;
        self.channel = channel;
        self.held = true;
        self.velocity = velocity;
        // A fresh note starts from neutral expression; the controller's
        // opening bend/pressure/timbre arrives as its own expression message.
        self.expr_bend_semitones = 0.0;
        self.expr_pressure = 0.0;
        self.expr_slide = 0.0;
        let new_freq = note_frequency(note);
        self.target_freq = new_freq;
        self.frequency = new_freq;
        // If no portamento (glide_coeff == 1.0), snap immediately
        if self.glide_coeff >= 0.999 {
            self.current_freq = new_freq;
        }
        self.osc.reset_phase();
        self.polyblep_osc.reset_phase();
        self.unison_osc.reset_phase();
        self.amp_env = Envelope::new(sample_rate);
        self.filter_env = Envelope::new(sample_rate);
        // Start the envelopes — they begin in Attack state
        self.amp_env.note_on();
        self.filter_env.note_on();
        self.lfo.reset();
        self.audio_lfo.reset();
        self.lorenz.reset();
        self.perlin.reset();
        self.mseg.note_on();
        self.step_seq.reset();
        self.steal_fade = 1.0;
        self.stealing = false;
        self.filter.reset();
        self.moog_filter.reset();
        self.diode_filter.reset();
        self.formant_filter.reset();
        self.ms20_filter.reset();
        self.sem_filter.reset();
        self.fm_engine.reset();
        if let Some(ks) = &mut self.ks_engine {
            ks.reset();
        }
        if let Some(gr) = &mut self.granular_engine {
            gr.reset();
        }
        if let Some(ad) = &mut self.additive {
            ad.reset();
        }

        let pitch_ratio = 2.0f32.powf((note as f32 - 60.0) / 12.0);
        if let Some(sp) = &mut self.sampler {
            sp.trigger(pitch_ratio);
        }
    }

    /// Set portamento time in seconds. 0 = no portamento.
    pub fn set_portamento(&mut self, time_s: f32, sample_rate: f32) {
        if time_s <= 0.001 {
            self.glide_coeff = 1.0;
        } else {
            self.glide_coeff = 1.0 - (-std::f32::consts::TAU / (time_s * sample_rate)).exp();
        }
    }

    /// Set noise parameters.
    pub fn set_noise(&mut self, level: f32, color: u8) {
        self.noise_level = level.clamp(0.0, 1.0);
        self.noise_gen.color = color.min(2);
    }

    /// Set engine type: 0=wavetable, 1=polyblep, 2=FM, 3=karplus-strong, 4=granular, 5=additive, 6=sampler.
    pub fn set_engine(&mut self, engine: u8, _sample_rate: f32) {
        self.engine = engine.min(6);
    }

    /// Set sampler engine parameters.
    pub fn set_sampler_params(&mut self, mode: u8, start: f32, end: f32) {
        if let Some(sp) = &mut self.sampler {
            sp.set_mode(mode);
            sp.set_loop_points(start, end);
        }
    }

    /// Set analog drift amount (0-1).
    pub fn set_drift(&mut self, amount: f32) {
        self.drift_amount = amount.clamp(0.0, 1.0);
    }

    /// Set additive engine parameters.
    pub fn set_additive_partials(&mut self, n: usize) {
        if let Some(ad) = &mut self.additive {
            ad.set_num_partials(n);
        }
    }

    pub fn set_additive_tilt(&mut self, tilt: f32) {
        if let Some(ad) = &mut self.additive {
            ad.set_tilt(tilt);
        }
    }

    pub fn set_additive_odd(&mut self, emphasis: f32) {
        if let Some(ad) = &mut self.additive {
            ad.set_odd_emphasis(emphasis);
        }
    }

    pub fn set_additive_inharm(&mut self, inharm: f32) {
        if let Some(ad) = &mut self.additive {
            ad.set_inharmonicity(inharm);
        }
    }

    /// Excite the Karplus-Strong engine (call at note-on time).
    pub fn excite_ks(&mut self, freq: f32, sample_rate: f32, brightness: f32) {
        if let Some(ks) = &mut self.ks_engine {
            ks.excite(freq, sample_rate, brightness);
        }
    }

    pub fn trigger_sampler(&mut self, pitch_ratio: f32) {
        if let Some(sp) = &mut self.sampler {
            sp.trigger(pitch_ratio);
        }
    }

    /// Set Karplus-Strong damping parameter.
    pub fn set_ks_damping(&mut self, damping: f32) {
        if let Some(ks) = &mut self.ks_engine {
            ks.set_damping(damping);
        }
    }

    /// Set granular engine parameters.
    pub fn set_granular_params(
        &mut self,
        density: f32,
        grain_size: f32,
        position: f32,
        spray: f32,
        pitch_var: f32,
        pan_spread: f32,
    ) {
        if let Some(gr) = &mut self.granular_engine {
            gr.density = density;
            gr.grain_size = grain_size;
            gr.position = position;
            gr.spray = spray;
            gr.pitch_var = pitch_var;
            gr.pan_spread = pan_spread;
        }
    }

    /// Set unison parameters.
    pub fn set_unison(&mut self, voices: usize, detune: f32, spread: f32) {
        self.unison_voices = voices.clamp(1, 16);
        self.unison_detune = detune.clamp(0.0, 100.0);
        self.unison_spread = spread.clamp(0.0, 1.0);
        self.unison_osc.set_voices(self.unison_voices);
        self.unison_osc.set_detune(self.unison_detune);
        self.unison_osc.set_spread(self.unison_spread);
    }

    /// Select the waveform every oscillator path reads: 0=sine, 1=saw,
    /// 2=square, 3=triangle, matching the order `MasterSynth` builds its
    /// wavetables in.
    ///
    /// All three oscillators are set unconditionally because `Voice::render`
    /// chooses between them per block — on the engine, and on
    /// `unison_voices > 1` — so whichever ones are idle now may be the one
    /// rendering next block.
    pub fn set_waveform(&mut self, index: u8) {
        let index = usize::from(index);
        self.osc.set_waveform(index);
        self.unison_osc.set_waveform(index);
        self.polyblep_osc.set_waveform(index);
    }

    /// Configure FM engine parameters.
    pub fn configure_fm(
        &mut self,
        algorithm: u8,
        ratios: &[f32; 4],
        levels: &[f32; 4],
        feedback: f32,
        mod_amount: f32,
    ) {
        if self.fm_engine.algorithm != algorithm {
            self.fm_engine.set_algorithm(algorithm);
        }
        for i in 0..4 {
            self.fm_engine.set_ratio(i, ratios[i]);
            self.fm_engine.set_level(i, levels[i]);
        }
        self.fm_engine.set_feedback(0, feedback);
        // Scale all non-zero modulation matrix entries by mod_amount
        for from in 0..4 {
            for to in 0..4 {
                if self.fm_engine.matrix[from][to].abs() > 0.001 {
                    // The algorithm sets 1.0 as base; scale by mod_amount
                    let base = if self.fm_engine.matrix[from][to] > 0.0 {
                        1.0
                    } else {
                        -1.0
                    };
                    self.fm_engine.matrix[from][to] = base * mod_amount;
                }
            }
        }
    }

    /// Set the pulse width on the PolyBLEP oscillator.
    pub fn set_pulse_width(&mut self, pw: f32) {
        self.polyblep_osc.set_pulse_width(pw);
    }

    /// Apply MPE per-note expression to this sounding voice (audit MD-2).
    ///
    /// `bend_semitones` is the member-channel pitch bend, `pressure` the
    /// channel pressure in 0..1 and `slide` the CC74 timbre in -1..1 with 0
    /// neutral. Values are held until the next expression message or note-on;
    /// the render loop reads them at block rate, so this allocates nothing and
    /// is safe to call from the audio thread's message drain.
    pub fn set_expression(&mut self, bend_semitones: f32, pressure: f32, slide: f32) {
        self.expr_bend_semitones = bend_semitones.clamp(-96.0, 96.0);
        self.expr_pressure = pressure.clamp(0.0, 1.0);
        self.expr_slide = slide.clamp(-1.0, 1.0);
    }

    /// Current per-note expression as (bend semitones, pressure, slide).
    pub fn expression(&self) -> (f32, f32, f32) {
        (
            self.expr_bend_semitones,
            self.expr_pressure,
            self.expr_slide,
        )
    }

    pub fn note_off(&mut self) {
        // The voice keeps rendering its release tail, so `active` stays true —
        // but it is no longer the note the player is holding, and per-note
        // expression must stop addressing it (audit MD-2).
        self.held = false;
        self.amp_env.note_off();
        self.filter_env.note_off();
        self.mseg.note_off();
    }

    pub fn start_steal(&mut self) {
        self.stealing = true;
    }

    /// Remaining gain multiplier of the de-click fade, 1.0 before it starts and
    /// decaying towards zero once `start_steal` has been called.
    pub fn steal_fade(&self) -> f32 {
        self.steal_fade
    }

    /// Silence the voice at once and hand its slot back.
    ///
    /// This is the one path that does cut a waveform, so it exists only for
    /// cases where there is nothing left to fade into: a hard reset, or a
    /// crossfade slot that has to be recycled because every one of them is
    /// still sounding.
    pub fn kill(&mut self) {
        self.active = false;
        self.held = false;
        self.stealing = false;
        self.steal_fade = 1.0;
    }

    pub fn get_amp_level(&self) -> f32 {
        self.amp_env.get_level()
    }

    pub fn is_active(&self) -> bool {
        self.active && (self.amp_env.is_active() || self.stealing)
    }

    /// Update envelope time/level parameters without restarting them.
    pub fn set_envelopes(
        &mut self,
        amp_a: f32,
        amp_d: f32,
        amp_s: f32,
        amp_r: f32,
        filt_a: f32,
        filt_d: f32,
        filt_s: f32,
        filt_r: f32,
    ) {
        self.amp_env.set_params(amp_a, amp_d, amp_s, amp_r);
        self.filter_env.set_params(filt_a, filt_d, filt_s, filt_r);
    }

    /// Render a block of samples into the output buffers.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32], p: &VoiceParams) {
        if !self.is_active() {
            return;
        }

        let block_size = left.len();

        // ── Per-block setup (control rate) ──────────────────────────────

        self.filter.set_drive(p.filter_drive);
        self.filter.set_mode(p.filter_mode);
        self.moog_filter.set_drive(p.filter_drive);
        self.diode_filter.set_drive(p.filter_drive);
        self.formant_filter.set_drive(p.filter_drive);
        self.ms20_filter.set_drive(p.filter_drive);
        self.sem_filter.set_drive(p.filter_drive);

        self.lfo.set_shape(match p.lfo_shape {
            1 => LfoShape::Triangle,
            2 => LfoShape::Saw,
            3 => LfoShape::Square,
            _ => LfoShape::Sine,
        });

        // Pre-compute pitch offset ratio (only when non-zero — powf is expensive)
        let pitch_offset = p.osc_coarse + p.osc_fine / 100.0;
        let pitch_offset_ratio = if pitch_offset.abs() > 0.001 {
            2.0f32.powf(pitch_offset / 12.0)
        } else {
            1.0
        };

        // Key tracking ratio (once per block, not per sample)
        let keytrack_ratio = if p.filter_keytrack > 0.001 {
            2.0f32.powf((self.note as f32 - 60.0) / 12.0 * p.filter_keytrack)
        } else {
            1.0
        };

        let has_noise = self.noise_level > 0.001;
        let has_unison = self.unison_voices > 1;
        let has_lfo_filter = p.lfo_filter_amount.abs() > 0.001;
        let has_mseg_filter = p.mseg_to_filter.abs() > 0.001;
        let has_seq_pitch = p.seq_to_pitch.abs() > 0.001;

        // MPE per-note expression, resolved once per block (audit MD-2):
        //  • bend  → octaves added to the per-sample pitch modulation
        //  • slide → filter cutoff ratio, ±2 octaves around the patch cutoff
        //  • pressure → linear gain on top of velocity, up to +6 dB
        // A voice with neutral expression yields 0.0 / 1.0 / 1.0 and the inner
        // loop behaves exactly as before.
        let expr_bend_octaves = self.expr_bend_semitones / 12.0;
        let expr_cutoff_ratio = if self.expr_slide.abs() > 0.001 {
            2.0f32.powf(self.expr_slide * 2.0)
        } else {
            1.0
        };
        let expr_gain = 1.0 + self.expr_pressure;

        let base_cutoff_kt = p.base_cutoff * keytrack_ratio * expr_cutoff_ratio;

        // Time-domain warp setup (per-block)
        self.spectral_warp.set_mode(p.warp_mode);
        self.spectral_warp.set_amount(p.warp_amount);
        let has_warp = p.warp_mode > 0 && p.warp_amount > 0.001;
        let has_audio_mod = p.audio_mod_depth > 0.001 && p.audio_mod_target > 0;
        let has_chaos = p.chaos_amount > 0.001;
        if has_chaos {
            self.lorenz.set_speed(p.chaos_speed);
            self.perlin.set_speed(p.chaos_speed);
        }

        // Cache drift ratio for the block — drift_value smoothing coefficient (0.001)
        // changes negligibly within a 128-sample block, so one powf per block instead
        // of per sample is perceptually identical and avoids a hot powf in the inner loop.
        let drift_ratio = if self.drift_amount > 0.001 {
            let drift_cents = self.drift_amount * 5.0 * self.drift_value;
            2.0f32.powf(drift_cents / 1200.0)
        } else {
            1.0
        };

        // ── Per-sample inner loop ───────────────────────────────────────

        for i in 0..block_size {
            // Portamento
            self.current_freq += self.glide_coeff * (self.target_freq - self.current_freq);

            // Envelopes
            let amp = self.amp_env.tick();
            let filt_env = self.filter_env.tick();
            let lfo_val = self.lfo.tick(p.lfo_rate, p.sample_rate);
            let mseg_val = self.mseg.tick();
            let seq_val = self.step_seq.tick(p.seq_rate, p.sample_rate);

            // Modulation (control-rate is fine at 128-sample blocks = ~344 Hz)
            let mods = p.mod_matrix.evaluate(
                amp,
                filt_env,
                lfo_val,
                0.0,
                self.velocity,
                mseg_val,
                seq_val,
            );

            // Step seq pitch modulation
            let seq_pitch_mod = if has_seq_pitch {
                seq_val * p.seq_to_pitch
            } else {
                0.0
            };

            // Audio-rate modulation: tick the audio LFO every sample
            let audio_mod = if has_audio_mod {
                self.audio_lfo.tick(p.audio_mod_rate, p.sample_rate) * p.audio_mod_depth
            } else {
                0.0
            };

            // Audio-rate FM: add to pitch modulation if target == 1
            let audio_fm_mod = if has_audio_mod && p.audio_mod_target == 1 {
                audio_mod
            } else {
                0.0
            };

            // Chaos modulators: Lorenz X → pitch drift, Lorenz Y → filter cutoff, Perlin → amplitude tremolo
            let (chaos_pitch, chaos_filter, chaos_amp) = if has_chaos {
                let (lorenz_x, lorenz_y) = self.lorenz.tick(p.sample_rate);
                let perlin = self.perlin.tick(p.sample_rate);
                (
                    lorenz_x * p.chaos_amount * 0.1, // up to ~1.2 semitones of pitch drift
                    lorenz_y * p.chaos_amount * 0.5, // filter cutoff variation
                    perlin * p.chaos_amount * 0.3,   // amplitude tremolo
                )
            } else {
                (0.0, 0.0, 0.0)
            };

            // Pitch with modulation — avoid powf when no mod
            let total_pitch_mod =
                mods.pitch + seq_pitch_mod + audio_fm_mod + chaos_pitch + expr_bend_octaves;
            let freq_before_drift = if total_pitch_mod.abs() > 0.0001 {
                self.current_freq * pitch_offset_ratio * 2.0f32.powf(total_pitch_mod)
            } else {
                self.current_freq * pitch_offset_ratio
            };

            // Analog drift simulation (very slow random LFO, ~0.3Hz)
            // drift_ratio is pre-computed per block above — drift_value barely moves per sample.
            let freq = if self.drift_amount > 0.001 {
                self.drift_phase += 0.3 / p.sample_rate;
                if self.drift_phase >= 1.0 {
                    self.drift_phase -= 1.0;
                }
                let drift_lfo = (self.drift_phase * core::f32::consts::TAU * 1.7).sin() * 0.7
                    + (self.drift_phase * core::f32::consts::TAU * 0.6).sin() * 0.3;
                self.drift_value += 0.001 * (drift_lfo - self.drift_value); // very slow smoothing
                freq_before_drift * drift_ratio
            } else {
                freq_before_drift
            };

            // Oscillator.
            //
            // The third element is the branch's own statement of whether it
            // produced a *stereo pair* — two channels carrying a pan — or two
            // copies of one signal. The filter below sums to mono and the
            // output stage restores the L/R balance only for the branches that
            // say `true`, so this is what decides whether an engine's pan
            // survives.
            //
            // It is the branch's word rather than a comparison of the two
            // values because a comparison is wrong twice over. Two of these
            // engines emit `(s, s)` and would never trip it however stereo they
            // became; and `SpectralWarp::process` is stateful — its `Quantize`
            // mode holds a sample-and-hold counter — and is called once per
            // channel below, so on a *mono* engine with warp engaged the two
            // channels diverge without either of them meaning a stereo
            // position. Restoring a "balance" from that divergence would turn a
            // bit-crusher into a random panner.
            let (mut osc_l, mut osc_r, osc_is_stereo) = if self.engine == 3 {
                // Karplus-Strong: one string, one signal.
                let s = self.ks_engine.as_mut().map(|ks| ks.tick()).unwrap_or(0.0);
                (s, s, false)
            } else if self.engine == 4 {
                // Granular: `GranularEngine::tick` pans every grain across the
                // pair by `grain_pan_spread`. This is the pan that used to be
                // computed and then discarded here.
                let (gl, gr) = self
                    .granular_engine
                    .as_mut()
                    .map(|gr| gr.tick(freq, p.sample_rate, p.tables))
                    .unwrap_or((0.0, 0.0));
                (gl, gr, true)
            } else if self.engine == 5 {
                // Additive: `AdditiveEngine::tick` returns one f32.
                let s = self
                    .additive
                    .as_mut()
                    .map(|ad| ad.tick(freq, p.sample_rate))
                    .unwrap_or(0.0);
                (s, s, false)
            } else if self.engine == 6 {
                // Sampler: `SamplerEngine::tick` returns one f32.
                let s = self
                    .sampler
                    .as_mut()
                    .map(|sp| sp.tick(p.sample_rate))
                    .unwrap_or(0.0);
                (s, s, false)
            } else if has_unison {
                // Unison bank: `unison_spread` pans the detuned copies. The
                // original — and until now the only — stereo source here.
                let mut ul = 0.0f32;
                let mut ur = 0.0f32;
                self.unison_osc.process_sample_stereo(
                    freq,
                    p.sample_rate,
                    p.tables,
                    &mut ul,
                    &mut ur,
                );
                (ul, ur, true)
            } else {
                // Wavetable / analog / FM, single oscillator.
                let s = match self.engine {
                    1 => self.polyblep_osc.tick(freq, p.sample_rate),
                    2 => self.fm_engine.tick(freq, p.sample_rate),
                    _ => self.osc.tick(freq, p.sample_rate, p.tables),
                };
                (s, s, false)
            };

            // Time-domain warp — apply to oscillator output using current phase
            if has_warp {
                let phase = match self.engine {
                    1 => self.polyblep_osc.phase(),
                    _ => {
                        if has_unison {
                            self.unison_osc.phase()
                        } else {
                            self.osc.phase()
                        }
                    }
                };
                osc_l = self.spectral_warp.process(osc_l, phase);
                osc_r = self.spectral_warp.process(osc_r, phase);
            }

            // Audio-rate AM/ring modulation: multiply amplitude if target == 2
            if has_audio_mod && p.audio_mod_target == 2 {
                let am = 1.0 + audio_mod; // modulate around unity
                osc_l *= am;
                osc_r *= am;
            }

            // Oscillator level
            osc_l *= p.osc_level;
            osc_r *= p.osc_level;

            // Noise
            if has_noise {
                let n = self.noise_gen.tick() * self.noise_level;
                osc_l += n;
                osc_r += n;
            }

            // Filter cutoff with mod matrix + LFO→filter + MSEG→filter + keytracking
            let lfo_filter_mod = if has_lfo_filter {
                lfo_val * p.lfo_filter_amount * 2.0
            } else {
                0.0
            };
            let mseg_filter_mod = if has_mseg_filter {
                mseg_val * p.mseg_to_filter * 4.0
            } else {
                0.0
            };
            // Audio-rate filter modulation: add to cutoff if target == 3
            let audio_filter_mod = if has_audio_mod && p.audio_mod_target == 3 {
                audio_mod * 2.0
            } else {
                0.0
            };
            let cutoff = (base_cutoff_kt
                * (1.0
                    + mods.filter_cutoff * 4.0
                    + lfo_filter_mod
                    + mseg_filter_mod
                    + audio_filter_mod
                    + chaos_filter))
                .clamp(20.0, 20000.0);
            let res = (p.resonance + mods.filter_resonance).clamp(0.5, 20.0);

            // Filter — mono (sum L+R, filter once, then split back)
            // This is cheaper than filtering twice and avoids filter state corruption
            let mono = (osc_l + osc_r) * 0.5;
            let filtered = match p.filter_model {
                1 => self.moog_filter.process(mono, cutoff, res, p.sample_rate),
                2 => self.diode_filter.process(mono, cutoff, res, p.sample_rate),
                3 => {
                    // Map cutoff knob (20–20000 Hz) to vowel morph (0–4)
                    let morph = cutoff / 5000.0 * 4.0;
                    self.formant_filter.process(mono, morph, res, p.sample_rate)
                }
                4 => self.ms20_filter.process(mono, cutoff, res, p.sample_rate),
                5 => {
                    // Map filter_mode (0-3) to morph (0.0-1.0)
                    let mode_val = match p.filter_mode {
                        FilterMode::Lowpass => 0.0,
                        FilterMode::Highpass => 1.0,
                        FilterMode::Bandpass => 2.0,
                        FilterMode::Notch => 3.0,
                    };
                    let morph = mode_val / 3.0;
                    self.sem_filter
                        .process(mono, cutoff, res, morph, p.sample_rate)
                }
                _ => self.filter.process(mono, cutoff, res, p.sample_rate),
            };

            // Per-voice distortion (after filter, before mix)
            let filtered = if p.per_voice_drive > 0.001 {
                fast_tanh(filtered * (1.0 + p.per_voice_drive))
            } else {
                filtered
            };

            // Amplitude (with chaos tremolo from Perlin noise)
            let gain = amp * self.velocity * (1.0 + chaos_amp) * expr_gain;

            // Voice stealing fade
            if self.stealing {
                let steal_coeff = (-1.0 / (0.01 * p.sample_rate)).exp();
                self.steal_fade *= steal_coeff;
                if self.steal_fade < 0.001 {
                    self.active = false;
                    return;
                }
            }

            let g = gain * self.steal_fade;

            // Stereo output: preserve the L/R ratio the oscillator produced.
            //
            // The filter above runs on the mono sum — one filter instead of
            // two, and no risk of the two filter states drifting apart — which
            // throws the pan away, so it is reapplied here as a balance on the
            // filtered signal. `osc_is_stereo` is why this asks the oscillator
            // branch rather than just comparing the channels; see the comment
            // on that tuple.
            //
            // The gate used to read `has_unison`. That made this the unison
            // bank's path and discarded the granular engine's per-grain pan —
            // but only at one unison voice. Above one the gate was already true,
            // so a granular patch with a unison bank did pan, and that render is
            // byte-identical across this change. What was silently mono was the
            // *shipped default* of `unison_voices == 1`: there,
            // `grain_pan_spread` driven 0 → 1 over 96 quanta moved the render by
            // 6.7e-5 total absolute sample difference against an RMS of 6.4e-2 —
            // float rounding, not audio.
            //
            // **What this restores is a balance, not the original pair.** The
            // mid is exact — the two weights sum to 1, so `L + R` is the mono
            // signal whatever the pan — but the side is
            // `(l + r)·(|l| − |r|)/(|l| + |r|)`, which equals `l − r` only while
            // a single source occupies the pair. For the unison bank that is
            // never exactly true; for granular it holds while grains do not
            // overlap and degrades as they do. Measured with the filter removed:
            // 0.01% error at density 20 / 50 ms, 14.6% at 20 / 200 ms, 48.3% at
            // 100 / 500 ms — and the device panel reaches all of those. It is
            // still strictly better than the mono sum it replaces, which was
            // 100% wrong at every density. A faithful pair would need the filter
            // run twice.
            //
            // The mid, by contrast, **is** exact, and that is a property of the
            // gate rather than of the arithmetic. The divisor used to be
            // `.max(0.001)`, which is not a no-op: the condition above only
            // establishes `sum >= |osc_l - osc_r| > 0.0001`, ten times *under*
            // that floor, so a pair landing in the gap was divided by a number
            // larger than itself and its two weights summed to less than 1 —
            // silently attenuating the mono signal. It reads like a
            // near-silence guard and is not one, because `filtered` is the
            // **filter's** output, not the oscillator's: between grains the raw
            // pair collapses while the filter is still ringing, so the
            // attenuation lands on a ringing tail at a perfectly audible level.
            // On the shipped Breadcrumb Glitch patch — 15 ms grains at density
            // 80, i.e. a low duty cycle — the worst-hit samples sat at
            // -23.5 dBFS and moved by up to 76% of the local mid, a mid residue
            // 20.7x the bound this file's guard allows. It tracks grain duty
            // cycle, not level, which is why a probe at the default 50 ms /
            // density 20 never sees it.
            //
            // So the floor is gone and the sub-threshold case takes the centred
            // branch instead. `sum > MIN_BALANCE_SUM` is a division-safety
            // invariant rather than a behavioural branch: it is unreachable
            // while the condition beside it holds, since `|a| + |b| >= |a - b|`
            // puts `sum` above 0.0001 already. It is here so the division stays
            // safe on its own terms if that condition is ever loosened, and it
            // is deliberately far below the point where either weight would
            // round oddly.
            let sum = osc_l.abs() + osc_r.abs();
            if osc_is_stereo && (osc_l - osc_r).abs() > 0.0001 && sum > MIN_BALANCE_SUM {
                // Scale filtered output by original L/R balance
                left[i] += filtered * (osc_l.abs() / sum) * 2.0 * g;
                right[i] += filtered * (osc_r.abs() / sum) * 2.0 * g;
            } else {
                left[i] += filtered * g;
                right[i] += filtered * g;
            }
        }

        // Deactivate if envelope finished
        if !self.amp_env.is_active() && !self.stealing {
            self.active = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{note_frequency, Voice};

    #[test]
    fn note_on_clears_expression_so_a_recycled_voice_starts_neutral() {
        let mut voice = Voice::new(48_000.0);
        voice.note_on(69, 0, 0.8, note_frequency(69), 48_000.0);
        voice.set_expression(12.0, 1.0, -1.0);
        assert_eq!(voice.expr_bend_semitones, 12.0);
        assert_eq!(voice.expr_pressure, 1.0);
        assert_eq!(voice.expr_slide, -1.0);

        // Voice stealing hands the same struct to a different MIDI note, so a
        // stale bend would detune an unrelated note (audit MD-2).
        voice.note_on(60, 0, 0.8, note_frequency(60), 48_000.0);
        assert_eq!(voice.expr_bend_semitones, 0.0);
        assert_eq!(voice.expr_pressure, 0.0);
        assert_eq!(voice.expr_slide, 0.0);
    }

    #[test]
    fn set_expression_clamps_to_the_documented_ranges() {
        let mut voice = Voice::new(48_000.0);
        voice.set_expression(500.0, 4.0, 9.0);
        assert_eq!(voice.expr_bend_semitones, 96.0);
        assert_eq!(voice.expr_pressure, 1.0);
        assert_eq!(voice.expr_slide, 1.0);

        voice.set_expression(-500.0, -4.0, -9.0);
        assert_eq!(voice.expr_bend_semitones, -96.0);
        assert_eq!(voice.expr_pressure, 0.0);
        assert_eq!(voice.expr_slide, -1.0);
    }
}
