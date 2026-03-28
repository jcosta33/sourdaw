/// Single synthesizer voice — owns oscillator, filter, envelopes, LFO.

use crate::envelope::Envelope;
use crate::filter::{FilterMode, SvfFilter};
use crate::lfo::Lfo;
use crate::modulation::ModMatrix;
use crate::noise::NoiseGen;
use crate::oscillator::{PolyBlepOsc, UnisonOsc, WavetableOsc, Wavetable};

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
    amp_env: Envelope,
    filter_env: Envelope,
    lfo: Lfo,

    // Engine selection: 0=wavetable, 1=polyblep
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
            amp_env: Envelope::new(sample_rate),
            filter_env: Envelope::new(sample_rate),
            lfo: Lfo::new(),
            engine: 0,
            target_freq: 440.0,
            current_freq: 440.0,
            glide_coeff: 1.0,
            noise_level: 0.0,
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
        self.steal_fade = 1.0;
        self.stealing = false;
        self.filter.reset();
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

    /// Set engine type: 0=wavetable, 1=polyblep.
    pub fn set_engine(&mut self, engine: u8) {
        self.engine = engine.min(1);
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

    /// Set the pulse width on the PolyBLEP oscillator.
    pub fn set_pulse_width(&mut self, pw: f32) {
        self.polyblep_osc.set_pulse_width(pw);
    }

    pub fn note_off(&mut self) {
        self.amp_env.note_off();
        self.filter_env.note_off();
    }

    pub fn start_steal(&mut self) {
        self.stealing = true;
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
    pub fn render(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        tables: &[Wavetable],
        base_cutoff: f32,
        resonance: f32,
        filter_mode: FilterMode,
        filter_drive: f32,
        lfo_rate: f32,
        mod_matrix: &ModMatrix,
        sample_rate: f32,
    ) {
        if !self.is_active() {
            return;
        }

        self.filter.set_drive(filter_drive);
        let block_size = left.len();

        for i in 0..block_size {
            // Portamento: glide current_freq toward target_freq
            self.current_freq += self.glide_coeff * (self.target_freq - self.current_freq);

            // Envelopes
            let amp = self.amp_env.tick();
            let filt_env = self.filter_env.tick();
            let lfo_val = self.lfo.tick(lfo_rate, sample_rate);

            // Modulation
            let mods = mod_matrix.evaluate(amp, filt_env, lfo_val, 0.0, self.velocity);

            // Pitch modulation (semitones)
            let pitch_mod = mods.pitch * 12.0;
            let freq = self.current_freq * 2.0f32.powf(pitch_mod / 12.0);

            // Oscillator — branch on engine type
            let osc_sample = match self.engine {
                1 => {
                    // PolyBLEP engine — use pulse wave (gets pulse_width)
                    self.polyblep_osc.pulse(freq, sample_rate)
                }
                _ => {
                    // Wavetable engine (default)
                    self.osc.tick(freq, sample_rate, tables)
                }
            };

            // Mix in noise
            let noise_sample = if self.noise_level > 0.001 {
                self.noise_gen.tick() * self.noise_level
            } else {
                0.0
            };

            let mixed = osc_sample + noise_sample;

            // Filter with modulation
            let cutoff = (base_cutoff * (1.0 + mods.filter_cutoff * 4.0)).clamp(20.0, 20000.0);
            let res = (resonance + mods.filter_resonance).clamp(0.5, 20.0);
            self.filter.set_mode(filter_mode);
            let filtered = self.filter.process(mixed, cutoff, res, sample_rate);

            // Amplitude
            let gain = amp * self.velocity * (1.0 + mods.level);

            // Voice stealing fade
            if self.stealing {
                self.steal_fade *= 0.995;
                if self.steal_fade < 0.001 {
                    self.active = false;
                    return;
                }
            }

            let sample = filtered * gain * self.steal_fade;
            left[i] += sample;
            right[i] += sample;
        }

        // Deactivate if envelope finished
        if !self.amp_env.is_active() && !self.stealing {
            self.active = false;
        }
    }
}
