//! Stereo imager — per-band width control, auto mono bass, correlation meter.

use super::crossover::FourBandSplitter;

const NUM_BANDS: usize = 4;
const INV_SQRT2: f32 = std::f32::consts::FRAC_1_SQRT_2;

pub struct StereoImager {
    splitter: FourBandSplitter,
    band_width: [f32; NUM_BANDS], // 0.0 = mono, 1.0 = unity, 2.0 = doubled
    crossover_freqs: [f64; 3],
    sample_rate: f64,
    auto_mono_bass: bool,
    mono_bass_freq: f64,
    bypassed: bool,
    // Correlation meter state
    lr_sum: f64,
    l_sq_sum: f64,
    r_sq_sum: f64,
    corr_alpha: f64,
    meter_correlation: f32,
}

impl StereoImager {
    pub fn new(sr: f64) -> Self {
        let freqs = [120.0, 1000.0, 8000.0];
        // Smoothing for ~300ms window
        let corr_alpha = (-1.0 / (0.3 * sr)).exp();
        Self {
            splitter: FourBandSplitter::new(freqs[0], freqs[1], freqs[2], sr),
            band_width: [0.0, 0.8, 1.0, 1.3], // mono bass, slightly narrow low-mid, unity mid, wider high
            crossover_freqs: freqs,
            sample_rate: sr,
            auto_mono_bass: true,
            mono_bass_freq: 80.0,
            bypassed: false,
            lr_sum: 0.0,
            l_sq_sum: 0.0,
            r_sq_sum: 0.0,
            corr_alpha,
            meter_correlation: 1.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "img_bypass" => self.bypassed = value > 0.5,
            "img_auto_mono_bass" => self.auto_mono_bass = value > 0.5,
            "img_mono_bass_freq" => {
                self.mono_bass_freq = (value as f64).clamp(40.0, 200.0);
                // Update first crossover to match mono bass frequency
                if self.auto_mono_bass {
                    self.crossover_freqs[0] = self.mono_bass_freq;
                    self.splitter.set_freqs(
                        self.crossover_freqs[0], self.crossover_freqs[1], self.crossover_freqs[2],
                        self.sample_rate,
                    );
                }
            }
            _ => {}
        }

        // Per-band width: img_width0..img_width3
        if name.starts_with("img_width") {
            if let Some(idx_char) = name.as_bytes().get(9) {
                let idx = (*idx_char - b'0') as usize;
                if idx < NUM_BANDS {
                    self.band_width[idx] = value.clamp(0.0, 2.0);
                }
            }
        }

        // Crossover: img_xover0..img_xover2
        if name.starts_with("img_xover") {
            if let Some(idx_char) = name.as_bytes().get(9) {
                let idx = (*idx_char - b'0') as usize;
                if idx < 3 {
                    self.crossover_freqs[idx] = (value as f64).clamp(20.0, 20000.0);
                    self.splitter.set_freqs(
                        self.crossover_freqs[0], self.crossover_freqs[1], self.crossover_freqs[2],
                        self.sample_rate,
                    );
                }
            }
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            self.update_correlation(left, right);
            return;
        }

        for i in 0..left.len() {
            let band_signals = self.splitter.process(left[i], right[i]);
            let mut out_l = 0.0_f32;
            let mut out_r = 0.0_f32;

            for (b_idx, (bl, br)) in band_signals.iter().enumerate() {
                let width = self.band_width[b_idx];
                let (l, r) = apply_width(*bl, *br, width);
                out_l += l;
                out_r += r;
            }

            left[i] = out_l;
            right[i] = out_r;
        }

        self.update_correlation(left, right);
    }

    fn update_correlation(&mut self, left: &[f32], right: &[f32]) {
        let a = self.corr_alpha;
        for i in 0..left.len() {
            let l = left[i] as f64;
            let r = right[i] as f64;
            self.lr_sum = a * self.lr_sum + (1.0 - a) * l * r;
            self.l_sq_sum = a * self.l_sq_sum + (1.0 - a) * l * l;
            self.r_sq_sum = a * self.r_sq_sum + (1.0 - a) * r * r;
        }
        let denom = (self.l_sq_sum * self.r_sq_sum).sqrt();
        self.meter_correlation = if denom < 1e-9 { 0.0 } else { (self.lr_sum / denom) as f32 };
    }

    pub fn get_correlation(&self) -> f32 { self.meter_correlation }
    pub fn is_bypassed(&self) -> bool { self.bypassed }
}

#[inline]
fn apply_width(l: f32, r: f32, width: f32) -> (f32, f32) {
    let m = (l + r) * INV_SQRT2;
    let s = (l - r) * INV_SQRT2;
    let s_scaled = s * width;
    let m_scaled = m * (2.0 - width).max(0.0);
    let out_l = (m_scaled + s_scaled) * INV_SQRT2;
    let out_r = (m_scaled - s_scaled) * INV_SQRT2;
    (out_l, out_r)
}
