/// 8-band parametric EQ using biquad filters.
/// Each band can be: peak, low shelf, high shelf, highpass, or lowpass.

use core::f32::consts::PI;

const NUM_BANDS: usize = 8;

#[derive(Clone, Copy)]
enum BandType {
    Peak,
    LowShelf,
    HighShelf,
    HighPass,
    LowPass,
}

#[derive(Clone)]
struct BiquadState {
    x1: f32, x2: f32,
    y1: f32, y2: f32,
}

impl BiquadState {
    fn new() -> Self {
        Self { x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }

    fn process(&mut self, input: f32, coeffs: &BiquadCoeffs) -> f32 {
        let out = coeffs.b0 * input + coeffs.b1 * self.x1 + coeffs.b2 * self.x2
                  - coeffs.a1 * self.y1 - coeffs.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }
}

#[derive(Clone)]
struct BiquadCoeffs {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
}

impl BiquadCoeffs {
    fn unity() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 }
    }
}

struct EqBand {
    enabled: bool,
    band_type: BandType,
    freq: f32,
    gain_db: f32,
    q: f32,
    coeffs: BiquadCoeffs,
    state_l: BiquadState,
    state_r: BiquadState,
}

pub struct ParametricEq {
    sample_rate: f32,
    bands: [EqBand; NUM_BANDS],
    output_gain: f32,
}

/// Compute biquad coefficients using RBJ Audio EQ Cookbook formulas.
fn compute_coeffs(band_type: BandType, freq: f32, gain_db: f32, q: f32, sr: f32) -> BiquadCoeffs {
    let w0 = 2.0 * PI * freq / sr;
    let cos_w0 = w0.cos();
    let sin_w0 = w0.sin();
    let alpha = sin_w0 / (2.0 * q);
    let a = 10.0_f32.powf(gain_db / 40.0);

    let (b0, b1, b2, a0, a1, a2) = match band_type {
        BandType::Peak => {
            let b0 = 1.0 + alpha * a;
            let b1 = -2.0 * cos_w0;
            let b2 = 1.0 - alpha * a;
            let a0 = 1.0 + alpha / a;
            let a1 = -2.0 * cos_w0;
            let a2 = 1.0 - alpha / a;
            (b0, b1, b2, a0, a1, a2)
        }
        BandType::LowShelf => {
            let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
            let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
            let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
            let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
            let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
            let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
            let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
            (b0, b1, b2, a0, a1, a2)
        }
        BandType::HighShelf => {
            let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
            let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + two_sqrt_a_alpha);
            let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
            let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - two_sqrt_a_alpha);
            let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + two_sqrt_a_alpha;
            let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
            let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - two_sqrt_a_alpha;
            (b0, b1, b2, a0, a1, a2)
        }
        BandType::HighPass => {
            let b0 = (1.0 + cos_w0) / 2.0;
            let b1 = -(1.0 + cos_w0);
            let b2 = (1.0 + cos_w0) / 2.0;
            let a0 = 1.0 + alpha;
            let a1 = -2.0 * cos_w0;
            let a2 = 1.0 - alpha;
            (b0, b1, b2, a0, a1, a2)
        }
        BandType::LowPass => {
            let b0 = (1.0 - cos_w0) / 2.0;
            let b1 = 1.0 - cos_w0;
            let b2 = (1.0 - cos_w0) / 2.0;
            let a0 = 1.0 + alpha;
            let a1 = -2.0 * cos_w0;
            let a2 = 1.0 - alpha;
            (b0, b1, b2, a0, a1, a2)
        }
    };

    let inv_a0 = 1.0 / a0;
    BiquadCoeffs {
        b0: b0 * inv_a0, b1: b1 * inv_a0, b2: b2 * inv_a0,
        a1: a1 * inv_a0, a2: a2 * inv_a0,
    }
}

