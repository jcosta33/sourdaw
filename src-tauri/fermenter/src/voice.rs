/// Single synthesizer voice — owns oscillator, filter, envelopes, LFO.

use crate::additive::AdditiveEngine;
use crate::chaos::{LorenzMod, PerlinMod};
use crate::envelope::Envelope;
use crate::filter::{fast_tanh, FilterMode, SvfFilter, MoogLadder, DiodeLadder, FormantFilter, Ms20Filter, SemFilter};
use crate::fm::FmEngine;
use crate::granular::GranularEngine;
use crate::lfo::{Lfo, LfoShape};
use crate::modulation::ModMatrix;
use crate::mseg::Mseg;
use crate::noise::NoiseGen;
use crate::oscillator::{PolyBlepOsc, UnisonOsc, WavetableOsc, Wavetable};
use crate::physical::KarplusStrong;
use crate::sampler::SamplerEngine;
use crate::spectral::SpectralWarp;
use crate::stepseq::StepSequencer;

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
    pub audio_mod_rate: f32,     // 0-5000 Hz
    pub audio_mod_depth: f32,    // 0-1
    pub audio_mod_target: u8,    // 0=off, 1=pitch(FM), 2=amplitude(AM), 3=filter
    pub chaos_amount: f32,       // 0-1, how much Lorenz/Perlin modulates
    pub chaos_speed: f32,        // 0.01-10, speed of chaos modulators
}

pub struct Voice {
    pub active: bool,
    pub note: u8,
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
    ks_engine: KarplusStrong,
    granular_engine: GranularEngine,
    additive: AdditiveEngine,
    sampler: SamplerEngine,
    amp_env: Envelope,
    filter_env: Envelope,
    lfo: Lfo,
    audio_lfo: Lfo,          // Second LFO for audio-rate modulation (up to 5000 Hz)
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

    // Stealing fade
    steal_fade: f32,
    stealing: bool,
}

