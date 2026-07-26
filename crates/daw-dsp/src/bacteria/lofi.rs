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
    fht_buffer: Vec<f32>,
    fht_write_pos: usize,
    fht_size: usize,
    output_buffer: Vec<f32>,
    /// Scratch frame the forward/inverse transform runs in. Preallocated
    /// because `process_codec` crosses a frame boundary every `fht_size`
    /// samples on the audio thread, and on wasm32 a fresh allocation there can
    /// call `memory.grow()`.
    codec_scratch: Vec<f32>,
    output_read_pos: usize,
    frame_counter: usize,

    // Overall amount
    amount: f32, // 0-100
}

impl LofiProcessor {
    pub fn new() -> Self {
        let fht_size = 256; // Small for low latency
        Self {
            bit_depth: 16,
            sr_divider: 1,
            sr_counter: 0,
            sr_hold_l: 0.0,
            sr_hold_r: 0.0,
            codec_amount: 0.0,
            fht_buffer: vec![0.0; fht_size],
            fht_write_pos: 0,
            fht_size,
            output_buffer: vec![0.0; fht_size],
            codec_scratch: vec![0.0; fht_size],
            output_read_pos: 0,
            frame_counter: 0,
            amount: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "lofiAmount" => self.amount = value.clamp(0.0, 100.0),
            "codecArtifact" => self.codec_amount = value.clamp(0.0, 1.0),
            "bitDepth" => self.bit_depth = (value as u32).clamp(1, 24),
            "sampleRateReduce" => self.sr_divider = (value as u32).max(1),
            _ => {}
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

        // Codec artifact processing (FHT-based)
        if self.codec_amount > 0.01 {
            l = self.process_codec(l);
            // Process right channel with slight offset for stereo interest
            r = self.process_codec(r * 0.999);
        }

        (l, r)
    }

    fn process_codec(&mut self, input: f32) -> f32 {
        self.fht_buffer[self.fht_write_pos] = input;
        let output = self.output_buffer[self.output_read_pos];

        self.fht_write_pos += 1;
        self.output_read_pos += 1;

        // Process a full frame
        if self.fht_write_pos >= self.fht_size {
            self.fht_write_pos = 0;
            self.output_read_pos = 0;

            // Forward FHT, run in the preallocated scratch frame. Cloning
            // `fht_buffer` here would allocate on the audio thread once per
            // frame boundary for as long as the codec stage is engaged.
            let work = &mut self.codec_scratch;
            work.copy_from_slice(&self.fht_buffer);
            fht(work);

            // Threshold coefficients — set small ones to zero (lossy compression)
            let threshold = self.codec_amount * 0.5;
            for coeff in work.iter_mut() {
                if coeff.abs() < threshold {
                    *coeff = 0.0;
                }
            }

            // Simulate packet loss: randomly zero some coefficients
            if self.codec_amount > 0.3 {
                let skip_rate = ((self.codec_amount - 0.3) * 0.3) as usize;
                self.frame_counter += 1;
                for i in 0..work.len() {
                    if (i + self.frame_counter) % (skip_rate.max(1) + 3) == 0 {
                        work[i] = 0.0;
                    }
                }
            }

            // Inverse FHT (FHT is its own inverse, scaled by 1/N)
            fht(work);
            let scale = 1.0 / self.fht_size as f32;
            for (i, val) in work.iter().enumerate() {
                self.output_buffer[i] = val * scale;
            }
        }

        output
    }

    pub fn reset(&mut self) {
        self.fht_buffer.fill(0.0);
        self.output_buffer.fill(0.0);
        self.fht_write_pos = 0;
        self.output_read_pos = 0;
        self.sr_counter = 0;
        self.sr_hold_l = 0.0;
        self.sr_hold_r = 0.0;
        self.frame_counter = 0;
    }
}