fn default_band(idx: usize) -> EqBand {
    // Default frequencies spread across spectrum
    let default_freqs = [30.0, 80.0, 250.0, 800.0, 2500.0, 6000.0, 12000.0, 18000.0];
    let default_types = [
        BandType::HighPass, BandType::LowShelf,
        BandType::Peak, BandType::Peak, BandType::Peak, BandType::Peak,
        BandType::HighShelf, BandType::LowPass,
    ];
    EqBand {
        enabled: idx >= 2 && idx <= 5, // middle 4 bands enabled by default
        band_type: default_types[idx],
        freq: default_freqs[idx],
        gain_db: 0.0,
        q: 1.0,
        coeffs: BiquadCoeffs::unity(),
        state_l: BiquadState::new(),
        state_r: BiquadState::new(),
    }
}

impl ParametricEq {
    pub fn new(sample_rate: f32) -> Self {
        let bands = core::array::from_fn(default_band);
        Self {
            sample_rate,
            bands,
            output_gain: 1.0,
        }
    }

    fn recalc_band(&mut self, idx: usize) {
        let b = &self.bands[idx];
        let coeffs = compute_coeffs(b.band_type, b.freq, b.gain_db, b.q, self.sample_rate);
        self.bands[idx].coeffs = coeffs;
    }

    /// Param names: band0_freq..band7_freq, band0_gain..band7_gain, band0_q..band7_q,
    /// band0_type..band7_type (0=peak,1=lshelf,2=hshelf,3=hp,4=lp),
    /// band0_enabled..band7_enabled, output_gain
    pub fn set_param(&mut self, name: &str, value: f32) {
        if name == "output_gain" {
            self.output_gain = db_to_linear(value);
            return;
        }

        // Parse "bandN_param" pattern
        if name.len() < 7 || !name.starts_with("band") {
            return;
        }
        let idx = match name.as_bytes()[4] {
            b'0'..=b'7' => (name.as_bytes()[4] - b'0') as usize,
            _ => return,
        };
        let param = &name[6..]; // skip "bandN_"

        match param {
            "freq" => { self.bands[idx].freq = value.clamp(20.0, 20000.0); self.recalc_band(idx); }
            "gain" => { self.bands[idx].gain_db = value.clamp(-24.0, 24.0); self.recalc_band(idx); }
            "q" => { self.bands[idx].q = value.clamp(0.1, 18.0); self.recalc_band(idx); }
            "type" => {
                self.bands[idx].band_type = match value as u32 {
                    0 => BandType::Peak,
                    1 => BandType::LowShelf,
                    2 => BandType::HighShelf,
                    3 => BandType::HighPass,
                    4 => BandType::LowPass,
                    _ => BandType::Peak,
                };
                self.recalc_band(idx);
            }
            "enabled" => { self.bands[idx].enabled = value > 0.5; }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            let mut l = left[i];
            let mut r = right[i];

            for band in self.bands.iter_mut() {
                if band.enabled {
                    l = band.state_l.process(l, &band.coeffs);
                    r = band.state_r.process(r, &band.coeffs);
                }
            }

            left[i] = l * self.output_gain;
            right[i] = r * self.output_gain;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec![
            "band0_freq", "band0_gain", "band0_q", "band0_type", "band0_enabled",
            "band1_freq", "band1_gain", "band1_q", "band1_type", "band1_enabled",
            "band2_freq", "band2_gain", "band2_q", "band2_type", "band2_enabled",
            "band3_freq", "band3_gain", "band3_q", "band3_type", "band3_enabled",
            "band4_freq", "band4_gain", "band4_q", "band4_type", "band4_enabled",
            "band5_freq", "band5_gain", "band5_q", "band5_type", "band5_enabled",
            "band6_freq", "band6_gain", "band6_q", "band6_type", "band6_enabled",
            "band7_freq", "band7_gain", "band7_q", "band7_type", "band7_enabled",
            "output_gain",
        ]
    }
}

fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}
