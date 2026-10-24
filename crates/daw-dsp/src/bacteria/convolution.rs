//! Convolution body modeling for Bacteria.
//!
//! Direct-form (time-domain) convolution applying impulse responses of
//! physical objects (ceramic, wood, metal, spring) to create resonant body
//! character. Includes a stereo separation control for widening the mono
//! responses.
//!
//! Cost is O(N) multiply-accumulates per sample per channel, with N the
//! response length — 23.2 ms of it through 192 kHz, capped at 4458 samples.
//! There is no partitioning or FFT; this bound does not prove a render deadline.

/// Duration of the built-in body IRs, in seconds.
///
/// 1024 samples at 44.1 kHz — the length these envelopes were shaped against,
/// kept as a duration so the shape survives a change of rate.
const BUILTIN_IR_SECONDS: f32 = 1024.0 / 44_100.0;

/// Rounded 1024/44100-second duration at 192 kHz. Keep the direct-form work
/// bounded while retaining the full built-in response at the highest session rate.
const MAX_IR_LENGTH: usize = 4_458;

/// Rate at which a built-in body IR carries unit energy. Its energy at any
/// other rate scales by this over the session rate, which keeps the body's
/// audible-band level the same at every rate.
const BODY_REFERENCE_RATE: f32 = 48_000.0;

/// The built-in bodies, in the order `convolutionIr` indexes them.
const BUILTIN_BODIES: [&str; 4] = ["ceramic", "wood", "metal", "spring"];

/// Direct-form convolution against one of the built-in body responses.
///
/// Every body is synthesized when the processor is built, and choosing one
/// afterwards only changes which prebuilt response the convolution reads.
/// `convolutionIr` arrives through `set_param`, and on the web that runs in the
/// worklet's message handler on the audio rendering thread, so the choice
/// must not allocate, free or synthesize; `tests/bacteria_body_switch_rt.rs`
/// pins that.
pub struct ConvolutionProcessor {
    /// Each built-in body's mono response, indexed as [`BUILTIN_BODIES`] is.
    /// Both channels convolve with the same response; `separation` widens it.
    bodies: [Vec<f32>; BUILTIN_BODIES.len()],
    /// The body the stage convolves with, or `None` to pass audio through.
    active_body: Option<usize>,

    input_buffer_l: Vec<f32>,
    input_buffer_r: Vec<f32>,
    write_pos: usize,
    /// Length of every body's response, and so of both input rings.
    ir_length: usize,

    // Parameters
    mix: f32,
    separation: f32, // 0-1: mono→stereo widening
}

impl ConvolutionProcessor {
    pub fn new(sample_rate: f32) -> Self {
        // Length comes from the rate, not from a sample count. Every envelope
        // in `synthesize_body` is written in seconds, so a fixed count would
        // truncate the body at a different point on its decay at every rate:
        // 1024 samples is 23.2 ms at 44.1 kHz but 10.7 ms at 96 kHz, where the
        // wood envelope is still at 0.65 rather than 0.40 — the body would keep
        // its pitch and change its length and effective Q with the session rate.
        let ir_length =
            ((sample_rate * BUILTIN_IR_SECONDS).round() as usize).clamp(1, MAX_IR_LENGTH);
        Self {
            bodies: BUILTIN_BODIES.map(|name| synthesize_body(name, sample_rate, ir_length)),
            active_body: None,
            input_buffer_l: vec![0.0; ir_length],
            input_buffer_r: vec![0.0; ir_length],
            write_pos: 0,
            ir_length,
            mix: 0.3,
            separation: 0.5,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "convolutionMix" => self.mix = value.clamp(0.0, 1.0),
            "convolutionSeparation" => self.separation = value.clamp(0.0, 1.0),
            "convolutionIr" => self.select_body(body_index(value)),
            _ => {}
        }
    }

