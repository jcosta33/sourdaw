//! Lo-fi vintage processing — bit reduction, sample rate reduction, analog filter.
//! Inspired by E-mu SP-1200 (12-bit @ 26.04kHz).

pub struct LofiProcessor {
    // Bit reduction
    bit_depth: u8,          // 4-16 (16 = off)
    // Sample rate reduction
    target_rate: f32,       // reduced sample rate (8000-44100)
    hold_value_l: f32,
    hold_value_r: f32,
    hold_counter: f32,
    // Analog filter (one-pole lowpass simulating reconstruction filter)
    filter_state_l: f32,
    filter_state_r: f32,
    filter_coeff: f32,
    // Mix
    mix: f32,               // 0-1
}

impl LofiProcessor {
    pub fn new() -> Self {
        Self {
            bit_depth: 16,
            target_rate: 44100.0,
            hold_value_l: 0.0, hold_value_r: 0.0,
            hold_counter: 0.0,
            filter_state_l: 0.0, filter_state_r: 0.0,
            filter_coeff: 1.0,
            mix: 0.0,
        }
    }

    pub fn set_bit_depth(&mut self, bits: u8) {
        self.bit_depth = bits.clamp(4, 16);
    }

    pub fn set_rate_reduction(&mut self, target_rate: f32, sample_rate: f32) {
        self.target_rate = target_rate.clamp(4000.0, sample_rate);
        // Set analog filter cutoff to reduced Nyquist
        let nyquist = self.target_rate * 0.5;
        self.filter_coeff = (core::f32::consts::PI * nyquist / sample_rate).min(1.0);
    }

    pub fn set_mix(&mut self, mix: f32) {
        self.mix = mix.clamp(0.0, 1.0);
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], sample_rate: f32) {
        if self.mix < 0.001 { return; }

        let rate_ratio = sample_rate / self.target_rate;
        let levels = (2.0f32).powi(self.bit_depth as i32 - 1);

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];

            // Sample rate reduction (sample-and-hold)
            self.hold_counter += 1.0;
            if self.hold_counter >= rate_ratio {
                self.hold_counter -= rate_ratio;
                // Bit depth reduction with quantization
                self.hold_value_l = (left[i] * levels).round() / levels;
                self.hold_value_r = (right[i] * levels).round() / levels;
            }

            // Analog reconstruction filter (one-pole lowpass)
            self.filter_state_l += self.filter_coeff * (self.hold_value_l - self.filter_state_l);
            self.filter_state_r += self.filter_coeff * (self.hold_value_r - self.filter_state_r);

            // Mix
            left[i] = dry_l * (1.0 - self.mix) + self.filter_state_l * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + self.filter_state_r * self.mix;
        }
    }
}
