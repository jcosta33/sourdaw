//! Bounded acoustic-radiation model for Grand Boule's lid and microphone view.
//!
//! The finite FIR soundboard remains the instrument body. This stage shapes what a
//! listener hears from that body: a continuous lid transfer and three named,
//! deliberately parametric listening perspectives. It does not claim measured
//! microphone brands or coordinates.

use crate::primitives::flush_denormal;

const SPECTRAL_SPLIT_HZ: f32 = 2_500.0;
const SMOOTH_SECONDS: f32 = 0.02;

#[derive(Clone, Copy)]
struct Response {
    low: f32,
    high: f32,
    side: f32,
}

impl Response {
    const NEUTRAL: Self = Self {
        low: 1.0,
        high: 1.0,
        side: 1.0,
    };
}

pub struct RadiationModel {
    split_alpha: f32,
    smooth_alpha: f32,
    low_left: f32,
    low_right: f32,
    current: Response,
    target: Response,
    lid_position: f32,
    mic_position: u8,
}

impl RadiationModel {
    pub fn new(sample_rate: f32) -> Self {
        let safe_rate = sample_rate.max(1.0);
        let split_alpha = 1.0 - (-core::f32::consts::TAU * SPECTRAL_SPLIT_HZ / safe_rate).exp();
        let smooth_alpha = 1.0 - (-1.0 / (SMOOTH_SECONDS * safe_rate)).exp();
        Self {
            split_alpha,
            smooth_alpha,
            low_left: 0.0,
            low_right: 0.0,
            current: Response::NEUTRAL,
            target: Response::NEUTRAL,
            lid_position: 1.0,
            mic_position: 1,
        }
    }

    pub fn reset(&mut self) {
        self.low_left = 0.0;
        self.low_right = 0.0;
    }

    pub fn snap_to_target(&mut self) {
        self.current = self.target;
    }

    pub fn set_lid_position(&mut self, value: f32) {
        if !value.is_finite() {
            return;
        }
        self.lid_position = value.clamp(0.0, 1.0);
        self.refresh_target();
    }

    pub fn set_mic_position(&mut self, value: f32) {
        if !value.is_finite() {
            return;
        }
        self.mic_position = value.round().clamp(0.0, 2.0) as u8;
        self.refresh_target();
    }

    fn refresh_target(&mut self) {
        let mic = match self.mic_position {
            // Close: reduced body, retained attack, slightly narrower pickup.
            0 => Response {
                low: 0.82,
                high: 1.0,
                side: 0.86,
            },
            // Player: migration-safe identity at fully open lid.
            1 => Response::NEUTRAL,
            // Room: softer, darker and less locally decorrelated.
            _ => Response {
                low: 0.9,
                high: 0.64,
                side: 0.62,
            },
        };
        let lid = Response {
            low: 0.78 + 0.22 * self.lid_position,
            high: 0.3 + 0.7 * self.lid_position,
            side: 0.42 + 0.58 * self.lid_position,
        };
        self.target = Response {
            low: mic.low * lid.low,
            high: mic.high * lid.high,
            side: mic.side * lid.side,
        };
    }

    #[inline]
    pub fn tick(&mut self, left: f32, right: f32) -> (f32, f32) {
        let left = if left.is_finite() { left } else { 0.0 };
        let right = if right.is_finite() { right } else { 0.0 };

        self.current.low += (self.target.low - self.current.low) * self.smooth_alpha;
        self.current.high += (self.target.high - self.current.high) * self.smooth_alpha;
        self.current.side += (self.target.side - self.current.side) * self.smooth_alpha;

        self.low_left = flush_denormal(self.low_left + (left - self.low_left) * self.split_alpha);
        self.low_right =
            flush_denormal(self.low_right + (right - self.low_right) * self.split_alpha);

        let filtered_left =
            self.low_left * self.current.low + (left - self.low_left) * self.current.high;
        let filtered_right =
            self.low_right * self.current.low + (right - self.low_right) * self.current.high;
        let mid = (filtered_left + filtered_right) * 0.5;
        let side = (filtered_left - filtered_right) * 0.5 * self.current.side;
        (mid + side, mid - side)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_player_open_response_is_identity() {
        let mut model = RadiationModel::new(48_000.0);
        for (left, right) in [(0.5, -0.25), (-0.75, 0.4), (0.0, 0.0)] {
            let (actual_left, actual_right) = model.tick(left, right);
            assert!((actual_left - left).abs() < 1.0e-6);
            assert!((actual_right - right).abs() < 1.0e-6);
        }
    }

    #[test]
    fn parameter_change_is_smoothed_instead_of_stepped() {
        let mut model = RadiationModel::new(48_000.0);
        let before = model.tick(0.5, 0.5).0;
        model.set_lid_position(0.0);
        let after = model.tick(0.5, 0.5).0;
        assert!((after - before).abs() < 0.001);
    }

    #[test]
    fn non_finite_input_does_not_poison_later_audio() {
        let mut model = RadiationModel::new(48_000.0);

        let invalid = model.tick(f32::NAN, f32::INFINITY);
        assert!(invalid.0.is_finite());
        assert!(invalid.1.is_finite());

        let recovered = model.tick(0.25, -0.125);
        assert!((recovered.0 - 0.25).abs() < 1.0e-6);
        assert!((recovered.1 + 0.125).abs() < 1.0e-6);
    }
}
