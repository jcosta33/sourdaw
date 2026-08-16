//! Lo-Fi and Codec Artifact processor for Bacteria.
//!
//! Bit-depth reduction, sample-rate reduction, aliasing,
//! and FHT-based codec artifact simulation (Goodhertz Lossy-style).

use std::f32::consts::PI;

/// Fast Hartley Transform (real-to-real, in-place).
/// H_k = Re{DFT_k} - Im{DFT_k} for real input.
fn fht(data: &mut [f32]) {
    let n = data.len();
    if !n.is_power_of_two() || n < 2 {
        return;
    }

    // Bit-reversal
    let mut j = 0;
    for i in 0..n {
        if i < j {
            data.swap(i, j);
        }
        let mut m = n >> 1;
        while m >= 1 && j >= m {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Butterfly stages using cas(x) = cos(x) + sin(x)
    let mut stage = 2;
    while stage <= n {
        let half = stage / 2;
        let angle_step = 2.0 * PI / stage as f32;

        for k in (0..n).step_by(stage) {
            for j in 0..half {
                let angle = angle_step * j as f32;
                let cs = angle.cos();
                let sn = angle.sin();

                let idx1 = k + j;
                let idx2 = k + j + half;

                let a = data[idx1];
                let b = data[idx2];

                data[idx1] = a + cs * b + sn * b;
                data[idx2] = a - cs * b - sn * b;
            }
        }
        stage <<= 1;
    }
}

/// Channels one `LofiProcessor` serves.
const CHANNELS: usize = 2;

/// Ceiling on `sampleRateReduce`, matching the range the panel declares.
///
/// Unbounded, the divider is also the length of the sample-and-hold window that
/// survives a bypass, and an automation spike could park a channel on one held
/// sample for an arbitrary stretch.
const MAX_SR_DIVIDER: u32 = 64;

/// One channel's codec-artifact state.
///
/// Per channel and not shared, because the transform is a framed one. A single
/// frame buffer fed `L₀, R₀, L₁, R₁, …` holds an interleaved stereo sequence
/// whose Hartley spectrum belongs to neither channel: thresholding and packet
/// loss then smear each channel's coefficients across the other, so a silent
/// right channel comes back carrying the left one. Every buffer here is sized
/// once in `new` and only ever written in place — `process_codec` crosses a
/// frame boundary every `fht_size` samples on the audio thread, and on wasm32 a
/// fresh allocation there can call `memory.grow()`.
struct CodecChannel {
    input_frame: Vec<f32>,
    write_pos: usize,
    output_frame: Vec<f32>,
    read_pos: usize,
    /// Scratch frame the forward/inverse transform runs in.
    scratch: Vec<f32>,
    frame_counter: usize,
}

impl CodecChannel {
    fn new(fht_size: usize) -> Self {
        Self {
            input_frame: vec![0.0; fht_size],
            write_pos: 0,
            output_frame: vec![0.0; fht_size],
            read_pos: 0,
            scratch: vec![0.0; fht_size],
            frame_counter: 0,
        }
    }

    fn reset(&mut self) {
        self.input_frame.fill(0.0);
        self.output_frame.fill(0.0);
        self.write_pos = 0;
        self.read_pos = 0;
        self.frame_counter = 0;
    }
}

/// Lo-Fi processor with bit reduction, sample rate reduction, and codec artifacts.
pub struct LofiProcessor {
    // Bit/SR reduction
    bit_depth: u32,
    sr_divider: u32,
    sr_counter: u32,
    sr_hold_l: f32,
    sr_hold_r: f32,

    // Codec artifact via FHT
    codec_amount: f32, // 0-1
    fht_size: usize,
    codec: [CodecChannel; CHANNELS],

    // Overall amount
    amount: f32, // 0-100
}

impl LofiProcessor {
    pub fn new() -> Self {
        // Each channel owns a frame, so this is also the codec's group delay in
        // samples: a sample written at position p of frame k leaves at position
        // p of frame k+1. 5.33 ms at 48 kHz, reported to the host through
        // `BandChain::latency_samples`.
        let fht_size = 256;
        Self {
            bit_depth: 16,
            sr_divider: 1,
            sr_counter: 0,
            sr_hold_l: 0.0,
            sr_hold_r: 0.0,
            codec_amount: 0.0,
            fht_size,
            codec: [CodecChannel::new(fht_size), CodecChannel::new(fht_size)],
            amount: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "lofiAmount" => self.amount = value.clamp(0.0, 100.0),
            "codecArtifact" => self.codec_amount = value.clamp(0.0, 1.0),
            "bitDepth" => self.bit_depth = (value as u32).clamp(1, 24),
            "sampleRateReduce" => self.sr_divider = (value as u32).clamp(1, MAX_SR_DIVIDER),
            _ => {}
        }
    }

    /// Whether the codec stage is in the signal path, and therefore whether it
    /// is delaying anything.
    ///
    /// The same threshold `process_stereo` gates the stage on, so the reported
    /// delay and the delivered one cannot disagree.
    pub fn codec_engaged(&self) -> bool {
        self.codec_amount > 0.01
    }

    /// Group delay the codec stage imposes, in samples at the rate it is fed.
    ///
    /// Zero unless the stage is engaged: unlike the distortion modes this is a
    /// continuous parameter, so there is no configured-but-idle state to report
    /// a stable worst case for.
    pub fn latency_samples(&self) -> f32 {
        if self.codec_engaged() {
            self.fht_size as f32
        } else {
            0.0
        }
    }

    pub fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        if self.amount < 0.01 && self.codec_amount < 0.01 {
            return (left, right);
        }

        let mut l = left;
        let mut r = right;

        // Sample rate reduction
        self.sr_counter += 1;
        if self.sr_counter >= self.sr_divider {
            self.sr_counter = 0;
            self.sr_hold_l = l;
            self.sr_hold_r = r;
        }
        l = self.sr_hold_l;
        r = self.sr_hold_r;

        // Bit depth reduction
        let effective_bits = 24.0 - (self.amount / 100.0) * (24.0 - self.bit_depth as f32);
        let levels = 2.0_f32.powf(effective_bits);
        l = (l * levels).round() / levels;
        r = (r * levels).round() / levels;

        // Codec artifact processing (FHT-based), one framed transform per
        // channel. The right channel used to be trimmed 0.1% to decorrelate it
        // from the left; with its own frames it is already independent, and a
        // silent input has to stay silent.
        if self.codec_amount > 0.01 {
            l = self.process_codec(0, l);
            r = self.process_codec(1, r);
        }

        (l, r)
    }

    fn process_codec(&mut self, channel: usize, input: f32) -> f32 {
        let fht_size = self.fht_size;
        let codec_amount = self.codec_amount;
        let state = &mut self.codec[channel.min(CHANNELS - 1)];

        state.input_frame[state.write_pos] = input;
        let output = state.output_frame[state.read_pos];

        state.write_pos += 1;
        state.read_pos += 1;

        // Process a full frame
        if state.write_pos >= fht_size {
            state.write_pos = 0;
            state.read_pos = 0;

            // Forward FHT, run in the preallocated scratch frame. Cloning
            // `input_frame` here would allocate on the audio thread once per
            // frame boundary for as long as the codec stage is engaged.
            let work = &mut state.scratch;
            work.copy_from_slice(&state.input_frame);
            fht(work);

            // Threshold coefficients — set small ones to zero (lossy compression)
            let threshold = codec_amount * 0.5;
            for coeff in work.iter_mut() {
                if coeff.abs() < threshold {
                    *coeff = 0.0;
                }
            }

            // Simulate packet loss: randomly zero some coefficients
            if codec_amount > 0.3 {
                let skip_rate = ((codec_amount - 0.3) * 0.3) as usize;
                state.frame_counter += 1;
                for i in 0..work.len() {
                    if (i + state.frame_counter) % (skip_rate.max(1) + 3) == 0 {
                        work[i] = 0.0;
                    }
                }
            }

            // Inverse FHT (FHT is its own inverse, scaled by 1/N)
            fht(work);
            let scale = 1.0 / fht_size as f32;
            for (i, val) in work.iter().enumerate() {
                state.output_frame[i] = val * scale;
            }
        }

        output
    }

    pub fn reset(&mut self) {
        for state in &mut self.codec {
            state.reset();
        }
        self.sr_counter = 0;
        self.sr_hold_l = 0.0;
        self.sr_hold_r = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: f32 = 48_000.0;

    /// Eight full 256-sample frames.
    const FRAMES: usize = 8 * 256;

    fn tone(n: usize, hz: f32, amplitude: f32) -> f32 {
        (2.0 * PI * hz * n as f32 / SAMPLE_RATE).sin() * amplitude
    }

    /// Run the codec stage over a stereo pair and return both output channels.
    fn render(left: impl Fn(usize) -> f32, right: impl Fn(usize) -> f32) -> (Vec<f32>, Vec<f32>) {
        let mut lofi = LofiProcessor::new();
        lofi.set_param("codecArtifact", 0.5);
        let mut left_out = Vec::with_capacity(FRAMES);
        let mut right_out = Vec::with_capacity(FRAMES);
        for n in 0..FRAMES {
            let (l, r) = lofi.process_stereo(left(n), right(n));
            left_out.push(l);
            right_out.push(r);
        }
        (left_out, right_out)
    }

    fn max_divergence(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b)
            .map(|(x, y)| (x - y).abs())
            .fold(0.0_f32, f32::max)
    }

    /// What one channel is fed must not change what the other one produces.
    ///
    /// A single framed transform fed `L₀, R₀, L₁, R₁, …` breaks that: the
    /// coefficients it thresholds and drops are those of the *interleaved*
    /// sequence, so each decision is taken on a mix of both channels and each
    /// channel's artifacts follow the other's content.
    ///
    /// Note what this does *not* catch, so nobody replaces it with the easier
    /// check: a silent channel stays silent even when the frames are shared.
    /// Zero-stuffed input makes the Hartley spectrum periodic over N/2, and
    /// every modification here — thresholding and the every-fourth-coefficient
    /// drop — preserves that periodicity, so the zeros survive the round trip.
    /// Silence is the one case the shared frame gets right.
    #[test]
    fn one_channels_content_does_not_change_the_others_codec_output() {
        let (left_together, right_together) =
            render(|n| tone(n, 440.0, 0.5), |n| tone(n, 1_000.0, 0.4));
        let (_, right_alone) = render(|_| 0.0, |n| tone(n, 1_000.0, 0.4));
        let (left_alone, _) = render(|n| tone(n, 440.0, 0.5), |_| 0.0);

        let right_shift = max_divergence(&right_together, &right_alone);
        assert!(
            right_shift == 0.0,
            "the right channel moved by {right_shift} when the left channel \
             changed — the two share a codec frame"
        );
        let left_shift = max_divergence(&left_together, &left_alone);
        assert!(
            left_shift == 0.0,
            "the left channel moved by {left_shift} when the right channel \
             changed — the two share a codec frame"
        );

        let peak = |samples: &[f32]| samples.iter().fold(0.0_f32, |m, s| m.max(s.abs()));
        assert!(
            peak(&right_together) > 0.05 && peak(&left_together) > 0.05,
            "neither channel produced audio, so the comparison proves nothing"
        );
    }

    /// The delay the codec reports is the delay it delivers.
    ///
    /// Giving each channel its own frame doubled the per-channel delay from 128
    /// interleaved positions to a full 256-sample frame, and a band that delays
    /// without saying so arrives late against its siblings and the dry tap.
    /// Measured with the threshold low enough to pass an impulse intact, so the
    /// arrival sample is unambiguous.
    #[test]
    fn the_codec_delivers_the_delay_it_reports() {
        let mut lofi = LofiProcessor::new();
        assert_eq!(
            lofi.latency_samples(),
            0.0,
            "an unengaged codec must report no delay"
        );

        lofi.set_param("codecArtifact", 0.02);
        let reported = lofi.latency_samples();
        assert_eq!(reported, 256.0);

        let mut arrival = None;
        for n in 0..4 * 256 {
            let input = if n == 0 { 1.0 } else { 0.0 };
            let (l, _) = lofi.process_stereo(input, 0.0);
            if l.abs() > 0.5 && arrival.is_none() {
                arrival = Some(n);
            }
        }
        assert_eq!(
            arrival,
            Some(reported as usize),
            "the impulse did not arrive at the reported delay"
        );
    }

    /// An unbounded divider is an unbounded sample-and-hold window.
    #[test]
    fn the_sample_rate_divider_is_clamped_to_the_declared_range() {
        let mut lofi = LofiProcessor::new();
        lofi.set_param("sampleRateReduce", 4_000.0);
        assert_eq!(lofi.sr_divider, MAX_SR_DIVIDER);
        lofi.set_param("sampleRateReduce", -3.0);
        assert_eq!(lofi.sr_divider, 1);
    }
}