impl Voice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            active: false,
            note: 0,
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
            ks_engine: KarplusStrong::new(sample_rate),
            granular_engine: GranularEngine::new(),
            additive: AdditiveEngine::new(),
            sampler: SamplerEngine::new(),
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
            target_freq: 440.0,
            current_freq: 440.0,
            glide_coeff: 1.0,
            noise_level: 0.0,
            drift_phase: 0.0,
            drift_value: 0.0,
            drift_amount: 0.0,
            unison_voices: 1,
            unison_detune: 0.0,
            unison_spread: 0.5,
            steal_fade: 1.0,
            stealing: false,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32, sample_rate: f32) {
        self.active = true;
        self.note = note;
        self.velocity = velocity;
        let new_freq = 440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0);
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
        self.ks_engine.reset();
        self.granular_engine.reset();
        self.additive.reset();
        // Trigger sampler with pitch ratio based on MIDI note (C4 = 60 = original pitch)
        let pitch_ratio = 2.0f32.powf((note as f32 - 60.0) / 12.0);
        self.sampler.trigger(pitch_ratio);
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
    pub fn set_engine(&mut self, engine: u8) {
        self.engine = engine.min(6);
    }

    /// Set sampler engine parameters.
    pub fn set_sampler_params(&mut self, mode: u8, start: f32, end: f32) {
        self.sampler.set_mode(mode);
        self.sampler.set_loop_points(start, end);
    }

    /// Set analog drift amount (0-1).
    pub fn set_drift(&mut self, amount: f32) {
        self.drift_amount = amount.clamp(0.0, 1.0);
    }

    /// Set additive engine parameters.
    pub fn set_additive_partials(&mut self, n: usize) {
        self.additive.set_num_partials(n);
    }

    pub fn set_additive_tilt(&mut self, tilt: f32) {
        self.additive.set_tilt(tilt);
    }

    pub fn set_additive_odd(&mut self, emphasis: f32) {
        self.additive.set_odd_emphasis(emphasis);
    }

    pub fn set_additive_inharm(&mut self, inharm: f32) {
        self.additive.set_inharmonicity(inharm);
    }

    /// Excite the Karplus-Strong engine (call at note-on time).
    pub fn excite_ks(&mut self, freq: f32, sample_rate: f32, brightness: f32) {
        self.ks_engine.excite(freq, sample_rate, brightness);
    }

    pub fn trigger_sampler(&mut self, pitch_ratio: f32) {
        self.sampler.trigger(pitch_ratio);
    }

    /// Set Karplus-Strong damping parameter.
    pub fn set_ks_damping(&mut self, damping: f32) {
        self.ks_engine.set_damping(damping);
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
        self.granular_engine.density = density;
        self.granular_engine.grain_size = grain_size;
        self.granular_engine.position = position;
        self.granular_engine.spray = spray;
        self.granular_engine.pitch_var = pitch_var;
        self.granular_engine.pan_spread = pan_spread;
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
                    let base = if self.fm_engine.matrix[from][to] > 0.0 { 1.0 } else { -1.0 };
                    self.fm_engine.matrix[from][to] = base * mod_amount;
                }
            }
        }
    }

    /// Set the pulse width on the PolyBLEP oscillator.
    pub fn set_pulse_width(&mut self, pw: f32) {
        self.polyblep_osc.set_pulse_width(pw);
    }

    pub fn note_off(&mut self) {
        self.amp_env.note_off();
        self.filter_env.note_off();
        self.mseg.note_off();
    }

    pub fn start_steal(&mut self) {
        self.stealing = true;
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
        amp_a: f32, amp_d: f32, amp_s: f32, amp_r: f32,
        filt_a: f32, filt_d: f32, filt_s: f32, filt_r: f32,
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
        let base_cutoff_kt = p.base_cutoff * keytrack_ratio;

        // Spectral warp setup (per-block)
        self.spectral_warp.set_mode(p.warp_mode);
        self.spectral_warp.set_amount(p.warp_amount);
        let has_warp = p.warp_mode > 0 && p.warp_amount > 0.001;
        let has_audio_mod = p.audio_mod_depth > 0.001 && p.audio_mod_target > 0;
        let has_chaos = p.chaos_amount > 0.001;
        if has_chaos {
            self.lorenz.set_speed(p.chaos_speed);
            self.perlin.set_speed(p.chaos_speed);
        }

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
            let mods = p.mod_matrix.evaluate(amp, filt_env, lfo_val, 0.0, self.velocity, mseg_val, seq_val);

            // Step seq pitch modulation
            let seq_pitch_mod = if has_seq_pitch { seq_val * p.seq_to_pitch } else { 0.0 };

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
                    lorenz_x * p.chaos_amount * 0.1,   // up to ~1.2 semitones of pitch drift
                    lorenz_y * p.chaos_amount * 0.5,    // filter cutoff variation
                    perlin * p.chaos_amount * 0.3,      // amplitude tremolo
                )
            } else {
                (0.0, 0.0, 0.0)
            };

            // Pitch with modulation — avoid powf when no mod
            let total_pitch_mod = mods.pitch + seq_pitch_mod + audio_fm_mod + chaos_pitch;
            let freq_before_drift = if total_pitch_mod.abs() > 0.0001 {
                self.current_freq * pitch_offset_ratio * 2.0f32.powf(total_pitch_mod)
            } else {
                self.current_freq * pitch_offset_ratio
            };

            // Analog drift simulation (very slow random LFO, ~0.3Hz)
            let freq = if self.drift_amount > 0.001 {
                self.drift_phase += 0.3 / p.sample_rate;
                if self.drift_phase >= 1.0 { self.drift_phase -= 1.0; }
                let drift_lfo = (self.drift_phase * core::f32::consts::TAU * 1.7).sin()
                    * 0.7 + (self.drift_phase * core::f32::consts::TAU * 0.6).sin() * 0.3;
                self.drift_value += 0.001 * (drift_lfo - self.drift_value); // very slow smoothing
                let drift_cents = self.drift_amount * 5.0 * self.drift_value;
                freq_before_drift * 2.0f32.powf(drift_cents / 1200.0)
            } else {
                freq_before_drift
            };

            // Oscillator
            let (mut osc_l, mut osc_r) = if self.engine == 3 {
                // Karplus-Strong: mono output, no unison
                let s = self.ks_engine.tick();
                (s, s)
            } else if self.engine == 4 {
                // Granular: native stereo output, no unison
                self.granular_engine.tick(freq, p.sample_rate, p.tables)
            } else if self.engine == 5 {
                // Additive: mono output, no unison
                let s = self.additive.tick(freq, p.sample_rate);
                (s, s)
            } else if self.engine == 6 {
                // Sampler: mono output, no unison
                let s = self.sampler.tick(p.sample_rate);
                (s, s)
            } else if has_unison {
                let mut ul = 0.0f32;
                let mut ur = 0.0f32;
                self.unison_osc.process_sample_stereo(freq, p.sample_rate, p.tables, &mut ul, &mut ur);
                (ul, ur)
            } else {
                let s = match self.engine {
                    1 => self.polyblep_osc.pulse(freq, p.sample_rate),
                    2 => self.fm_engine.tick(freq, p.sample_rate),
                    _ => self.osc.tick(freq, p.sample_rate, p.tables),
                };
                (s, s)
            };

            // Spectral warp — apply to oscillator output using current phase
            if has_warp {
                let phase = match self.engine {
                    1 => self.polyblep_osc.phase(),
                    _ => if has_unison { self.unison_osc.phase() } else { self.osc.phase() },
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
            let lfo_filter_mod = if has_lfo_filter { lfo_val * p.lfo_filter_amount * 2.0 } else { 0.0 };
            let mseg_filter_mod = if has_mseg_filter { mseg_val * p.mseg_to_filter * 4.0 } else { 0.0 };
            // Audio-rate filter modulation: add to cutoff if target == 3
            let audio_filter_mod = if has_audio_mod && p.audio_mod_target == 3 {
                audio_mod * 2.0
            } else {
                0.0
            };
            let cutoff = (base_cutoff_kt * (1.0 + mods.filter_cutoff * 4.0 + lfo_filter_mod + mseg_filter_mod + audio_filter_mod + chaos_filter))
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
                    self.sem_filter.process(mono, cutoff, res, morph, p.sample_rate)
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
            let gain = amp * self.velocity * (1.0 + chaos_amp);

            // Voice stealing fade
            if self.stealing {
                self.steal_fade *= 0.995;
                if self.steal_fade < 0.001 {
                    self.active = false;
                    return;
                }
            }

            let g = gain * self.steal_fade;

            // Stereo output: preserve the L/R ratio from unison panning
            if has_unison && (osc_l - osc_r).abs() > 0.0001 {
                // Scale filtered output by original L/R balance
                let sum = (osc_l.abs() + osc_r.abs()).max(0.001);
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
