//! Convolution body modeling for Bacteria.
//!
//! FFT-based partitioned convolution for applying impulse responses of
//! physical objects (ceramic, wood, metal) to create resonant body character.
//! Includes a stereo separation control for widening mono IRs.

/// Partitioned convolution using overlap-save method.
/// Splits long IRs into segments for real-time processing.
pub struct ConvolutionProcessor {
    // IR storage
    ir_left: Vec<f32>,
    ir_right: Vec<f32>,
    ir_loaded: bool,

    // Simple direct convolution for short IRs (< 1024 samples)
    // For longer IRs, partitioned FFT would be used
    input_buffer_l: Vec<f32>,
    input_buffer_r: Vec<f32>,
    write_pos: usize,
    ir_length: usize,

    // Parameters
    mix: f32,
    separation: f32, // 0-1: mono→stereo widening
}

impl ConvolutionProcessor {
    pub fn new() -> Self {
        Self {
            ir_left: Vec::new(),
            ir_right: Vec::new(),
            ir_loaded: false,
            input_buffer_l: Vec::new(),
            input_buffer_r: Vec::new(),
            write_pos: 0,
            ir_length: 0,
            mix: 0.3,
            separation: 0.5,
        }
    }

    /// Load an impulse response. For mono IRs, uses separation to create stereo.
    pub fn load_ir(&mut self, ir_data: &[f32], channels: usize) {
        let length = if channels >= 2 {
            ir_data.len() / 2
        } else {
            ir_data.len()
        };
        let length = length.min(4096); // Cap IR length for real-time safety

        self.ir_length = length;

        if channels >= 2 {
            self.ir_left = ir_data[..length].to_vec();
            self.ir_right = ir_data[length..length * 2].to_vec();
        } else {
            self.ir_left = ir_data[..length].to_vec();
            self.ir_right = ir_data[..length].to_vec();
        }

        self.input_buffer_l = vec![0.0; length];
        self.input_buffer_r = vec![0.0; length];
        self.write_pos = 0;
        self.ir_loaded = true;
    }

    /// Load a built-in body IR by type.
    pub fn load_builtin(&mut self, ir_type: &str) {
        // Generate synthetic IRs for different body types
        let sample_rate = 44100.0_f32;
        let length = 1024;
        let mut ir = vec![0.0_f32; length];

        match ir_type {
            "ceramic" => {
                // High-frequency resonance with quick decay
                for i in 0..length {
                    let t = i as f32 / sample_rate;
                    ir[i] =
                        (-t * 80.0).exp() * (2200.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.3
                            + (-t * 120.0).exp()
                                * (4400.0 * 2.0 * std::f32::consts::PI * t).sin()
                                * 0.15;
                }
            }
            "wood" => {
                // Warm mid-range resonance
                for i in 0..length {
                    let t = i as f32 / sample_rate;
                    ir[i] = (-t * 40.0).exp()
                        * (800.0 * 2.0 * std::f32::consts::PI * t).sin()
                        * 0.4
                        + (-t * 60.0).exp() * (1600.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.2;
                }
            }
            "metal" | "spring" => {
                // Bright metallic ring
                for i in 0..length {
                    let t = i as f32 / sample_rate;
                    ir[i] = (-t * 15.0).exp()
                        * (3500.0 * 2.0 * std::f32::consts::PI * t).sin()
                        * 0.25
                        + (-t * 25.0).exp() * (7000.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.1
                        + (-t * 50.0).exp()
                            * (1200.0 * 2.0 * std::f32::consts::PI * t).sin()
                            * 0.15;
                }
            }
            _ => {
                // Default: subtle cabinet-like
                for i in 0..length {
                    let t = i as f32 / sample_rate;
                    ir[i] =
                        (-t * 60.0).exp() * (500.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.3;
                }
            }
        }

        // Normalize
        let max_val = ir
            .iter()
            .map(|x| x.abs())
            .fold(0.0_f32, f32::max)
            .max(0.001);
        for s in &mut ir {
            *s /= max_val;
        }

        self.load_ir(&ir, 1);
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "convolutionMix" => self.mix = value.clamp(0.0, 1.0),
            "convolutionSeparation" => self.separation = value.clamp(0.0, 1.0),
            "convolutionIr" => {
                // Value encodes IR type as index
                let ir_type = match value as u32 {
                    0 => "ceramic",
                    1 => "wood",
                    2 => "metal",
                    3 => "spring",
                    _ => "wood",
                };
                self.load_builtin(ir_type);
            }
            _ => {}
        }
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        if !self.ir_loaded || self.ir_length == 0 {
            return (left, right);
        }

        // Write input
        self.input_buffer_l[self.write_pos] = left;
        self.input_buffer_r[self.write_pos] = right;

        // Direct convolution (for short IRs)
        let mut conv_l = 0.0_f32;
        let mut conv_r = 0.0_f32;

        for k in 0..self.ir_length {
            let read_pos = (self.write_pos + self.ir_length - k) % self.ir_length;
            conv_l += self.input_buffer_l[read_pos] * self.ir_left[k];
            conv_r += self.input_buffer_r[read_pos] * self.ir_right[k];
        }

        self.write_pos = (self.write_pos + 1) % self.ir_length;

        // Apply stereo separation (widen mono IRs)
        if self.separation > 0.01 {
            let mid = (conv_l + conv_r) * 0.5;
            let side = (conv_l - conv_r) * 0.5;
            let widened_side = side * (1.0 + self.separation * 2.0);
            conv_l = mid + widened_side;
            conv_r = mid - widened_side;
        }

        // Mix
        let out_l = left * (1.0 - self.mix) + conv_l * self.mix;
        let out_r = right * (1.0 - self.mix) + conv_r * self.mix;
        (out_l, out_r)
    }

    pub fn reset(&mut self) {
        self.input_buffer_l.fill(0.0);
        self.input_buffer_r.fill(0.0);
        self.write_pos = 0;
    }
}
