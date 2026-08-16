//! Distortion algorithms for Bacteria.
//!
//! Supports: soft clip, hard clip, foldback, wavefold, bitcrush,
//! tube emulation, smudge (spectral transient blur into the base shaper).
//!
//! `Breakdown` is selectable in the panel but has no distinct algorithm: the
//! `BreakdownProcessor` it would route to is a stub with no pitch shift. See
//! that type's documentation. It renders as `SoftClip`, and
//! `tests/bacteria_distortion_modes.rs` pins that as a stated fact rather than
//! leaving it to be rediscovered.

use super::stft::SmudgeProcessor;

/// Channels the band chain runs through one `DistortionProcessor`.
const CHANNELS: usize = 2;

/// Distortion mode selector.
#[derive(Clone, Copy, PartialEq)]
pub enum DistortionMode {
    SoftClip,
    HardClip,
    Foldback,
    Wavefold,
    Bitcrush,
    Tube,
    Breakdown,
    Smudge,
    Custom,
}

impl DistortionMode {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::SoftClip,
            1 => Self::HardClip,
            2 => Self::Foldback,
            3 => Self::Wavefold,
            4 => Self::Bitcrush,
            5 => Self::Tube,
            6 => Self::Breakdown,
            7 => Self::Smudge,
            _ => Self::Custom,
        }
    }
}

/// Per-band distortion processor.
pub struct DistortionProcessor {
    mode: DistortionMode,
    drive: f32,           // 0–100
    asymmetry: f32,       // -1 to 1
    fold_threshold: f32,  // 0.1–1.0
    bit_depth: u32,       // 1–24
    sr_reduce: u32,       // sample rate divider
    tube_bias: f32,       // 0–1
    breakdown_depth: f32, // 0–4 octaves

    /// Per-channel sample-and-hold state for Bitcrush's rate reduction.
    ///
    /// Same reason as `smudge`: one shared counter is advanced by both the
    /// left and the right call, so the hold lands on whichever channel happens
    /// to line up with the divider. At an odd divider the two channels
    /// alternate, and each one is handed the other's held sample — a silent
    /// channel comes back carrying the loud one.
    sr_counter: [u32; CHANNELS], // sample-rate reduction counter
    sr_hold: [f32; CHANNELS], // held sample for SR reduction

    /// Per-channel Smudge state.
    ///
    /// The band chain runs **one** `DistortionProcessor` for both channels —
    /// `engine.rs` calls `process_sample` for left and then right off the same
    /// instance. The memoryless shapers do not care. An overlap-add transform
    /// is different: a single STFT would receive `L₀, R₀, L₁, R₁, …` and
    /// analyse a 2048-point window of interleaved stereo, whose spectrum
    /// belongs to neither channel. Hence one processor per channel.
    smudge: [SmudgeProcessor; CHANNELS],
}

impl DistortionProcessor {
    pub fn new() -> Self {
        Self {
            mode: DistortionMode::SoftClip,
            drive: 25.0,
            asymmetry: 0.0,
            fold_threshold: 0.7,
            bit_depth: 16,
            sr_reduce: 1,
            tube_bias: 0.5,
            breakdown_depth: 1.0,
            sr_counter: [0; CHANNELS],
            sr_hold: [0.0; CHANNELS],
            smudge: [SmudgeProcessor::new(), SmudgeProcessor::new()],
        }
    }

