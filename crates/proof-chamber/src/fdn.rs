/// FDN (Feedback Delay Network) reverb engine.
///
/// Configurable 8 or 16 channel FDN with:
/// - Hadamard (N≥8) or Householder (N=4) mixing matrix
/// - Mutually-prime delay lengths via prime-power method
/// - Per-delay-line absorptive filters for frequency-dependent decay (Jot formula)
/// - Tapped delay line early reflections
/// - Multiple incommensurate-frequency LFOs for modulation

use std::f32::consts::TAU;

// ---------------------------------------------------------------------------
// Mixing matrices
// ---------------------------------------------------------------------------

/// In-place Hadamard transform via Fast Walsh-Hadamard (O(N log N)).
/// Input/output are in `data[0..n]`. Normalizes by 1/sqrt(n).
fn hadamard_transform(data: &mut [f32], n: usize) {
    let mut h = 1;
    while h < n {
        for i in (0..n).step_by(h * 2) {
            for j in i..(i + h) {
                let x = data[j];
                let y = data[j + h];
                data[j] = x + y;
                data[j + h] = x - y;
            }
        }
        h *= 2;
    }
    let norm = 1.0 / (n as f32).sqrt();
    for v in data[..n].iter_mut() {
        *v *= norm;
    }
}

/// Householder reflection: H = I - (2/N) * 1*1^T
/// Equivalent to: output[i] = input[i] - (2/N) * sum(input)
fn householder_transform(data: &mut [f32], n: usize) {
    let sum: f32 = data[..n].iter().sum();
    let factor = 2.0 * sum / n as f32;
    for v in data[..n].iter_mut() {
        *v -= factor;
    }
}

// ---------------------------------------------------------------------------
// Prime-power delay length generator
// ---------------------------------------------------------------------------

const PRIMES: [usize; 16] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];

/// Generate N mutually-prime delay lengths in the range [min_samples, max_samples]
/// using Smith's prime-power method: M_i = p_i^k_i where p_i is the i-th prime.
fn generate_prime_power_delays(n: usize, min_samples: usize, max_samples: usize) -> Vec<usize> {
    let target_mid = ((min_samples + max_samples) / 2) as f64;
    let mut delays = Vec::with_capacity(n);

    for i in 0..n.min(PRIMES.len()) {
        let p = PRIMES[i] as f64;
        // k = round(log(target) / log(p))
        let k = (target_mid.ln() / p.ln()).round() as u32;
        let delay = p.powi(k as i32) as usize;
        delays.push(delay.clamp(min_samples, max_samples));
    }

    // Ensure all delays are within range and spread out
    delays.sort();
    delays
}

// ---------------------------------------------------------------------------
// One-pole absorptive filter (per delay line)
// ---------------------------------------------------------------------------

/// Per-delay-line absorptive filter implementing Jot's frequency-dependent decay.
/// g(f) = 10^(-3 * M / (fs * RT60(f)))
#[derive(Clone)]
struct AbsorptiveFilter {
    /// Low-frequency gain per sample (derived from RT60 at low freq)
    g_low: f32,
    /// High-frequency gain per sample (derived from RT60 at high freq)
    g_high: f32,
    /// One-pole state for frequency-dependent absorption
    state: f32,
    /// Filter coefficient (controls crossover between g_low and g_high)
    coeff: f32,
}

impl AbsorptiveFilter {
    fn new(delay_samples: usize, sample_rate: f32, rt60_low: f32, rt60_high: f32) -> Self {
        let m = delay_samples as f32;
        let g_low = if rt60_low > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_low))
        } else {
            0.0
        };
        let g_high = if rt60_high > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_high))
        } else {
            0.0
        };

        // Crossover around 2kHz
        let crossover_hz = 2000.0;
        let coeff = (-TAU * crossover_hz / sample_rate).exp();

        Self { g_low, g_high, state: 0.0, coeff }
    }

    fn update_rt60(&mut self, delay_samples: usize, sample_rate: f32, rt60_low: f32, rt60_high: f32) {
        let m = delay_samples as f32;
        self.g_low = if rt60_low > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_low))
        } else {
            0.0
        };
        self.g_high = if rt60_high > 0.01 {
            10.0_f32.powf(-3.0 * m / (sample_rate * rt60_high))
        } else {
            0.0
        };
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        // One-pole lowpass to separate low and high frequency components
        self.state = input * (1.0 - self.coeff) + self.state * self.coeff;
        let low = self.state;
        let high = input - low;
        low * self.g_low + high * self.g_high
    }
}

