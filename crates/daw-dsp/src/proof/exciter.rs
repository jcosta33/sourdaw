//! Harmonic exciter — tape, tube, and transistor saturation with per-band control.

use super::biquad::{BiquadCoeffs, BiquadState};
use super::crossover::FourBandSplitter;
use super::oversample::Oversampler2x;

const NUM_BANDS: usize = 4;

#[derive(Clone, Copy, PartialEq)]
pub enum SaturationType {
    Tape,
    Tube,
    Transistor,
    Warm,
}

/// Per-band exciter with saturation and blend control.
struct BandExciter {
    sat_type: SaturationType,
    drive: f32,       // 0.0–1.0
    blend: f32,       // 0.0–1.0 wet/dry
    enabled: bool,
    // Tape pre/de-emphasis
    pre_emph_l: BiquadState,
    pre_emph_r: BiquadState,
    de_emph_l: BiquadState,
    de_emph_r: BiquadState,
    pre_coeffs: BiquadCoeffs,
    de_coeffs: BiquadCoeffs,
    // 2x oversampling for anti-aliasing
    os_l: Oversampler2x,
    os_r: Oversampler2x,
}

impl BandExciter {
    fn new(sr: f64) -> Self {
        Self {
            sat_type: SaturationType::Tape,
            drive: 0.3,
            blend: 0.5,
            enabled: false,
            pre_emph_l: BiquadState::new(),
            pre_emph_r: BiquadState::new(),
            de_emph_l: BiquadState::new(),
            de_emph_r: BiquadState::new(),
            // +6 dB high shelf at 10kHz for tape pre-emphasis
            pre_coeffs: BiquadCoeffs::high_shelf(10000.0, 6.0, 0.707, sr),
            // -6 dB high shelf at 10kHz for tape de-emphasis
            de_coeffs: BiquadCoeffs::high_shelf(10000.0, -6.0, 0.707, sr),
            os_l: Oversampler2x::new(),
            os_r: Oversampler2x::new(),
        }
    }

    #[inline]
    fn process_sample(&mut self, l: f32, r: f32) -> (f32, f32) {
        if !self.enabled || self.blend < 0.001 { return (l, r); }

        let drive_amount = 1.0 + self.drive * 3.0;

        // 2x oversample: upsample → saturate at 2x rate → downsample
        let (up_l0, up_l1) = self.os_l.upsample(l);
        let (up_r0, up_r1) = self.os_r.upsample(r);

        let sat_fn = |s: f32| -> f32 {
            match self.sat_type {
                SaturationType::Tape => {
                    let bias = 0.15 * self.drive;
                    (drive_amount * (s + bias)).tanh() - bias.tanh()
                }
                SaturationType::Tube => {
                    let asym = 0.3 * self.drive;
                    tube_sat(s, drive_amount, asym)
                }
                SaturationType::Transistor => {
                    let knee = 0.3 - 0.2 * self.drive;
                    transistor_clip(s, drive_amount, knee)
                }
                SaturationType::Warm => {
                    let bias = 0.05;
                    (drive_amount * 0.5 * (s + bias)).tanh() - bias.tanh()
                }
            }
        };

        // Saturate at 2x sample rate
        let sat_l0 = sat_fn(up_l0);
        let sat_l1 = sat_fn(up_l1);
        let sat_r0 = sat_fn(up_r0);
        let sat_r1 = sat_fn(up_r1);

        // Downsample back to original rate
        let wet_l = self.os_l.downsample(sat_l0, sat_l1);
        let wet_r = self.os_r.downsample(sat_r0, sat_r1);

        // Apply tape pre/de-emphasis (at original sample rate)
        let (wet_l, wet_r) = if self.sat_type == SaturationType::Tape {
            let pre_l = self.pre_emph_l.process(wet_l, &self.pre_coeffs);
            let pre_r = self.pre_emph_r.process(wet_r, &self.pre_coeffs);
            let de_l = self.de_emph_l.process(pre_l, &self.de_coeffs);
            let de_r = self.de_emph_r.process(pre_r, &self.de_coeffs);
            (de_l, de_r)
        } else {
            (wet_l, wet_r)
        };

        // Parallel blend
        let out_l = l * (1.0 - self.blend) + wet_l * self.blend;
        let out_r = r * (1.0 - self.blend) + wet_r * self.blend;
        (out_l, out_r)
    }
}

pub struct HarmonicExciter {
    splitter: FourBandSplitter,
    bands: [BandExciter; NUM_BANDS],
    crossover_freqs: [f64; 3],
    sample_rate: f64,
    bypassed: bool,
}

impl HarmonicExciter {
    pub fn new(sr: f64) -> Self {
        let freqs = [120.0, 1000.0, 8000.0];
        Self {
            splitter: FourBandSplitter::new(freqs[0], freqs[1], freqs[2], sr),
            bands: core::array::from_fn(|_| BandExciter::new(sr)),
            crossover_freqs: freqs,
            sample_rate: sr,
            bypassed: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if name == "exc_bypass" { self.bypassed = value > 0.5; return; }

        // Per-band: exc_bandN_param
        if !name.starts_with("exc_band") || name.len() < 11 { return; }
        let idx = match name.as_bytes()[8] {
            b'0'..=b'3' => (name.as_bytes()[8] - b'0') as usize,
            _ => return,
        };
        let param = &name[10..];

        match param {
            "type" => {
                self.bands[idx].sat_type = match value as u32 {
                    0 => SaturationType::Tape, 1 => SaturationType::Tube,
                    2 => SaturationType::Transistor, 3 => SaturationType::Warm,
                    _ => SaturationType::Tape,
                };
            }
            "drive" => self.bands[idx].drive = value.clamp(0.0, 1.0),
            "blend" => self.bands[idx].blend = value.clamp(0.0, 1.0),
            "enabled" => self.bands[idx].enabled = value > 0.5,
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed { return; }

        for i in 0..left.len() {
            let band_signals = self.splitter.process(left[i], right[i]);
            let mut out_l = 0.0_f32;
            let mut out_r = 0.0_f32;

            for (b_idx, (bl, br)) in band_signals.iter().enumerate() {
                let (l, r) = self.bands[b_idx].process_sample(*bl, *br);
                out_l += l;
                out_r += r;
            }

            left[i] = out_l;
            right[i] = out_r;
        }
    }

    pub fn is_bypassed(&self) -> bool { self.bypassed }
}

#[inline]
fn tube_sat(x: f32, drive: f32, asymmetry: f32) -> f32 {
    let pos_drive = drive * (1.0 + asymmetry);
    let neg_drive = drive * (1.0 - asymmetry * 0.5);
    if x >= 0.0 {
        (pos_drive * x).tanh() / pos_drive.max(0.01)
    } else {
        (neg_drive * x).tanh() / neg_drive.max(0.01)
    }
}

#[inline]
fn transistor_clip(x: f32, drive: f32, knee: f32) -> f32 {
    let x = x * drive;
    let threshold = 1.0 - knee;
    if x.abs() < threshold {
        x / drive.max(0.01)
    } else {
        let excess = x.abs() - threshold;
        let knee_region = excess / (knee + 1e-6);
        let clipped = threshold + knee * (2.0 * knee_region - knee_region * knee_region).max(0.0).min(1.0);
        clipped * x.signum() / drive.max(0.01)
    }
}
