/// Vintage character processing — applies era-appropriate degradation.
///
/// 1970s: Downsampled to ~20kHz, dark/noisy modulation, limited bandwidth
/// 1980s: Full rate, dark modulation character, 15kHz bandwidth
/// Modern: Full bandwidth, clean modulation

/// Vintage mode processor applied to the reverb output.
pub struct VintageProcessor {
    mode: VintageMode,
    sample_rate: f32,
    // Decimation state (for 1970s mode)
    decimate_counter: usize,
    decimate_hold: f32,
    // Bandwidth limiter
    lp_state_l: f32,
    lp_state_r: f32,
    lp_coeff: f32,
    // Noise injection
    noise_state: u32,
    noise_level: f32,
}

#[derive(Clone, Copy, PartialEq)]
pub enum VintageMode {
    Modern,    // Clean, full bandwidth
    Eighties,  // Full rate, dark modulation, 15kHz bandwidth
    Seventies, // ~20kHz effective rate, dark, noisy, 10kHz bandwidth
}

impl VintageProcessor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            mode: VintageMode::Modern,
            sample_rate,
            decimate_counter: 0,
            decimate_hold: 0.0,
            lp_state_l: 0.0,
            lp_state_r: 0.0,
            lp_coeff: 0.0,
            noise_state: 12345,
            noise_level: 0.0,
        }
    }

    pub fn set_mode(&mut self, mode: VintageMode) {
        self.mode = mode;
        match mode {
            VintageMode::Modern => {
                self.lp_coeff = 0.0; // no filtering
                self.noise_level = 0.0;
            }
            VintageMode::Eighties => {
                // 15kHz bandwidth
                let cutoff = 15000.0;
                self.lp_coeff = (-std::f32::consts::TAU * cutoff / self.sample_rate).exp();
                self.noise_level = 0.0003; // subtle noise
            }
            VintageMode::Seventies => {
                // 10kHz bandwidth (emulating ~20kHz sample rate Nyquist)
                let cutoff = 10000.0;
                self.lp_coeff = (-std::f32::consts::TAU * cutoff / self.sample_rate).exp();
                self.noise_level = 0.001; // noticeable noise halo
            }
        }
    }

    /// Cheap noise generator (xorshift32)
    #[inline]
    fn noise(&mut self) -> f32 {
        self.noise_state ^= self.noise_state << 13;
        self.noise_state ^= self.noise_state >> 17;
        self.noise_state ^= self.noise_state << 5;
        (self.noise_state as f32) / (u32::MAX as f32) * 2.0 - 1.0
    }

    /// Process stereo audio through vintage character.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.mode == VintageMode::Modern {
            return; // no processing needed
        }

        for i in 0..left.len() {
            let mut l = left[i];
            let mut r = right[i];

            // Decimation (1970s mode: hold every Nth sample)
            if self.mode == VintageMode::Seventies {
                // Effective ~20kHz rate: skip every other sample at 44.1kHz
                self.decimate_counter += 1;
                if self.decimate_counter >= 2 {
                    self.decimate_counter = 0;
                    self.decimate_hold = (l + r) * 0.5;
                }
                l = self.decimate_hold + (l - self.decimate_hold) * 0.3;
                r = self.decimate_hold + (r - self.decimate_hold) * 0.3;
            }

            // Bandwidth limiting (one-pole lowpass)
            if self.lp_coeff > 0.0 {
                self.lp_state_l = l * (1.0 - self.lp_coeff) + self.lp_state_l * self.lp_coeff;
                self.lp_state_r = r * (1.0 - self.lp_coeff) + self.lp_state_r * self.lp_coeff;
                l = self.lp_state_l;
                r = self.lp_state_r;
            }

            // Noise injection (additive, broadband)
            if self.noise_level > 0.0 {
                l += self.noise() * self.noise_level;
                r += self.noise() * self.noise_level;
            }

            left[i] = l;
            right[i] = r;
        }
    }
}