// ---------------------------------------------------------------------------
// Tapped delay line for early reflections
// ---------------------------------------------------------------------------

struct EarlyReflections {
    buffer: Vec<f32>,
    write_pos: usize,
    taps: Vec<(usize, f32)>, // (delay_samples, gain)
    len: usize,
}

impl EarlyReflections {
    fn new(sample_rate: f32, room_size: f32) -> Self {
        let max_delay = (sample_rate * 0.1) as usize; // 100ms max
        // Generate tap pattern based on room size
        // First reflections from 6 walls, decreasing as 1/sqrt(t)
        let base_delay_ms = 5.0 + room_size * 45.0; // 5-50ms for first reflection
        let mut taps = Vec::new();

        // 12 taps with varying delays and gains
        let tap_times_ms = [
            1.0, 3.2, 5.1, 7.8, 11.3, 15.7, 20.4, 26.1, 33.0, 41.2, 52.8, 67.0,
        ];

        for (i, &t) in tap_times_ms.iter().enumerate() {
            let delay = ((t * room_size + base_delay_ms * 0.1) / 1000.0 * sample_rate) as usize;
            let gain = 0.7 / (1.0 + (i as f32) * 0.3).sqrt();
            // Alternate signs for decorrelation
            let sign = if i % 2 == 0 { 1.0 } else { -1.0 };
            taps.push((delay.min(max_delay - 1), gain * sign));
        }

        Self {
            buffer: vec![0.0; max_delay],
            write_pos: 0,
            taps,
            len: max_delay,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        self.buffer[self.write_pos] = input;
        self.write_pos = (self.write_pos + 1) % self.len;

        let mut sum = 0.0_f32;
        for &(delay, gain) in &self.taps {
            let pos = (self.write_pos + self.len - delay) % self.len;
            sum += self.buffer[pos] * gain;
        }
        sum
    }

    fn update_room_size(&mut self, sample_rate: f32, room_size: f32) {
        let base_delay_ms = 5.0 + room_size * 45.0;
        let tap_times_ms = [
            1.0, 3.2, 5.1, 7.8, 11.3, 15.7, 20.4, 26.1, 33.0, 41.2, 52.8, 67.0,
        ];
        for (i, &t) in tap_times_ms.iter().enumerate() {
            if i < self.taps.len() {
                let delay = ((t * room_size + base_delay_ms * 0.1) / 1000.0 * sample_rate) as usize;
                self.taps[i].0 = delay.min(self.len - 1);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// FDN Reverb Engine
// ---------------------------------------------------------------------------

const MAX_FDN_CHANNELS: usize = 16;

pub struct FdnReverb {
    sample_rate: f32,
    num_channels: usize,

    // Delay lines
    buffers: Vec<Vec<f32>>,
    write_positions: Vec<usize>,
    delay_lengths: Vec<usize>,

    // Per-line absorptive filters
    absorptive_filters: Vec<AbsorptiveFilter>,

    // Mixing matrix scratch buffer
    mix_buf: [f32; MAX_FDN_CHANNELS],

    // Modulation LFOs (incommensurate frequencies)
    lfo_phases: [f32; MAX_FDN_CHANNELS],
    lfo_freqs: [f32; MAX_FDN_CHANNELS],
    mod_depth: f32,

    // Early reflections
    early_reflections_l: EarlyReflections,
    early_reflections_r: EarlyReflections,

    // Parameters
    pub rt60: f32,
    pub rt60_hf: f32,
    pub size: f32,
    pub mix: f32,
    pub early_late_balance: f32, // 0=all early, 1=all late
    pub use_hadamard: bool,

    // Pre-delay
    predelay_buf: Vec<f32>,
    predelay_pos: usize,
    predelay_len: usize,

    // Soft saturation for infinite sustain
    pub saturation_enabled: bool,

    // Parameter smoothing (30ms ramp)
    smooth_mix: f32,
    smooth_coeff: f32,
}

impl FdnReverb {
    pub fn new(sample_rate: f32, num_channels: usize) -> Self {
        let n = num_channels.min(MAX_FDN_CHANNELS);

        // Generate delay lengths based on default room size
        let min_samples = (sample_rate * 0.020) as usize; // 20ms
        let max_samples = (sample_rate * 0.060) as usize; // 60ms
        let delay_lengths = generate_prime_power_delays(n, min_samples, max_samples);

        let buffers: Vec<Vec<f32>> = delay_lengths
            .iter()
            .map(|&len| vec![0.0; len.max(1) + 64]) // +64 for modulation headroom
            .collect();

        let write_positions = vec![0; n];

        let absorptive_filters: Vec<AbsorptiveFilter> = delay_lengths
            .iter()
            .map(|&len| AbsorptiveFilter::new(len, sample_rate, 2.0, 0.8))
            .collect();

        // Incommensurate LFO frequencies (Costello-inspired)
        let base_freqs = [0.7, 1.1, 1.7, 2.3, 0.5, 1.3, 1.9, 2.9, 0.6, 1.4, 2.1, 0.8, 1.6, 2.7, 0.9, 1.2];
        let mut lfo_freqs = [0.0_f32; MAX_FDN_CHANNELS];
        let mut lfo_phases = [0.0_f32; MAX_FDN_CHANNELS];
        for i in 0..n {
            lfo_freqs[i] = base_freqs[i % base_freqs.len()];
            lfo_phases[i] = (i as f32) / (n as f32); // spread initial phases
        }

        let predelay_max = (sample_rate * 0.5) as usize;

        Self {
            sample_rate,
            num_channels: n,
            buffers,
            write_positions,
            delay_lengths,
            absorptive_filters,
            mix_buf: [0.0; MAX_FDN_CHANNELS],
            lfo_phases,
            lfo_freqs,
            mod_depth: 0.3,
            early_reflections_l: EarlyReflections::new(sample_rate, 0.5),
            early_reflections_r: EarlyReflections::new(sample_rate, 0.5),
            rt60: 2.0,
            rt60_hf: 0.8,
            size: 0.5,
            mix: 0.3,
            early_late_balance: 0.4,
            use_hadamard: true,
            predelay_buf: vec![0.0; predelay_max],
            predelay_pos: 0,
            predelay_len: ((15.0 / 1000.0) * sample_rate) as usize,
            saturation_enabled: false,
            smooth_mix: 0.3,
            smooth_coeff: 1.0 - (-1.0 / (0.030 * sample_rate)).exp(),
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "rt60" | "decay" => {
                self.rt60 = value.clamp(0.1, 30.0);
                self.update_absorptive_filters();
            }
            "rt60_hf" | "damping" => {
                // Map 0-1 damping to rt60_hf as fraction of rt60
                self.rt60_hf = self.rt60 * (1.0 - value.clamp(0.0, 0.999)) * 0.5;
                self.update_absorptive_filters();
            }
            "size" => {
                self.size = value.clamp(0.0, 1.0);
                self.update_delay_lengths();
                self.early_reflections_l.update_room_size(self.sample_rate, value);
                self.early_reflections_r.update_room_size(self.sample_rate, value);
            }
            "mod_depth" => self.mod_depth = value.clamp(0.0, 1.0),
            "early_late" => self.early_late_balance = value.clamp(0.0, 1.0),
            "predelay" => {
                self.predelay_len = ((value / 1000.0) * self.sample_rate) as usize;
                self.predelay_len = self.predelay_len.min(self.predelay_buf.len() - 1);
            }
            "matrix" => self.use_hadamard = value > 0.5,
            "saturation" => self.saturation_enabled = value > 0.5,
            _ => {}
        }
    }

    fn update_absorptive_filters(&mut self) {
        for (i, filter) in self.absorptive_filters.iter_mut().enumerate() {
            if i < self.delay_lengths.len() {
                filter.update_rt60(self.delay_lengths[i], self.sample_rate, self.rt60, self.rt60_hf);
            }
        }
    }

    fn update_delay_lengths(&mut self) {
        let min_ms = 10.0 + self.size * 20.0;  // 10-30ms
        let max_ms = 30.0 + self.size * 50.0;  // 30-80ms
        let min_samples = (min_ms / 1000.0 * self.sample_rate) as usize;
        let max_samples = (max_ms / 1000.0 * self.sample_rate) as usize;
        let new_delays = generate_prime_power_delays(self.num_channels, min_samples, max_samples);

        for (i, &new_len) in new_delays.iter().enumerate() {
            if i < self.delay_lengths.len() {
                self.delay_lengths[i] = new_len.min(self.buffers[i].len() - 64);
            }
        }
        self.update_absorptive_filters();
    }

    /// Process stereo audio in-place.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = self.num_channels;

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            // Pre-delay
            let pd_len = self.predelay_buf.len();
            self.predelay_buf[self.predelay_pos % pd_len] = mono;
            let pd_read = (self.predelay_pos + pd_len - self.predelay_len) % pd_len;
            let predelayed = self.predelay_buf[pd_read];
            self.predelay_pos = (self.predelay_pos + 1) % pd_len;

            // Early reflections
            let early_l = self.early_reflections_l.process(predelayed);
            let early_r = self.early_reflections_r.process(predelayed);

            // Read from all delay lines (with modulation)
            for ch in 0..n {
                let base_delay = self.delay_lengths[ch];
                let buf_len = self.buffers[ch].len();

                // LFO modulation
                let lfo = (self.lfo_phases[ch] * TAU).sin();
                self.lfo_phases[ch] += self.lfo_freqs[ch] / self.sample_rate;
                if self.lfo_phases[ch] >= 1.0 {
                    self.lfo_phases[ch] -= 1.0;
                }

                let mod_offset = (lfo * self.mod_depth * 8.0) as isize;
                let effective_delay = (base_delay as isize + mod_offset).clamp(1, (buf_len - 1) as isize) as usize;

                let read_pos = (self.write_positions[ch] + buf_len - effective_delay) % buf_len;
                self.mix_buf[ch] = self.buffers[ch][read_pos];
            }

            // Apply absorptive filters
            for ch in 0..n {
                self.mix_buf[ch] = self.absorptive_filters[ch].process(self.mix_buf[ch]);
            }

            // Soft saturation (before matrix) for infinite sustain
            if self.saturation_enabled {
                for ch in 0..n {
                    let x = self.mix_buf[ch];
                    // Fast tanh approximation
                    let x2 = x * x;
                    self.mix_buf[ch] = x * (27.0 + x2) / (27.0 + 9.0 * x2);
                }
            }

            // Apply mixing matrix
            if self.use_hadamard && n >= 8 {
                hadamard_transform(&mut self.mix_buf, n);
            } else {
                householder_transform(&mut self.mix_buf, n);
            }

            // Write back to delay lines (input + mixed feedback)
            for ch in 0..n {
                let input_gain = if ch < n / 2 { 1.0 } else { 0.8 }; // slight asymmetry for stereo
                let sample = predelayed * input_gain + self.mix_buf[ch];

                // Magnitude truncation
                let truncated = if sample.abs() < 1e-18 { 0.0 } else { sample };
                let buf_len = self.buffers[ch].len();
                self.buffers[ch][self.write_positions[ch]] = truncated;
                self.write_positions[ch] = (self.write_positions[ch] + 1) % buf_len;
            }

            // Sum outputs: first half → left, second half → right, with cross-tapping
            let mut late_l = 0.0_f32;
            let mut late_r = 0.0_f32;
            for ch in 0..n {
                let val = self.mix_buf[ch];
                if ch % 2 == 0 {
                    late_l += val;
                    late_r += val * 0.3; // cross-tap
                } else {
                    late_r += val;
                    late_l += val * 0.3;
                }
            }
            let scale = 1.0 / (n as f32).sqrt();
            late_l *= scale;
            late_r *= scale;

            // Blend early and late
            let el = self.early_late_balance;
            let wet_l = early_l * (1.0 - el) + late_l * el;
            let wet_r = early_r * (1.0 - el) + late_r * el;

            // Mix
            // Smoothed mix to prevent clicks
            self.smooth_mix += self.smooth_coeff * (self.mix - self.smooth_mix);
            let m = self.smooth_mix;
            left[i] = dry_l * (1.0 - m) + wet_l * m;
            right[i] = dry_r * (1.0 - m) + wet_r * m;
        }
    }
}
