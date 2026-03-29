//! Granular synthesis engine.
//! Creates clouds of micro-grains from wavetable or noise source.

use super::oscillator::Wavetable;

const MAX_GRAINS: usize = 32;

#[derive(Clone, Copy)]
struct Grain {
    active: bool,
    phase: f32,        // playback phase within grain
    freq: f32,         // playback frequency
    duration: f32,     // grain duration in samples
    elapsed: f32,      // samples elapsed
    pan: f32,          // -1 to 1
    amplitude: f32,    // 0 to 1
    waveform_idx: usize, // which wavetable to read
    position: f32,     // position in wavetable (for scanning)
}

impl Default for Grain {
    fn default() -> Self {
        Self {
            active: false, phase: 0.0, freq: 440.0, duration: 2000.0,
            elapsed: 0.0, pan: 0.0, amplitude: 1.0, waveform_idx: 0, position: 0.0,
        }
    }
}

pub struct GranularEngine {
    grains: [Grain; MAX_GRAINS],
    /// Grain spawn timer (samples until next grain)
    spawn_timer: f32,
    /// Random seed for grain parameter variation
    seed: u32,
    // Parameters
    pub density: f32,      // grains per second (1-100)
    pub grain_size: f32,   // grain duration in ms (5-500)
    pub position: f32,     // scan position 0-1 (which part of wavetable)
    pub spray: f32,        // position randomization 0-1
    pub pitch_var: f32,    // pitch variation in semitones (0-12)
    pub pan_spread: f32,   // stereo spread 0-1
}

impl GranularEngine {
    pub fn new() -> Self {
        Self {
            grains: [Grain::default(); MAX_GRAINS],
            spawn_timer: 0.0,
            seed: 42,
            density: 20.0,
            grain_size: 50.0,
            position: 0.0,
            spray: 0.1,
            pitch_var: 0.0,
            pan_spread: 0.5,
        }
    }

    pub fn reset(&mut self) {
        for g in &mut self.grains {
            g.active = false;
        }
        self.spawn_timer = 0.0;
    }

    fn rand(&mut self) -> f32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        (self.seed as f32) / (u32::MAX as f32)
    }

    fn rand_bipolar(&mut self) -> f32 {
        self.rand() * 2.0 - 1.0
    }

    /// Spawn a new grain at the given base frequency
    fn spawn_grain(&mut self, base_freq: f32, sample_rate: f32) {
        // Find inactive grain slot
        let slot = self.grains.iter().position(|g| !g.active);
        let Some(idx) = slot else { return; };

        let pitch_offset = self.rand_bipolar() * self.pitch_var;
        let freq = base_freq * 2.0f32.powf(pitch_offset / 12.0);
        let duration = self.grain_size * 0.001 * sample_rate;
        let pos = (self.position + self.rand_bipolar() * self.spray).clamp(0.0, 1.0);
        let pan = self.rand_bipolar() * self.pan_spread;

        self.grains[idx] = Grain {
            active: true,
            phase: pos, // start at scan position
            freq,
            duration,
            elapsed: 0.0,
            pan,
            amplitude: 0.8 + self.rand() * 0.2,
            waveform_idx: 1, // saw by default (rich harmonics for granular)
            position: pos,
        };
    }

    /// Process one sample, returns (left, right)
    #[inline]
    pub fn tick(&mut self, base_freq: f32, sample_rate: f32, tables: &[Wavetable]) -> (f32, f32) {
        // Spawn new grains based on density
        let spawn_interval = sample_rate / self.density.max(0.1);
        self.spawn_timer -= 1.0;
        if self.spawn_timer <= 0.0 {
            self.spawn_grain(base_freq, sample_rate);
            self.spawn_timer = spawn_interval;
        }

        let mut out_l = 0.0f32;
        let mut out_r = 0.0f32;

        for grain in &mut self.grains {
            if !grain.active { continue; }

            // Grain envelope (raised cosine window)
            let env_phase = grain.elapsed / grain.duration;
            let env = if env_phase >= 1.0 {
                grain.active = false;
                continue;
            } else {
                // Hann window: 0.5 * (1 - cos(2*pi*t))
                0.5 * (1.0 - (env_phase * core::f32::consts::TAU).cos())
            };

            // Read from wavetable using freq_ratio for mip-map selection
            let wt_idx = grain.waveform_idx.min(tables.len().saturating_sub(1));
            let freq_ratio = grain.freq / sample_rate;
            let sample = if !tables.is_empty() {
                tables[wt_idx].read(grain.phase, freq_ratio)
            } else {
                0.0
            };

            // Advance phase
            grain.phase += grain.freq / sample_rate;
            if grain.phase >= 1.0 { grain.phase -= 1.0; }
            grain.elapsed += 1.0;

            // Pan and accumulate
            let amp = sample * env * grain.amplitude;
            let pan_r = (grain.pan + 1.0) * 0.5;
            let pan_l = 1.0 - pan_r;
            out_l += amp * pan_l;
            out_r += amp * pan_r;
        }

        // Normalize by approximate active grain count to prevent clipping
        let active = self.grains.iter().filter(|g| g.active).count().max(1) as f32;
        let norm = 1.0 / active.sqrt();
        (out_l * norm, out_r * norm)
    }
}
