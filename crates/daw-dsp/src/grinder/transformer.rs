//! Output transformer modeling with hysteresis and low-frequency saturation.
//!
//! Φ(H) = sgn(H) · Φ_sat · tanh((|H| - H_c) / H_sat)
//!
//! Uses a smooth nonlinear flux model for magnetic saturation.

use crate::primitives::flush_denormal;

/// Output transformer with hysteresis-like behavior.
pub struct Transformer {
    // Saturation parameters
    phi_sat: f32, // saturation flux scaling
    h_c: f32,     // coercive-force term
    h_sat: f32,   // saturation-shape scaling

    // State
    flux_state: f32,
    prev_input: f32,

    // User controls
    drive: f32,
    hysteresis: f32,
    lf_saturation: f32,

    // Low-frequency emphasis filter
    lf_state: f32,
    lf_freq: f32,
    sample_rate: f32,
}

impl Transformer {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phi_sat: 1.0,
            h_c: 0.1,
            h_sat: 0.5,
            flux_state: 0.0,
            prev_input: 0.0,
            drive: 0.3,
            hysteresis: 0.3,
            lf_saturation: 0.3,
            lf_state: 0.0,
            lf_freq: 120.0,
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "transformerDrive" => {
                self.drive = value;
                self.phi_sat = 0.5 + value * 1.5;
            }
            "transformerHysteresis" => {
                self.hysteresis = value;
                self.h_c = value * 0.3;
            }
            "transformerLfSaturation" => {
                self.lf_saturation = value;
                self.h_sat = 0.2 + (1.0 - value) * 0.8;
            }
            _ => {}
        }
    }

    /// Smooth hysteresis function: Φ(H) = sgn(H) · Φ_sat · tanh((|H| - H_c) / H_sat)
    fn flux_response(&self, h: f32) -> f32 {
        let abs_h = h.abs();
        let inner = (abs_h - self.h_c).max(0.0) / self.h_sat.max(0.01);
        let sign = if h > 0.0 {
            1.0
        } else if h < 0.0 {
            -1.0
        } else {
            0.0
        };
        sign * self.phi_sat * inner.tanh()
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.drive < 0.01 {
            return input;
        }

        let dt = 1.0 / self.sample_rate;

        // Low-frequency emphasis: extract LF content for heavier saturation
        let lf_coeff = (2.0 * std::f32::consts::PI * self.lf_freq * dt).min(0.5);
        self.lf_state = flush_denormal(self.lf_state + lf_coeff * (input - self.lf_state));
        let lf_content = self.lf_state;
        let hf_content = input - lf_content;

        // Apply drive scaling
        let driven = input * (1.0 + self.drive * 3.0);

        // Magnetic saturation
        let flux = self.flux_response(driven);

        // Hysteresis: flux state has memory between samples
        let hysteresis_blend = self.hysteresis * 0.5;
        // DSP-2: the hysteresis memory term keeps decaying after the input stops,
        // so it lands in the subnormal range instead of reaching zero.
        self.flux_state =
            flush_denormal(flux * (1.0 - hysteresis_blend) + self.flux_state * hysteresis_blend);

        // LF saturation emphasis: saturate LF more heavily
        let lf_saturated = self.flux_response(lf_content * (1.0 + self.lf_saturation * 4.0));
        let output = (self.flux_state - lf_content * self.drive)
            + lf_saturated * self.lf_saturation * 0.3
            + hf_content * (1.0 - self.drive * 0.3);

        // Normalize to prevent volume jumps
        let output_scaled = output / (1.0 + self.drive);

        self.prev_input = input;
        output_scaled
    }

    pub fn reset(&mut self) {
        self.flux_state = 0.0;
        self.prev_input = 0.0;
        self.lf_state = 0.0;
    }
}
