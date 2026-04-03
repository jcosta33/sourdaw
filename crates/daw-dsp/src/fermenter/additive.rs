//! Additive synthesis engine.
//! Generates sound from up to 64 individual sine partials with per-partial amplitude control.

use core::f32::consts::TAU;

pub const MAX_PARTIALS: usize = 64;

#[derive(Clone)]
pub struct AdditiveEngine {
    phases: [f32; MAX_PARTIALS],
    /// Amplitude per partial (0-1)
    amplitudes: [f32; MAX_PARTIALS],
    /// Number of active partials
    num_partials: usize,
    /// Spectral tilt: negative = more fundamental, positive = more harmonics
    tilt: f32,
    /// Even/odd balance: 0 = all harmonics, 1 = odd only
    odd_emphasis: f32,
    /// Inharmonicity: 0 = perfect harmonics, >0 = stretched partials
    inharmonicity: f32,
}

impl AdditiveEngine {
    pub fn new() -> Self {
        let mut engine = Self {
            phases: [0.0; MAX_PARTIALS],
            amplitudes: [0.0; MAX_PARTIALS],
            num_partials: 32,
            tilt: 0.0,
            odd_emphasis: 0.0,
            inharmonicity: 0.0,
        };
        engine.compute_amplitudes();
        engine
    }

    pub fn set_num_partials(&mut self, n: usize) {
        self.num_partials = n.clamp(1, MAX_PARTIALS);
        self.compute_amplitudes();
    }

    pub fn set_tilt(&mut self, tilt: f32) {
        self.tilt = tilt.clamp(-6.0, 6.0);
        self.compute_amplitudes();
    }

    pub fn set_odd_emphasis(&mut self, emphasis: f32) {
        self.odd_emphasis = emphasis.clamp(0.0, 1.0);
        self.compute_amplitudes();
    }

    pub fn set_inharmonicity(&mut self, inharmonicity: f32) {
        self.inharmonicity = inharmonicity.clamp(0.0, 0.1);
    }

    /// Recompute partial amplitudes based on tilt and odd emphasis.
    fn compute_amplitudes(&mut self) {
        for i in 0..MAX_PARTIALS {
            let n = (i + 1) as f32;
            // Base amplitude: 1/n (sawtooth-like)
            let base = 1.0 / n;
            // Apply tilt (dB/octave)
            let tilt_factor = (2.0f32).powf(self.tilt * (n - 1.0).log2().max(0.0) / 6.0);
            // Odd emphasis: attenuate even harmonics
            let even_atten = if i % 2 == 1 {
                1.0 - self.odd_emphasis
            } else {
                1.0
            };

            self.amplitudes[i] = if i < self.num_partials {
                (base * tilt_factor * even_atten).clamp(0.0, 1.0)
            } else {
                0.0
            };
        }
    }

    pub fn reset(&mut self) {
        self.phases = [0.0; MAX_PARTIALS];
    }

    /// Process one sample at the given fundamental frequency.
    #[inline]
    pub fn tick(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let mut output = 0.0f32;
        let nyquist = sample_rate * 0.5;

        for i in 0..self.num_partials {
            let n = (i + 1) as f32;
            // Partial frequency with inharmonicity stretching
            let partial_freq = freq * n * (1.0 + self.inharmonicity * n * n);

            // Skip partials above Nyquist (anti-aliasing)
            if partial_freq >= nyquist {
                break;
            }

            let amp = self.amplitudes[i];
            if amp < 0.0001 {
                continue;
            }

            output += (self.phases[i] * TAU).sin() * amp;

            self.phases[i] += partial_freq / sample_rate;
            if self.phases[i] >= 1.0 {
                self.phases[i] -= 1.0;
            }
        }

        // Normalize by approximate partial count to prevent clipping
        let active_count = self.num_partials.min(64).max(1) as f32;
        output / active_count.sqrt()
    }
}
