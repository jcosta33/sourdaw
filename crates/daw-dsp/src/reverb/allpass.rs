//! Allpass delay lines used in the Dattorro Reverb structure.
//! Supports fixed delays and allpass-interpolated modulated delays.

use crate::reverb::delay::DelayLine;

pub struct AllpassDelay {
    delay_line: DelayLine,
    delay_samples: usize,
    coefficient: f32,
}

impl AllpassDelay {
    pub fn new(max_delay: usize, fixed_delay: usize, coeff: f32) -> Self {
        Self {
            delay_line: DelayLine::new(max_delay),
            delay_samples: fixed_delay,
            coefficient: coeff,
        }
    }

    /// Process a fixed allpass (no modulation)
    #[inline(always)]
    pub fn process_fixed(&mut self, input: f32) -> f32 {
        let delayed = self.delay_line.read(self.delay_samples);
        let fb = input + delayed * self.coefficient;
        let output = delayed - fb * self.coefficient;
        self.delay_line.write(fb);
        output
    }

    /// Process with fractional modulation using allpass interpolation as required by Dattorro
    #[inline(always)]
    pub fn process_modulated(&mut self, input: f32, delay_fractional: f32, pre_filtered_prev: &mut f32) -> f32 {
        let int_delay = delay_fractional.floor() as usize;
        let frac_delay = delay_fractional - int_delay as f32; // alpha

        // Read integer taps
        let d_n0 = self.delay_line.read(int_delay);
        let d_n1 = self.delay_line.read(int_delay + 1);

        // Allpass interpolation (a first-order allpass section to perform sub-sample delay)
        // y[n] = x[n-1] + (1 - alpha)/(1 + alpha) * (x[n] - y[n-1])
        // To approximate without division on hot path, we use standard interpolation but
        // since Dattorro specifies explicit allpass interpolation:
        let ap_coeff = (1.0 - frac_delay) / (1.0 + frac_delay);
        let interpolated = d_n1 + ap_coeff * (d_n0 - *pre_filtered_prev);
        *pre_filtered_prev = interpolated;

        let fb = input + interpolated * self.coefficient;
        let output = interpolated - fb * self.coefficient;
        
        self.delay_line.write(fb);
        output
    }
}
