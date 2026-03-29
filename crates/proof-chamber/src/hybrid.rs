/// Hybrid reverb — combines convolution (early reflections / room character)
/// with algorithmic reverb (controllable tail with modulation).
///
/// Two routing modes:
/// - Parallel: both engines process input independently, blend with crossfader
/// - Series: convolution first (early), then algorithmic (tail extension)
///
/// Power-complementary crossfade: w_conv² + w_algo² = 1 at all times.

use crate::proof_chamber::ProofChamber;
use crate::convolution::ConvolutionEngine;

#[derive(Clone, Copy, PartialEq)]
pub enum HybridMode {
    Off,       // Algorithm only
    Parallel,  // Both process input, blend output
    Series,    // Convolution → algorithm
}

pub struct HybridReverb {
    pub convolution: ConvolutionEngine,
    pub algorithmic: ProofChamber,
    pub mode: HybridMode,
    pub blend: f32, // 0 = all convolution, 1 = all algorithmic
    scratch_l: Vec<f32>,
    scratch_r: Vec<f32>,
}

impl HybridReverb {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            convolution: ConvolutionEngine::new(sample_rate),
            algorithmic: ProofChamber::new(sample_rate),
            mode: HybridMode::Off,
            blend: 0.5,
            scratch_l: vec![0.0; 1024],
            scratch_r: vec![0.0; 1024],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "hybrid_mode" => {
                self.mode = match value as u8 {
                    0 => HybridMode::Off,
                    1 => HybridMode::Parallel,
                    2 => HybridMode::Series,
                    _ => HybridMode::Off,
                };
            }
            "hybrid_blend" => self.blend = value.clamp(0.0, 1.0),
            "conv_mix" => self.convolution.set_param("mix", value),
            n => {
                // Forward to both engines
                self.algorithmic.set_param(n, value);
                self.convolution.set_param(n, value);
            }
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let len = left.len();

        match self.mode {
            HybridMode::Off => {
                // Algorithm only
                self.algorithmic.process(left, right);
            }
            HybridMode::Parallel => {
                // Both process the same input, blend outputs
                if self.scratch_l.len() < len {
                    self.scratch_l.resize(len, 0.0);
                    self.scratch_r.resize(len, 0.0);
                }

                // Copy input for convolution path
                self.scratch_l[..len].copy_from_slice(&left[..len]);
                self.scratch_r[..len].copy_from_slice(&right[..len]);

                // Process both
                self.algorithmic.process(left, right);
                self.convolution.process(&mut self.scratch_l[..len], &mut self.scratch_r[..len]);

                // Power-complementary crossfade
                let angle = self.blend * std::f32::consts::FRAC_PI_2;
                let w_algo = angle.sin();
                let w_conv = angle.cos();

                for i in 0..len {
                    left[i] = left[i] * w_algo + self.scratch_l[i] * w_conv;
                    right[i] = right[i] * w_algo + self.scratch_r[i] * w_conv;
                }
            }
            HybridMode::Series => {
                // Convolution first (early reflections), then algorithmic (tail)
                self.convolution.process(left, right);
                self.algorithmic.process(left, right);
            }
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["hybrid_mode", "hybrid_blend", "conv_mix"]
    }
}
