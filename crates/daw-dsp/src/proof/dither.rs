//! Dithering — TPDF and noise-shaped (POW-R #1 approximation).

/// TPDF dithering for bit-depth reduction.
pub struct TpdfDither {
    bit_depth: u32,
    rng_state: u32, // xorshift32 state
}

impl TpdfDither {
    pub fn new(bit_depth: u32) -> Self {
        Self { bit_depth, rng_state: 0xDEAD_BEEF }
    }

    pub fn set_bit_depth(&mut self, bits: u32) {
        self.bit_depth = bits.clamp(8, 32);
    }

    #[inline]
    fn next_random(&mut self) -> f32 {
        // xorshift32
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 17;
        self.rng_state ^= self.rng_state << 5;
        // Map to [-0.5, +0.5]
        (self.rng_state as f32 / u32::MAX as f32) - 0.5
    }

    #[inline]
    pub fn process_sample(&mut self, x: f32) -> f32 {
        let lsb = 2.0_f32.powi(-(self.bit_depth as i32 - 1));
        let r1 = self.next_random();
        let r2 = self.next_random();
        x + (r1 + r2) * lsb
    }
}

/// Noise-shaped dithering with error feedback (POW-R #1 approximation).
pub struct NoiseShapedDither {
    tpdf: TpdfDither,
    error_history: [f32; 6],
    history_pos: usize,
}

// POW-R #1 feedback filter coefficients (approximation)
const POWR1_COEFFS: [f32; 6] = [2.033, -2.165, 1.959, -1.590, 0.869, -0.382];

impl NoiseShapedDither {
    pub fn new(bit_depth: u32) -> Self {
        Self {
            tpdf: TpdfDither::new(bit_depth),
            error_history: [0.0; 6],
            history_pos: 0,
        }
    }

    pub fn set_bit_depth(&mut self, bits: u32) {
        self.tpdf.set_bit_depth(bits);
    }

    #[inline]
    pub fn process_sample(&mut self, x: f32) -> f32 {
        // Compute shaped error from previous quantization errors
        let mut shaped_error = 0.0_f32;
        for (i, &coeff) in POWR1_COEFFS.iter().enumerate() {
            let idx = (self.history_pos + 6 - i) % 6;
            shaped_error += coeff * self.error_history[idx];
        }

        let x_shaped = x - shaped_error;
        let x_dithered = self.tpdf.process_sample(x_shaped);

        // Quantize
        let lsb = 2.0_f32.powi(-(self.tpdf.bit_depth as i32 - 1));
        let quantized = (x_dithered / lsb).round() * lsb;

        // Store error
        self.history_pos = (self.history_pos + 1) % 6;
        self.error_history[self.history_pos] = quantized - x_dithered;

        quantized
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum DitherMode {
    Off,
    Tpdf,
    NoiseShaped,
}

pub struct Ditherer {
    tpdf: TpdfDither,
    noise_shaped: NoiseShapedDither,
    mode: DitherMode,
}

impl Ditherer {
    pub fn new(bit_depth: u32) -> Self {
        Self {
            tpdf: TpdfDither::new(bit_depth),
            noise_shaped: NoiseShapedDither::new(bit_depth),
            mode: DitherMode::Off,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "dither_mode" => {
                self.mode = match value as u32 {
                    0 => DitherMode::Off, 1 => DitherMode::Tpdf, 2 => DitherMode::NoiseShaped,
                    _ => DitherMode::Off,
                };
            }
            "dither_bits" => {
                let bits = value as u32;
                self.tpdf.set_bit_depth(bits);
                self.noise_shaped.set_bit_depth(bits);
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        match self.mode {
            DitherMode::Off => {}
            DitherMode::Tpdf => {
                for i in 0..left.len() {
                    left[i] = self.tpdf.process_sample(left[i]);
                    right[i] = self.tpdf.process_sample(right[i]);
                }
            }
            DitherMode::NoiseShaped => {
                for i in 0..left.len() {
                    left[i] = self.noise_shaped.process_sample(left[i]);
                    right[i] = self.noise_shaped.process_sample(right[i]);
                }
            }
        }
    }
}
