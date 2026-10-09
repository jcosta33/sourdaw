//! Convolution body modeling for Bacteria.
//!
//! Direct-form (time-domain) convolution applying impulse responses of
//! physical objects (ceramic, wood, metal) to create resonant body character.
//! Includes a stereo separation control for widening mono IRs.
//!
//! Cost is O(N) multiply-accumulates per sample per channel, with N the IR
//! length — 23.2 ms of it for the built-in bodies, capped at 4096 samples for
//! any loaded one. There is no partitioning and no FFT here; a longer IR would
//! need one.

/// Duration of the built-in body IRs, in seconds.
///
/// 1024 samples at 44.1 kHz — the length these envelopes were shaped against,
/// kept as a duration so the shape survives a change of rate.
const BUILTIN_IR_SECONDS: f32 = 1024.0 / 44_100.0;

/// Direct-form convolution against a stereo IR pair.
pub struct ConvolutionProcessor {
    // IR storage
    ir_left: Vec<f32>,
    ir_right: Vec<f32>,
    ir_loaded: bool,

    input_buffer_l: Vec<f32>,
    input_buffer_r: Vec<f32>,
    write_pos: usize,
    ir_length: usize,

    /// Rate the built-in IRs are synthesized against, so their resonances land
    /// on the frequencies they are named for at whatever rate the context runs.
    sample_rate: f32,

    // Parameters
    mix: f32,
    separation: f32, // 0-1: mono→stereo widening
}

