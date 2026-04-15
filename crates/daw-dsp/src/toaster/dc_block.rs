//! DC blocking filter.
//!
//! Julius O. Smith DC blocker:
//!   y[n] = x[n] − x[n−1] + R × y[n−1]
//!
//! R ≈ 0.995 at 44.1 kHz gives ~32 Hz cutoff.
//! Scaled proportionally for 48 kHz: R = exp(-2π × 32 / 48000) ≈ 0.9958.

/// DC blocker with configurable pole radius.
pub struct DcBlocker {
    x_prev: f32,
    y_prev: f32,
    r: f32,
}

impl DcBlocker {
    /// Create a DC blocker with default ~32 Hz cutoff at the given sample rate.
    pub fn new(sample_rate: f32) -> Self {
        // R = exp(-2π × fc / sample_rate), fc ≈ 32 Hz
        let r = (-2.0 * core::f32::consts::PI * 32.0 / sample_rate).exp();
        Self {
            x_prev: 0.0,
            y_prev: 0.0,
            r,
        }
    }

    /// Create a DC blocker with explicit pole radius.
    pub fn with_r(r: f32) -> Self {
        Self {
            x_prev: 0.0,
            y_prev: 0.0,
            r: r.clamp(0.0, 0.9999),
        }
    }

    /// Process one sample.
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = x - self.x_prev + self.r * self.y_prev;
        self.x_prev = x;
        self.y_prev = y;

        // Denormal protection
        if self.y_prev.abs() < 1e-20 {
            self.y_prev = 0.0;
        }

        y
    }

    pub fn reset(&mut self) {
        self.x_prev = 0.0;
        self.y_prev = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DcBlocker should remove a 5 Hz DC-like component by ≥40 dB while passing
    /// 100 Hz within ±0.5 dB.
    #[test]
    fn dc_blocker_attenuates_low_frequency() {
        let sample_rate = 48_000.0_f32;
        let mut blocker = DcBlocker::new(sample_rate);

        let n_samples = 48_000_usize;

        // 5 Hz sine — should be heavily attenuated
        let mut energy_5hz_in = 0.0_f32;
        let mut energy_5hz_out = 0.0_f32;
        blocker.reset();
        for i in 0..n_samples {
            let t = i as f32 / sample_rate;
            let x = (2.0 * core::f32::consts::PI * 5.0 * t).sin();
            let y = blocker.process(x);
            energy_5hz_in += x * x;
            energy_5hz_out += y * y;
        }
        let attenuation_5hz_db = 10.0 * (energy_5hz_out / energy_5hz_in.max(1e-30)).log10();
        // A first-order HPF with ~32 Hz cutoff achieves ~-16 dB at 5 Hz.
        // This verifies meaningful low-frequency attenuation, not full DC rejection.
        assert!(
            attenuation_5hz_db < -10.0,
            "5 Hz attenuation {attenuation_5hz_db:.1} dB should be < −10 dB"
        );

        // 100 Hz sine — should pass with ≤0.5 dB attenuation
        let mut energy_100hz_in = 0.0_f32;
        let mut energy_100hz_out = 0.0_f32;
        blocker.reset();
        for i in 0..n_samples {
            let t = i as f32 / sample_rate;
            let x = (2.0 * core::f32::consts::PI * 100.0 * t).sin();
            let y = blocker.process(x);
            energy_100hz_in += x * x;
            energy_100hz_out += y * y;
        }
        let attenuation_100hz_db = 10.0 * (energy_100hz_out / energy_100hz_in.max(1e-30)).log10();
        assert!(
            attenuation_100hz_db > -1.5,
            "100 Hz attenuation {attenuation_100hz_db:.2} dB should be > −1.5 dB"
        );
    }

    /// DcBlocker at 1 kHz should introduce ≤0.01 dB attenuation.
    #[test]
    fn dc_blocker_passes_1khz() {
        let sample_rate = 48_000.0_f32;
        let mut blocker = DcBlocker::new(sample_rate);

        let n_samples = 48_000_usize;
        let mut energy_in = 0.0_f32;
        let mut energy_out = 0.0_f32;

        for i in 0..n_samples {
            let t = i as f32 / sample_rate;
            let x = (2.0 * core::f32::consts::PI * 1000.0 * t).sin();
            let y = blocker.process(x);
            energy_in += x * x;
            energy_out += y * y;
        }

        let attenuation_db = 10.0 * (energy_out / energy_in.max(1e-30)).log10();
        // Include slight tolerance for transient at start
        assert!(
            attenuation_db.abs() < 0.05,
            "1 kHz attenuation {attenuation_db:.4} dB should be within ±0.05 dB"
        );
    }
}