    /// Convolve with `body` from the next sample on.
    ///
    /// Moving between two bodies keeps the input history, so the new response
    /// is heard over the signal already playing rather than after a gap.
    /// Leaving pass-through clears the history first: the rings stop being
    /// written while no body is chosen, so what they hold is however old the
    /// last chosen body left it. Re-choosing the body already chosen changes
    /// nothing, so a repeated write cannot restart the response.
    fn select_body(&mut self, body: Option<usize>) {
        if body == self.active_body {
            return;
        }
        if self.active_body.is_none() {
            self.reset();
        }
        self.active_body = body;
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        let Some(body) = self.active_body else {
            return (left, right);
        };

        // Write input
        self.input_buffer_l[self.write_pos] = left;
        self.input_buffer_r[self.write_pos] = right;

        // Direct convolution (for short IRs)
        let ir = &self.bodies[body];
        let mut conv_l = 0.0_f32;
        let mut conv_r = 0.0_f32;

        for (k, tap) in ir.iter().enumerate() {
            let read_pos = (self.write_pos + self.ir_length - k) % self.ir_length;
            conv_l += self.input_buffer_l[read_pos] * tap;
            conv_r += self.input_buffer_r[read_pos] * tap;
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

/// The body a `convolutionIr` value selects: its nearest whole number when that
/// indexes [`BUILTIN_BODIES`], otherwise none.
///
/// None is a value of its own rather than a fallback body. The project stores a
/// band with no body chosen as -1, and that band has always passed its audio
/// through, so -1 — like any other value that names no body — has to keep it
/// passing through rather than quietly switch a body on.
fn body_index(value: f32) -> Option<usize> {
    let rounded = value.round();
    if rounded >= 0.0 && rounded < BUILTIN_BODIES.len() as f32 {
        Some(rounded as usize)
    } else {
        None
    }
}

/// Synthesize one built-in body's response, `length` samples at `sample_rate`.
///
/// Allocates, which is why it only runs from [`ConvolutionProcessor::new`].
fn synthesize_body(name: &str, sample_rate: f32, length: usize) -> Vec<f32> {
    let mut ir = vec![0.0_f32; length];

    match name {
        "ceramic" => {
            // High-frequency resonance with quick decay
            for (i, sample) in ir.iter_mut().enumerate() {
                let t = i as f32 / sample_rate;
                *sample = (-t * 80.0).exp() * (2200.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.3
                    + (-t * 120.0).exp() * (4400.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.15;
            }
        }
        "wood" => {
            // Warm mid-range resonance
            for (i, sample) in ir.iter_mut().enumerate() {
                let t = i as f32 / sample_rate;
                *sample = (-t * 40.0).exp() * (800.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.4
                    + (-t * 60.0).exp() * (1600.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.2;
            }
        }
        _ => {
            // Metal and spring: bright metallic ring
            for (i, sample) in ir.iter_mut().enumerate() {
                let t = i as f32 / sample_rate;
                *sample = (-t * 15.0).exp()
                    * (3500.0 * 2.0 * std::f32::consts::PI * t).sin()
                    * 0.25
                    + (-t * 25.0).exp() * (7000.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.1
                    + (-t * 50.0).exp() * (1200.0 * 2.0 * std::f32::consts::PI * t).sin() * 0.15;
            }
        }
    }

    // The body is one analogue response sampled at the session rate, so
    // both its in-band gain and its energy grow with the rate: at a fixed
    // energy its audible-band level would climb 3 dB per doubling of the
    // rate. An energy of BODY_REFERENCE_RATE / rate holds the in-band
    // response where it sits at 48 kHz, where unit energy passes white
    // noise across the whole band at its dry level. The target follows the
    // rate, so it is applied here, in one pass beside the allocation that
    // builds the response, and never in `process_stereo`.
    normalise_to_energy(&mut ir, BODY_REFERENCE_RATE / sample_rate);
    ir
}

/// Scale `ir` so its squared samples sum to `target`. At a target of one,
/// white noise leaves the convolution at the level it entered, so
/// `convolutionMix` trades dry for body at matched loudness. A pure gain, so
/// the body's colour is unchanged.
fn normalise_to_energy(ir: &mut [f32], target: f32) {
    let energy: f32 = ir.iter().map(|s| s * s).sum();
    if energy <= 0.0 {
        return;
    }
    let scale = (target / energy).sqrt();
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

    /// A built-in body chosen through `set_param`, as the engine chooses one,
    /// fully wet.
    fn builtin_body(index: f32) -> ConvolutionProcessor {
        builtin_body_at(index, BODY_TEST_RATE)
    }

    fn builtin_body_at(index: f32, sample_rate: f32) -> ConvolutionProcessor {
        let mut body = ConvolutionProcessor::new(sample_rate);
        body.set_param("convolutionIr", index);
        body.set_param("convolutionMix", 1.0);
        body
    }

    /// The response the processor convolves both channels with.
    fn response(body: &ConvolutionProcessor) -> &[f32] {
        let index = body
            .active_body
            .expect("no body is chosen, so there is no response to read");
        &body.bodies[index]
    }

    /// Render the selected response through the fully wet stereo path.
    fn impulse_pcm(index: f32, sample_rate: f32, frames: usize) -> Vec<f32> {
        let mut body = builtin_body_at(index, sample_rate);
        (0..frames)
            .map(|n| {
                let impulse = if n == 0 { 1.0 } else { 0.0 };
                let (left, right) = body.process_stereo(impulse, impulse);
                assert_eq!(
                    left, right,
                    "identical inputs must not acquire a side signal"
                );
                left
            })
            .collect()
    }

    #[test]
    fn every_high_rate_body_spans_the_physical_duration() {
        let mut complete = true;
        for (index, name) in BUILTIN_BODIES {
            let body = builtin_body_at(index, 192_000.0);
            let length = response(&body).len();
            eprintln!("{name}: 192 kHz response length {length}, required 4458");
            complete &= length == 4_458;
            complete &= (length as f64 / 192_000.0 - 1024.0 / 44_100.0).abs() <= 1.0 / 192_000.0;
        }
        assert!(
            complete,
            "each 192 kHz body must span 1024/44100 seconds (4458 frames)"
        );
    }

    #[test]
    fn every_high_rate_body_renders_the_tail_past_frame_4095() {
        let mut complete = true;
        for (index, name) in BUILTIN_BODIES {
            let heard = impulse_pcm(index, 192_000.0, 4_459);
            let tail_energy: f64 = heard[4_096..4_458]
                .iter()
                .map(|s| f64::from(*s).powi(2))
                .sum();
            eprintln!("{name}: 192 kHz rendered energy after frame 4095 = {tail_energy}");
            complete &= tail_energy > 0.0;
            complete &= heard[4_394..4_458].iter().any(|sample| *sample != 0.0);
            assert_eq!(
                heard[4_458], 0.0,
                "{name} must finish after its physical duration"
            );
        }
        assert!(
            complete,
            "each body's fully wet impulse must retain its high-rate tail"
        );
    }

    /// Mean power gain of `ir`, in dB, over the audible band: its squared
    /// magnitude read every 10 Hz from 20 Hz to 20 kHz. Ten hertz resolves
    /// every body's resonance, which the 23.2 ms response widens to a main
    /// lobe of about 86 Hz.
    fn audible_band_level_db(ir: &[f32], sample_rate: f32) -> f64 {
        let bins: Vec<f32> = (2..=2_000).map(|step| step as f32 * 10.0).collect();
        let power: f64 = bins
            .iter()
            .map(|&hz| amplitude_at(ir, hz, sample_rate).powi(2))
            .sum();
        10.0 * (power / bins.len() as f64).log10()
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
                gain.abs() <= 0.5,
                "the {name} body changes white noise by {gain:.2} dB at mix 1 at \
                 48 kHz; it must leave broadband material within 0.5 dB of its dry level"
            );
        }
    }

    /// The body is one physical object whatever rate the session runs at, so
    /// its level on audible material has to be one level too. Unit energy at
    /// every rate put each body's audible band 3 dB higher per doubling of the
    /// rate: +0.79 dB at 48 kHz, +3.80 dB at 96 kHz and +6.81 dB at 192 kHz.
    #[test]
    fn a_builtin_body_keeps_its_audible_band_level_at_every_context_rate() {
        for (index, name) in BUILTIN_BODIES {
            let reference = audible_band_level_db(response(&builtin_body(index)), BODY_TEST_RATE);
            for sample_rate in [44_100.0_f32, 96_000.0, 176_400.0, 192_000.0] {
                let level = audible_band_level_db(
                    response(&builtin_body_at(index, sample_rate)),
                    sample_rate,
                );
                assert!(
                    (level - reference).abs() <= 0.5,
                    "the {name} body passes the audible band at {level:.2} dB when the \
                     context runs at {sample_rate} Hz, against {reference:.2} dB at 48 kHz"
                );
            }
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

    /// Normalising a body changes its level and nothing else: each chosen
    /// response, read against its own energy, still matches the pre-change
    /// response read the same way, to 0.05 dB at every frequency.
    #[test]
    fn energy_normalising_a_body_keeps_its_spectral_shape() {
        for ((index, name), (expected_name, expected)) in
            BUILTIN_BODIES.into_iter().zip(PRE_CHANGE_SHAPE_DB)
        {
            assert_eq!(name, expected_name);
            let body = builtin_body(index);
            let ir = response(&body);
            let energy: f64 = ir.iter().map(|s| f64::from(*s).powi(2)).sum();
            for (hz, expected_db) in expected {
                let level_db =
                    20.0 * (amplitude_at(ir, hz, BODY_TEST_RATE) / energy.sqrt()).log10();
                assert!(
                    (level_db - expected_db).abs() < 0.05,
                    "the {name} body sits at {level_db:.3} dB at {hz} Hz against its energy; \
                     it sat at {expected_db} dB before its level changed"
                );
            }
        }
    }

    /// The named resonances belong to the physical bodies, independent of rate.
    #[test]
    fn a_builtin_body_resonates_at_the_same_hz_at_every_context_rate() {
        for ((index, name), resonance) in BUILTIN_BODIES.into_iter().zip([2_200, 800, 3_500, 3_500])
        {
            for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0, 176_400.0, 192_000.0] {
                let convolution = builtin_body_at(index, sample_rate);
                let peak = dominant_frequency(
                    response(&convolution),
                    sample_rate,
                    resonance - 400,
                    resonance + 400,
                );
                let error = (peak - resonance as f32).abs() / resonance as f32;
                assert!(
                    error < 0.03,
                    "{name} resonates at {peak} Hz at {sample_rate} Hz, expected {resonance} Hz"
                );
            }
        }
    }

    /// The last tenth of the rendered response must reach the same point on
    /// each body's decay as at 48 kHz. Retain the existing 0.02 peak-ratio band.
    #[test]
    fn a_builtin_body_decays_over_the_same_milliseconds_at_every_context_rate() {
        let peak = |slice: &[f32]| slice.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        let tail_ratio = |ir: &[f32]| {
            let window = ir.len() / 10;
            peak(&ir[ir.len() - window..]) / peak(&ir[..window])
        };
        for (index, name) in BUILTIN_BODIES {
            let reference = impulse_pcm(index, BODY_TEST_RATE, 1_115);
            let reference_tail = tail_ratio(&reference);
            for (sample_rate, frames) in [
                (44_100.0_f32, 1_024),
                (48_000.0, 1_115),
                (96_000.0, 2_229),
                (176_400.0, 4_096),
                (192_000.0, 4_458),
            ] {
                let ir = impulse_pcm(index, sample_rate, frames);
                let duration = response(&builtin_body_at(index, sample_rate)).len() as f64
                    / f64::from(sample_rate);
                assert!(
                    (duration - 1024.0 / 44_100.0).abs() <= 1.0 / f64::from(sample_rate),
                    "the {name} body lasts {duration} seconds at {sample_rate} Hz"
                );
                let tail = tail_ratio(&ir);
                assert!(
                    (tail - reference_tail).abs() < 0.02,
                    "the {name} body ends at {tail} of its peak at {sample_rate} Hz, \
                     against {reference_tail} at 48 kHz"
                );
            }
        }
    }

    /// Rates unaffected by the cap change define the physical sampling
    /// envelope. Deep notches vary more than broadband gain as sample times
    /// move; retain the existing 0.05 dB shape precision around that envelope.
    fn assert_high_rate_shape(index: f32, name: &str, frequencies: &[f32]) {
        let reference = [
            (44_100.0_f32, 1_024),
            (48_000.0, 1_115),
            (96_000.0, 2_229),
            (176_400.0, 4_096),
        ]
        .map(|(rate, frames)| (rate, impulse_pcm(index, rate, frames)));
        let heard = impulse_pcm(index, 192_000.0, 4_458);
        for &hz in frequencies {
            let mut low = f64::INFINITY;
            let mut high = f64::NEG_INFINITY;
            for (rate, pcm) in &reference {
                let db = 20.0 * amplitude_at(pcm, hz, *rate).log10();
                low = low.min(db);
                high = high.max(db);
            }
            let db = 20.0 * amplitude_at(&heard, hz, 192_000.0).log10();
            assert!(
                db >= low - 0.05 && db <= high + 0.05,
                "{name} at {hz} Hz: {db:.6} dB at 192 kHz, outside the unchanged-rate \
                 sampling envelope [{low:.6}, {high:.6}] dB plus 0.05 dB shape precision"
            );
        }
    }

    #[test]
    fn a_builtin_body_keeps_its_rendered_spectral_shape_at_192_khz() {
        for ((index, name), (_, shape)) in BUILTIN_BODIES.into_iter().zip(PRE_CHANGE_SHAPE_DB) {
            assert_high_rate_shape(index, name, &shape.map(|(hz, _)| hz));
        }
    }

    /// The original high-rate truncation moved this bin by about 2.15 dB.
    /// Keep it separate so the spectral oracle runs even when length fails.
    #[test]
    fn the_192_khz_wood_body_keeps_its_one_khz_response() {
        assert_high_rate_shape(1.0, "wood", &[1_000.0]);
    }

    /// Unit energy belongs to 48 kHz, where the guidance levels are measured,
    /// and at any other rate the energy is 48 kHz over that rate. The noise
    /// check's 0.5 dB band admits a 44.1 kHz reference, which leaves the
    /// 48 kHz body 0.37 dB low, and the rate check compares rates with each
    /// other, so only the stored energy pins the reference rate. Both channels
    /// convolve with the one response read here.
    #[test]
    fn a_builtin_body_carries_unit_energy_at_48_khz_and_scales_it_with_the_rate() {
        for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0, 176_400.0, 192_000.0] {
            let expected = 48_000.0 / f64::from(sample_rate);
            for (index, name) in BUILTIN_BODIES {
                let body = builtin_body_at(index, sample_rate);
                let energy: f64 = response(&body).iter().map(|s| f64::from(*s).powi(2)).sum();
                assert!(
                    (energy - expected).abs() < 1e-3,
                    "the {name} body's response carries energy {energy:.6} at \
                     {sample_rate} Hz; it must carry {expected:.6}, 48 kHz over the rate"
                );
            }
        }
    }

    /// A band with no body chosen stores -1, and has always passed its audio
    /// through. The index used to be read as `value as u32`, which saturates
    /// -1 to 0 and switched ceramic on for every such band; -1, and any other
    /// value that names no body, has to leave the stage passing through.
    #[test]
    fn a_value_that_names_no_body_passes_audio_through() {
        for no_body in [-1.0_f32, 4.0, f32::NAN] {
            let mut body = builtin_body(no_body);
            for n in 0..256 {
                let x = ((n as f32) * 0.37).sin();
                assert_eq!(
                    body.process_stereo(x, -x),
                    (x, -x),
                    "convolutionIr {no_body} changed sample {n} at mix 1; it names no \
                     body, so the stage must pass audio through"
                );
            }
        }
    }

    /// Choosing no body after a body switches the body off again, which is
    /// what undoing a first body choice sends.
    #[test]
    fn choosing_no_body_after_a_body_passes_audio_through_again() {
        let mut body = builtin_body(1.0);
        for n in 0..64 {
            body.process_stereo(((n as f32) * 0.37).sin(), 0.0);
        }
        body.set_param("convolutionIr", -1.0);
        assert_eq!(body.process_stereo(0.25, 0.5), (0.25, 0.5));
    }

    /// Re-sending the body already chosen leaves the stage exactly where it
    /// was. A patch reload, an undo and a redo all re-send it, and a write that
    /// rebuilt the response would restart the body's ring under the signal
    /// already playing.
    #[test]
    fn re_choosing_the_chosen_body_does_not_restart_it() {
        let mut resent = builtin_body(2.0);
        let mut untouched = builtin_body(2.0);
        for n in 0..512 {
            let x = ((n as f32) * 0.11).sin();
            resent.process_stereo(x, x);
            untouched.process_stereo(x, x);
        }
        resent.set_param("convolutionIr", 2.0);
        for n in 512..1_024 {
            let x = ((n as f32) * 0.11).sin();
            assert_eq!(
                resent.process_stereo(x, x),
                untouched.process_stereo(x, x),
                "re-choosing the metal body moved sample {n}"
            );
        }
    }
}