    /// Group delay this stage imposes, in samples at the rate it is fed.
    ///
    /// Only Smudge has any: its overlap-add window is a flat 2048-sample
    /// delay. Derived from the configured mode rather than from the band's
    /// `distortionEnabled` flag, matching how `BandChain` treats the
    /// oversampler — a number the host can rely on across a performance toggle
    /// beats a number that is momentarily tighter.
    pub fn latency_samples(&self) -> f32 {
        if self.mode == DistortionMode::Smudge {
            return self.smudge[0].latency_samples() as f32;
        }
        0.0
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "distortionMode" => {
                let next = DistortionMode::from_index(value as u32);
                // Leaving Smudge strands up to a full window of analysed audio
                // in the overlap-add buffer, which would flush out the moment
                // the mode came back — over whatever the band is playing then.
                if next != self.mode && self.mode == DistortionMode::Smudge {
                    for channel in &mut self.smudge {
                        channel.reset();
                    }
                }
                self.mode = next;
            }
            "drive" => self.drive = value,
            "asymmetry" => self.asymmetry = value,
            "foldbackThreshold" => self.fold_threshold = value.max(0.01),
            "bitDepth" => self.bit_depth = (value as u32).clamp(1, 24),
            "sampleRateReduce" => self.sr_reduce = (value as u32).max(1),
            "tubeBias" => self.tube_bias = value,
            "breakdownDepth" => self.breakdown_depth = value,
            _ => {}
        }
    }

    /// Process a single sample through the selected distortion algorithm.
    ///
    /// `channel` selects the per-channel state Smudge and Bitcrush need; every
    /// other mode ignores it. Out-of-range indices clamp to the right channel
    /// rather than panicking on the audio thread.
    pub fn process_sample(&mut self, input: f32, channel: usize) -> f32 {
        let channel = channel.min(CHANNELS - 1);
        let drive_linear = 1.0 + self.drive * 0.2; // scale drive to useful range
        let driven = input * drive_linear;

        let shaped = match self.mode {
            DistortionMode::SoftClip => self.soft_clip(driven),
            DistortionMode::HardClip => self.hard_clip(driven),
            DistortionMode::Foldback => self.foldback(driven),
            DistortionMode::Wavefold => self.wavefold(driven),
            DistortionMode::Bitcrush => self.bitcrush(driven, channel),
            DistortionMode::Tube => self.tube(driven),
            DistortionMode::Smudge => {
                // "Blurs transients before distortion": the spectral blur is a
                // pre-stage, and the shaper it feeds is this mode's base soft
                // clip. Drive has already been applied, so the blur sees the
                // driven signal exactly as the other modes do.
                let blurred = self.smudge[channel].process_sample(driven);
                self.soft_clip(blurred)
            }
            DistortionMode::Breakdown | DistortionMode::Custom => {
                // Breakdown has no implementation to route to — see the module
                // header and `BreakdownProcessor`. Custom is the waveshaper's
                // mode, handled outside this type.
                self.soft_clip(driven)
            }
        };

        // Apply asymmetry: blend between symmetric and asymmetric
        if self.asymmetry.abs() > 0.001 {
            let asym = if shaped > 0.0 {
                shaped * (1.0 + self.asymmetry * 0.5)
            } else {
                shaped * (1.0 - self.asymmetry * 0.5)
            };
            return asym / drive_linear;
        }

        shaped / drive_linear
    }

    /// y = tanh(k * x)
    fn soft_clip(&self, x: f32) -> f32 {
        x.tanh()
    }

    /// Hard clip at ±1.
    fn hard_clip(&self, x: f32) -> f32 {
        x.clamp(-1.0, 1.0)
    }

    /// Foldback distortion — mirrors signal when exceeding threshold.
    fn foldback(&self, x: f32) -> f32 {
        let t = self.fold_threshold;
        if x.abs() <= t {
            x
        } else if x > t {
            2.0 * t - x
        } else {
            -2.0 * t - x
        }
    }

    /// Multi-stage wavefold.
    fn wavefold(&self, x: f32) -> f32 {
        // Sine-based wavefold for dense harmonics
        (x * std::f32::consts::PI).sin()
    }

    /// Bit depth and sample rate reduction, on `channel`'s own hold clock.
    fn bitcrush(&mut self, x: f32, channel: usize) -> f32 {
        // Sample rate reduction
        self.sr_counter[channel] += 1;
        if self.sr_counter[channel] >= self.sr_reduce {
            self.sr_counter[channel] = 0;
            self.sr_hold[channel] = x;
        }
        let held = self.sr_hold[channel];

        // Bit depth reduction
        let levels = 2.0_f32.powi(self.bit_depth as i32);
        (held * levels).round() / levels
    }

    /// Simple tube saturation with bias.
    fn tube(&self, x: f32) -> f32 {
        let biased = x + self.tube_bias * 0.1;
        let sat = if biased >= 0.0 {
            1.0 - (-biased).exp()
        } else {
            -(1.0 - biased.exp())
        };
        // Mix in even harmonics from bias
        sat * 0.9 + biased.tanh() * 0.1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const SAMPLE_RATE: f32 = 48_000.0;
    const BITCRUSH: f32 = 4.0;
    /// Odd on purpose. With one shared counter the two channels take turns
    /// owning the hold at any odd divider, so each is handed the other's
    /// sample; an even divider hides it by always landing on the same channel.
    const DIVIDER: u32 = 3;

    fn bitcrush_processor() -> DistortionProcessor {
        let mut distortion = DistortionProcessor::new();
        distortion.set_param("distortionMode", BITCRUSH);
        distortion.set_param("sampleRateReduce", DIVIDER as f32);
        distortion
    }

    /// Rate reduction runs on a per-channel clock: a silent channel stays
    /// silent no matter what the other one is doing.
    #[test]
    fn bitcrush_does_not_hand_one_channel_the_other_channels_held_sample() {
        let mut distortion = bitcrush_processor();

        let mut left_out = Vec::new();
        let mut right_out = Vec::new();
        for n in 0..512 {
            let left = (2.0 * PI * 440.0 * n as f32 / SAMPLE_RATE).sin() * 0.5;
            left_out.push(distortion.process_sample(left, 0));
            right_out.push(distortion.process_sample(0.0, 1));
        }

        let peak = |samples: &[f32]| samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        let right_peak = peak(&right_out);
        assert!(
            right_peak < 1e-6,
            "silent right channel came back peaking at {right_peak} — \
             it is being handed the left channel's held sample"
        );
        assert!(
            peak(&left_out) > 0.05,
            "left channel produced nothing, so the silence check proves nothing"
        );
    }

    /// And the hold really lasts `sampleRateReduce` of that channel's own
    /// samples, not of the interleaved stream.
    #[test]
    fn bitcrush_holds_each_channel_for_its_own_divider() {
        let mut distortion = bitcrush_processor();

        let mut left_out = Vec::new();
        for n in 0..512 {
            let left = (2.0 * PI * 440.0 * n as f32 / SAMPLE_RATE).sin() * 0.5;
            left_out.push(distortion.process_sample(left, 0));
            distortion.process_sample(0.0, 1);
        }

        // The counter reaches the divider on the third left sample, so holds
        // start at index 2 and each spans exactly `DIVIDER` samples.
        let step = DIVIDER as usize;
        for start in (2..left_out.len() - step).step_by(step) {
            for offset in 1..step {
                assert_eq!(
                    left_out[start],
                    left_out[start + offset],
                    "left hold starting at {start} broke at offset {offset}"
                );
            }
        }
    }
}
