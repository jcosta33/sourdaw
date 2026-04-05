/// Decay Rate EQ — 6-band parametric controlling per-band RT60.
///
/// Each band's gain/cut maps to a decay time multiplier (0.25x - 4.0x of base RT60).
/// Implemented as a cascade of biquad sections per FDN delay line, where each biquad's
/// gain is computed from the Jot formula: g = 10^(-3 * M / (fs * RT60_band)).
use std::f32::consts::TAU;

// ---------------------------------------------------------------------------
// Biquad filter (second-order IIR)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    pub fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// Design a peaking EQ filter.
    pub fn design_peak(&mut self, freq: f32, gain_db: f32, q: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    /// Design a low shelf filter.
    pub fn design_low_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (-2.0 * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    /// Design a high shelf filter.
    pub fn design_high_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (-2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (2.0 * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

// ---------------------------------------------------------------------------
// Decay Rate EQ (6-band)
// ---------------------------------------------------------------------------

pub const NUM_BANDS: usize = 6;

/// One band of the Decay Rate EQ.
#[derive(Clone, Copy)]
pub struct DecayEqBand {
    pub freq: f32,
    pub multiplier: f32, // 0.25 to 4.0 (decay time multiplier)
    pub q: f32,
    pub band_type: BandType,
}

#[derive(Clone, Copy, PartialEq)]
pub enum BandType {
    LowShelf,
    Bell,
    HighShelf,
}

/// Default 6-band configuration per the research doc.
pub fn default_bands() -> [DecayEqBand; NUM_BANDS] {
    [
        DecayEqBand {
            freq: 100.0,
            multiplier: 1.0,
            q: 0.707,
            band_type: BandType::LowShelf,
        },
        DecayEqBand {
            freq: 400.0,
            multiplier: 1.0,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 1200.0,
            multiplier: 1.0,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 3500.0,
            multiplier: 1.0,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 8000.0,
            multiplier: 1.0,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 12000.0,
            multiplier: 1.0,
            q: 0.707,
            band_type: BandType::HighShelf,
        },
    ]
}

/// Decay Rate EQ instance for one FDN delay line.
/// Contains 6 biquad filters, one per band.
pub struct DecayRateEq {
    biquads: [Biquad; NUM_BANDS],
    bands: [DecayEqBand; NUM_BANDS],
    delay_samples: usize,
    sample_rate: f32,
    base_rt60: f32,
}

impl DecayRateEq {
    pub fn new(delay_samples: usize, sample_rate: f32, base_rt60: f32) -> Self {
        let mut eq = Self {
            biquads: core::array::from_fn(|_| Biquad::new()),
            bands: default_bands(),
            delay_samples,
            sample_rate,
            base_rt60,
        };
        eq.recompute_filters();
        eq
    }

    /// Set a band's decay multiplier and recompute filter.
    pub fn set_band_multiplier(&mut self, band_index: usize, multiplier: f32) {
        if band_index < NUM_BANDS {
            self.bands[band_index].multiplier = multiplier.clamp(0.25, 4.0);
            self.recompute_filter(band_index);
        }
    }

    /// Set the base RT60 (from the main decay control).
    pub fn set_base_rt60(&mut self, rt60: f32) {
        self.base_rt60 = rt60;
        self.recompute_filters();
    }

    /// Recompute all 6 filters.
    fn recompute_filters(&mut self) {
        for i in 0..NUM_BANDS {
            self.recompute_filter(i);
        }
    }

    /// Recompute one filter from the Jot formula.
    fn recompute_filter(&mut self, i: usize) {
        let band = &self.bands[i];
        let rt60_band = self.base_rt60 * band.multiplier;
        let m = self.delay_samples as f32;

        // Compute gain in dB that this filter needs at band.freq
        // to achieve the target rt60_band.
        // g = 10^(-3 * M / (fs * RT60_band))
        // The base gain (without EQ) is: g_base = 10^(-3 * M / (fs * base_rt60))
        // The EQ filter gain = g_band / g_base (in linear), convert to dB
        let g_band = if rt60_band > 0.01 {
            10.0_f32.powf(-3.0 * m / (self.sample_rate * rt60_band))
        } else {
            0.001
        };
        let g_base = if self.base_rt60 > 0.01 {
            10.0_f32.powf(-3.0 * m / (self.sample_rate * self.base_rt60))
        } else {
            0.001
        };

        let ratio = g_band / g_base.max(0.001);
        let gain_db = 20.0 * ratio.log10();

        match band.band_type {
            BandType::LowShelf => {
                self.biquads[i].design_low_shelf(band.freq, gain_db, self.sample_rate)
            }
            BandType::Bell => {
                self.biquads[i].design_peak(band.freq, gain_db, band.q, self.sample_rate)
            }
            BandType::HighShelf => {
                self.biquads[i].design_high_shelf(band.freq, gain_db, self.sample_rate)
            }
        }
    }

    /// Process one sample through all 6 bands.
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let mut signal = input;
        for bq in self.biquads.iter_mut() {
            signal = bq.process(signal);
        }
        signal
    }

    pub fn reset(&mut self) {
        for bq in self.biquads.iter_mut() {
            bq.reset();
        }
    }
}
