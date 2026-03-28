//! Spectral warp modes — runtime timbral transforms applied to oscillator output.
//! Inspired by Vital's spectral morph system but implemented as time-domain processing.

#[derive(Clone, Copy)]
pub enum WarpMode {
    None,
    Sync,        // Hard sync simulation — wraps the waveform at a variable point
    Quantize,    // Bit-reduction / sample-rate reduction
    Squeeze,     // Asymmetric waveshaping — pushes waveform toward one polarity
    Bend,        // Nonlinear phase distortion — bends the waveform shape
    Formant,     // Simple formant-like resonance applied to waveform
    Fold,        // Wavefolding — folds the signal back on itself
}

pub struct SpectralWarp {
    mode: WarpMode,
    amount: f32,    // 0-1 warp intensity
    // State for quantize mode
    hold_value: f32,
    hold_counter: f32,
}

impl SpectralWarp {
    pub fn new() -> Self {
        Self { mode: WarpMode::None, amount: 0.0, hold_value: 0.0, hold_counter: 0.0 }
    }

    pub fn set_mode(&mut self, mode: u8) {
        self.mode = match mode {
            1 => WarpMode::Sync,
            2 => WarpMode::Quantize,
            3 => WarpMode::Squeeze,
            4 => WarpMode::Bend,
            5 => WarpMode::Formant,
            6 => WarpMode::Fold,
            _ => WarpMode::None,
        };
    }

    pub fn set_amount(&mut self, amount: f32) {
        self.amount = amount.clamp(0.0, 1.0);
    }

    /// Apply the warp to a single sample.
    #[inline]
    pub fn process(&mut self, input: f32, phase: f32) -> f32 {
        if self.amount < 0.001 {
            return input;
        }
        let a = self.amount;

        match self.mode {
            WarpMode::None => input,

            WarpMode::Sync => {
                // Hard sync simulation: wrap phase at a variable point
                let sync_freq = 1.0 + a * 7.0; // 1x to 8x
                let sync_phase = (phase * sync_freq) % 1.0;
                let blend = a;
                let synced = (sync_phase * core::f32::consts::TAU).sin();
                input * (1.0 - blend) + synced * blend
            }

            WarpMode::Quantize => {
                // Sample rate / bit reduction
                let rate_div = 1.0 + a * 31.0; // 1x to 32x reduction
                self.hold_counter += 1.0;
                if self.hold_counter >= rate_div {
                    self.hold_counter = 0.0;
                    // Bit reduction
                    let bits = 2.0 + (1.0 - a) * 14.0; // 16 bits down to 2
                    let levels = (2.0f32).powf(bits);
                    self.hold_value = (input * levels).round() / levels;
                }
                self.hold_value
            }

            WarpMode::Squeeze => {
                // Asymmetric: push waveform toward positive or negative
                let bias = a * 2.0 - 1.0; // -1 to 1
                let x = input + bias;
                // Soft clip to keep in range
                let x2 = x * x;
                x * (27.0 + x2) / (27.0 + 9.0 * x2)
            }

            WarpMode::Bend => {
                // Phase distortion — bend the input through a power curve
                let power = 1.0 + a * 3.0; // 1 to 4
                let sign = if input >= 0.0 { 1.0 } else { -1.0 };
                sign * input.abs().powf(power)
            }

            WarpMode::Formant => {
                // Simple comb-filter-like resonance
                // Creates formant-like peaks based on amount
                let comb_freq = 2.0 + a * 10.0;
                let comb = (phase * comb_freq * core::f32::consts::TAU).cos();
                input * (1.0 + comb * a * 0.5)
            }

            WarpMode::Fold => {
                // Wavefolding: fold signal back when it exceeds threshold
                let threshold = 1.0 - a * 0.8; // 1.0 down to 0.2
                let gain = 1.0 + a * 4.0;
                let mut x = input * gain;
                // Fold multiple times
                for _ in 0..4 {
                    if x > threshold {
                        x = 2.0 * threshold - x;
                    } else if x < -threshold {
                        x = -2.0 * threshold - x;
                    }
                }
                x
            }
        }
    }
}