impl ConvolutionProcessor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            ir_left: Vec::new(),
            ir_right: Vec::new(),
            ir_loaded: false,
            input_buffer_l: Vec::new(),
            input_buffer_r: Vec::new(),
            write_pos: 0,
            ir_length: 0,
            sample_rate,
            mix: 0.3,
            separation: 0.5,
        }
    }

    /// Load an impulse response from one planar slice per channel.
    ///
    /// Planar rather than interleaved because every IR source this can be fed
    /// is already planar: the built-in bodies below synthesize one channel at a
    /// time, and a decoded audio file arrives from the engine as separate
    /// channel buffers. Pass the same slice twice for a mono IR — `separation`
    /// then widens it.
    ///
    /// The shorter of the two slices sets the length, so a mismatched pair
    /// truncates instead of reading past the end.
    pub fn load_ir(&mut self, ir_left: &[f32], ir_right: &[f32]) {
        // Cap IR length for real-time safety: this is a direct convolution, so
        // the per-sample cost is the length.
        let length = ir_left.len().min(ir_right.len()).min(4096);

        self.ir_length = length;
        self.ir_left = ir_left[..length].to_vec();
        self.ir_right = ir_right[..length].to_vec();

        self.input_buffer_l = vec![0.0; length];
        self.input_buffer_r = vec![0.0; length];
        self.write_pos = 0;
        self.ir_loaded = true;
    }

    /// Load a built-in body IR by type.
    pub fn load_builtin(&mut self, ir_type: &str) {
        // Generate synthetic IRs for different body types.
        //
        // Length comes from the rate, not from a sample count. Every envelope
        // below is written in seconds, so a fixed count would truncate the body
        // at a different point on its decay at every rate: 1024 samples is
        // 23.2 ms at 44.1 kHz but 10.7 ms at 96 kHz, where the wood envelope is
        // still at 0.65 rather than 0.40 — the body would keep its pitch and
        // change its length and effective Q with the session rate.
        let sample_rate = self.sample_rate;
        let length = ((sample_rate * BUILTIN_IR_SECONDS).round() as usize).clamp(1, 4096);
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

        // Unity energy here, at load, and not a precomputed per-body constant:
        // the energy grows with the sample count, so a constant would hold at
        // one session rate only, while this one pass over the response runs
        // beside the allocation that builds it and never in `process_stereo`.
        normalise_to_unit_energy(&mut ir);

        self.load_ir(&ir, &ir);
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

/// Scale `ir` so its squared samples sum to one: white noise then leaves the
/// convolution at the level it entered, and `convolutionMix` trades dry for
/// body at matched loudness. A pure gain, so the body's colour is unchanged.
fn normalise_to_unit_energy(ir: &mut [f32]) {
    let energy: f32 = ir.iter().map(|s| s * s).sum();
    if energy <= 0.0 {
        return;
    }
    let scale = energy.sqrt().recip();
    for s in ir.iter_mut() {
        *s *= scale;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fermenter::noise::{NoiseGen, NOISE_WHITE};

    /// Peak amplitude of `signal` at `freq`, sampled at `sample_rate`.
    fn amplitude_at(signal: &[f32], freq: f32, sample_rate: f32) -> f64 {
        let mut re = 0.0_f64;
        let mut im = 0.0_f64;
        for (n, &s) in signal.iter().enumerate() {
            let angle = 2.0 * std::f64::consts::PI * freq as f64 * n as f64 / sample_rate as f64;
            re += s as f64 * angle.cos();
            im += s as f64 * angle.sin();
        }
        (re * re + im * im).sqrt()
    }

    /// Strongest frequency in `signal` between `low` and `high`, to 1 Hz.
    fn dominant_frequency(signal: &[f32], sample_rate: f32, low: u32, high: u32) -> f32 {
        let mut best = low as f32;
        let mut best_magnitude = 0.0_f64;
        for hz in low..=high {
            let magnitude = amplitude_at(signal, hz as f32, sample_rate);
            if magnitude > best_magnitude {
                best_magnitude = magnitude;
                best = hz as f32;
            }
        }
        best
    }

    const BODY_TEST_RATE: f32 = 48_000.0;

    /// Every built-in body by the `convolutionIr` index that selects it.
    const BUILTIN_BODIES: [(f32, &str); 4] = [
        (0.0, "ceramic"),
        (1.0, "wood"),
        (2.0, "metal"),
        (3.0, "spring"),
    ];

    /// A built-in body loaded through `set_param`, as the engine loads one,
    /// fully wet.
    fn builtin_body(index: f32) -> ConvolutionProcessor {
        let mut body = ConvolutionProcessor::new(BODY_TEST_RATE);
        body.set_param("convolutionIr", index);
        body.set_param("convolutionMix", 1.0);
        body
    }

    /// Output energy over input energy, in dB, of four seconds of the crate's
    /// white noise fed identically to both channels, counted once the IR has
    /// filled. Identical channels carry no side signal, so `separation` cannot
    /// move the figure. The narrowest resonance (metal's, decaying at 15/s)
    /// needs the long average: four seconds measures every body within 0.4 dB
    /// of its unit-energy 0 dB.
    fn white_noise_gain_db(body: &mut ConvolutionProcessor) -> f64 {
        let mut noise = NoiseGen::new();
        noise.color = NOISE_WHITE;
        let settle = body.ir_length;
        let (mut input, mut output) = (0.0_f64, 0.0_f64);
        for n in 0..settle + 4 * BODY_TEST_RATE as usize {
            let x = noise.tick();
            let (left, _) = body.process_stereo(x, x);
            if n >= settle {
                input += f64::from(x).powi(2);
                output += f64::from(left).powi(2);
            }
        }
        10.0 * (output / input).log10()
    }

    /// `convolutionMix` is a dry/body crossfade, so the body has to arrive at
    /// the dry signal's loudness. Peak-normalised responses put every
    /// built-in body 20.2 to 23.4 dB above the dry on white noise at 48 kHz,
    /// so even the default 0.3 mix was mostly body.
    #[test]
    fn every_builtin_body_passes_broadband_noise_at_unity_gain() {
        for (index, name) in BUILTIN_BODIES {
            let mut body = builtin_body(index);
            let gain = white_noise_gain_db(&mut body);
            assert!(
                gain.abs() <= 1.0,
                "the {name} body changes white noise by {gain:.2} dB at mix 1; \
                 it must leave broadband material within 1 dB of its dry level"
            );
        }
    }

    /// Magnitude response at a handful of frequencies, in dB, of each body's
    /// pre-change peak-normalised impulse response scaled to unit energy — the
    /// colour each body had before its level changed. Spring is metal's
    /// response.
    const PRE_CHANGE_SHAPE_DB: [(&str, [(f32, f64); 6]); 4] = [
        (
            "ceramic",
            [
                (200.0, -8.942),
                (800.0, -7.653),
                (2_200.0, 25.729),
                (3_500.0, -30.822),
                (4_400.0, 17.114),
                (7_000.0, -21.505),
            ],
        ),
        (
            "wood",
            [
                (200.0, -4.319),
                (800.0, 26.411),
                (2_200.0, -12.197),
                (3_500.0, -22.448),
                (4_400.0, -26.232),
                (7_000.0, -36.863),
            ],
        ),
        (
            "metal",
            [
                (200.0, -10.775),
                (800.0, -7.153),
                (2_200.0, -17.263),
                (3_500.0, 26.197),
                (4_400.0, -23.243),
                (7_000.0, 17.342),
            ],
        ),
        (
            "spring",
            [
                (200.0, -10.775),
                (800.0, -7.153),
                (2_200.0, -17.263),
                (3_500.0, 26.197),
                (4_400.0, -23.243),
                (7_000.0, 17.342),
            ],
        ),
    ];

    /// Normalising a body changes its level and nothing else: each loaded
    /// response, read against its own energy, still matches the pre-change
    /// response read the same way, to 0.05 dB at every frequency.
    #[test]
    fn energy_normalising_a_body_keeps_its_spectral_shape() {
        for ((index, name), (expected_name, expected)) in
            BUILTIN_BODIES.into_iter().zip(PRE_CHANGE_SHAPE_DB)
        {
            assert_eq!(name, expected_name);
            let body = builtin_body(index);
            let energy: f64 = body.ir_left.iter().map(|s| f64::from(*s).powi(2)).sum();
            for (hz, expected_db) in expected {
                let level_db = 20.0
                    * (amplitude_at(&body.ir_left, hz, BODY_TEST_RATE) / energy.sqrt()).log10();
                assert!(
                    (level_db - expected_db).abs() < 0.05,
                    "the {name} body sits at {level_db:.3} dB at {hz} Hz against its energy; \
                     it sat at {expected_db} dB before its level changed"
                );
            }
        }
    }

    /// A "wood" body resonates at 800 Hz. It has to do that at whatever rate
    /// the audio context runs at — synthesizing the IR against a hardcoded
    /// 44.1 kHz puts the resonance at 800·fs/44100, which is 871 Hz at 48 kHz
    /// and 1600 Hz at 88.2 kHz: the body changes pitch with the session rate.
    #[test]
    fn a_builtin_body_resonates_at_the_same_hz_at_every_context_rate() {
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            let mut convolution = ConvolutionProcessor::new(sample_rate);
            convolution.load_builtin("wood");

            let peak = dominant_frequency(&convolution.ir_left, sample_rate, 400, 1_200);
            let error = (peak - 800.0).abs() / 800.0;
            assert!(
                error < 0.03,
                "wood body resonates at {peak} Hz when the context runs at \
                 {sample_rate} Hz; it is named for 800 Hz"
            );
        }
    }

    /// Frequency is only half of what a body is. Its envelope is written in
    /// seconds too, so the IR has to span the same milliseconds and reach the
    /// same point on its decay at every rate — a fixed 1024-sample length cuts
    /// the wood body at 0.40 of its peak at 44.1 kHz and 0.65 at 96 kHz, which
    /// is a different body.
    #[test]
    fn a_builtin_body_decays_over_the_same_milliseconds_at_every_context_rate() {
        let mut reference_tail = None;
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
            let mut convolution = ConvolutionProcessor::new(sample_rate);
            convolution.load_builtin("wood");
            let ir = &convolution.ir_left;

            let duration_ms = ir.len() as f32 / sample_rate * 1_000.0;
            assert!(
                (duration_ms - 23.22).abs() < 0.1,
                "the wood body lasts {duration_ms} ms at {sample_rate} Hz"
            );

            // Envelope at the truncation point, against the normalized peak.
            let window = ir.len() / 10;
            let peak = |slice: &[f32]| slice.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
            let tail = peak(&ir[ir.len() - window..]) / peak(&ir[..window]);
            match reference_tail {
                None => reference_tail = Some(tail),
                Some(expected) => assert!(
                    (tail - expected).abs() < 0.02,
                    "the wood body is at {tail} of its peak when it ends at \
                     {sample_rate} Hz, against {expected} at 44.1 kHz — the decay \
                     still tracks the session rate"
                ),
            }
        }
    }
}
