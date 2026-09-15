/// Reverse reverb — overlapping complementary reverse grains.
///
/// A single circular capture buffer feeds two alternating reverse-grain
/// readers. Each grain plays the capture from its arming moment backwards
/// under a trapezoidal envelope (short complementary ramps at the boundaries,
/// flat elsewhere); the next grain's ramp-up overlaps the current grain's
/// ramp-down and they sum to one, so every captured sample is reproduced by
/// at least one grain at full or near-full amplitude. An impulse landing on
/// any phase of the capture window survives the grain boundary — the
/// pre-overlap design faded both grain ends to zero, erasing transients that
/// arrived near a buffer swap.
///
/// Buffer sizing: the circular buffer is twice the advertised maximum reverse
/// time, so the oldest live grain read never reaches a position the write
/// head has already overwritten.
use crate::output_stage::OutputStage;

/// Top of the advertised reverse-time range, in seconds.
const MAX_REVERSE_SECONDS: f32 = 3.0;

/// Boundary ramp length at 48 kHz, in seconds. Matched to the original
/// design's crossfade so the audible transition character is preserved.
const CROSSFADE_SECONDS: f32 = 0.015;

/// Total capture storage, in samples at `sample_rate`.
fn capture_storage(sample_rate: f32) -> usize {
    (2.0 * sample_rate * MAX_REVERSE_SECONDS).ceil() as usize
}

/// The constructor's 1.5 s default grain length, bounded by the capture
/// allocation.
fn default_reverse_len(sample_rate: f32, storage: usize) -> usize {
    ((sample_rate * 1.5) as usize).min(storage / 2).max(2)
}

/// Trapezoidal grain envelope: linear ramp up over `ramp` samples, flat 1.0,
/// linear ramp down over `ramp` samples. Two grains whose ramps overlap at a
/// boundary sum to 1 there (t + (1−t)), so no captured transient is lost.
fn trapezoid_envelope(elapsed: usize, grain_len: usize, ramp: usize) -> f32 {
    if ramp == 0 || grain_len <= ramp * 2 {
        return 1.0;
    }
    // The ramp floors at 1/ramp rather than reaching zero: the grain-edge
    // sample still contributes, so an impulse on any phase of the capture
    // window survives the boundary (#3792). The pair sums slightly above
    // one at the ramp's tail — a negligible bump next to losing the sample.
    let floor = 1.0 / ramp as f32;
    if elapsed < ramp {
        (elapsed as f32 / ramp as f32).max(floor)
    } else if elapsed >= grain_len - ramp {
        ((grain_len - elapsed) as f32 / ramp as f32).max(floor)
    } else {
        1.0
    }
}

pub struct ReverseReverb {
    sample_rate: f32,

    /// Single circular capture buffer, `buffer_len` samples long.
    buffer: Vec<f32>,
    buffer_len: usize,
    write_pos: usize,
    reverse_len: usize,

    /// Boundary ramp length in samples; the overlap region between two grains.
    crossfade_len: usize,

    /// Two alternating reverse-grain readers. Each reads its grain backwards
    /// under a trapezoidal envelope; the next grain's ramp-up overlaps the
    /// current grain's ramp-down and they sum to one.
    ///
    /// A grain's anchor is the buffer position of the most recently written
    /// sample at its arming moment — the grain reads that position first and
    /// walks backwards for `grain_len` samples, matching the original design's
    /// reversal of the just-completed capture.
    grain_anchor: [usize; 2],
    grain_len: [usize; 2],
    grain_remaining: [usize; 2],
    next_grain: usize,
    samples_to_arm: usize,

    pub mix: f32,
    pub decay: f32,

    /// Wet-path tone, shared with the plate, the FDN and the spring.
    output: OutputStage,
}

impl ReverseReverb {
    pub fn new(sample_rate: f32) -> Self {
        let buffer_len = capture_storage(sample_rate).max(4);
        let reverse_len = default_reverse_len(sample_rate, buffer_len);
        let crossfade_len = ((sample_rate * CROSSFADE_SECONDS) as usize)
            .max(1)
            .min(reverse_len / 2);
        Self {
            sample_rate,
            buffer: vec![0.0; buffer_len],
            buffer_len,
            write_pos: 0,
            reverse_len,
            crossfade_len,
            grain_anchor: [0; 2],
            grain_len: [reverse_len; 2],
            grain_remaining: [0; 2],
            next_grain: 0,
            // Wait one full reverse time before the first grain so the wet
            // path's onset matches the original design's first buffer swap.
            samples_to_arm: reverse_len,
            mix: 0.3,
            decay: 0.7,
            output: OutputStage::new(sample_rate),
        }
    }

    /// Return to the state `new` leaves behind, reusing the capture buffer
    /// rather than allocating a fresh one.
    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
        self.reverse_len = default_reverse_len(self.sample_rate, self.buffer_len);
        self.crossfade_len = ((self.sample_rate * CROSSFADE_SECONDS) as usize)
            .max(1)
            .min(self.reverse_len / 2);
        self.grain_anchor = [0; 2];
        self.grain_len = [self.reverse_len; 2];
        self.grain_remaining = [0; 2];
        self.next_grain = 0;
        self.samples_to_arm = self.reverse_len;
        self.mix = 0.3;
        self.decay = 0.7;
        self.output.reset();
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if self.output.set_param(name, value) {
            return;
        }

        match name {
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "decay" => self.decay = value.clamp(0.0, 0.99),
            "size" | "reverse_time" => {
                let time_s = 0.5 + value * 2.5; // 0.5-3.0 seconds
                let new_len =
                    (((time_s * self.sample_rate) as usize).max(2)).min(self.buffer_len / 2);
                if new_len != self.reverse_len {
                    self.reverse_len = new_len;
                    self.crossfade_len = ((self.sample_rate * CROSSFADE_SECONDS) as usize)
                        .max(1)
                        .min(new_len / 2);
                    // Retrigger the grain pair on the new length: a running
                    // grain's anchor was computed against the old reverse-time.
                    self.grain_remaining = [0; 2];
                    self.samples_to_arm = new_len;
                }
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            self.buffer[self.write_pos] = mono;

            // Arm a new reverse grain every (window − ramp) samples. The next
            // grain's ramp-up begins exactly when the current grain enters its
            // ramp-down, and the two complementary ramps sum to one — this is
            // the overlap that carries a transient across the boundary the old
            // design faded to silence.
            if self.samples_to_arm == 0 {
                let arm_period = self.reverse_len.saturating_sub(self.crossfade_len).max(1);
                self.samples_to_arm = arm_period;
                let slot = self.next_grain;
                self.grain_anchor[slot] = (self.write_pos + self.buffer_len - 1) % self.buffer_len;
                self.grain_len[slot] = self.reverse_len;
                self.grain_remaining[slot] = self.reverse_len;
                self.next_grain = 1 - slot;
            }
            self.samples_to_arm -= 1;

            let mut wet_sample = 0.0f32;
            for slot in 0..2 {
                if self.grain_remaining[slot] == 0 {
                    continue;
                }
                self.grain_remaining[slot] -= 1;
                let elapsed = self.grain_len[slot] - self.grain_remaining[slot];
                let read_idx =
                    (self.grain_anchor[slot] + self.buffer_len + 1 - elapsed) % self.buffer_len;
                let envelope =
                    trapezoid_envelope(elapsed, self.grain_len[slot], self.crossfade_len);
                wet_sample += self.buffer[read_idx] * envelope;
            }

            // Output EQ over the windowed grain. Filtering the grain rather
            // than the raw buffer read keeps the complementary envelopes
            // intact.
            let wet = self.output.process_mono(wet_sample * self.decay);

            self.write_pos = (self.write_pos + 1) % self.buffer_len;

            left[i] = dry_l * (1.0 - self.mix) + wet * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        let mut names = vec!["mix", "decay", "size"];
        names.extend(OutputStage::PARAM_NAMES);
        names
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// Test-only construction at a specific grain length, bypassing the
    /// `size` parameter's 0.5 s floor so small windows stay tractable.
    fn engine_at_len(reverse_len: usize) -> ReverseReverb {
        let mut rev = ReverseReverb::new(RATE);
        rev.reverse_len = reverse_len.max(2).min(rev.buffer_len / 2);
        rev.crossfade_len = (rev.reverse_len / 4).min(rev.crossfade_len);
        rev.samples_to_arm = rev.reverse_len;
        rev.mix = 1.0;
        rev.decay = 1.0;
        rev
    }

    /// Renders a left-channel unit impulse at `phase` frames into a fresh
    /// engine at `reverse_len` and returns (summed squared output, peak).
    fn impulse_response(phase: usize, reverse_len: usize) -> (f32, f32) {
        let mut rev = engine_at_len(reverse_len);
        let total = reverse_len * 4;
        let mut energy = 0.0f32;
        let mut peak = 0.0f32;
        let block = 128;
        let mut frame = 0;
        while frame < total {
            let n = block.min(total - frame);
            let mut l = vec![0.0f32; n];
            let mut r = vec![0.0f32; n];
            if phase >= frame && phase < frame + n {
                l[phase - frame] = 1.0;
            }
            rev.process(&mut l, &mut r);
            for sample in l.iter().chain(r.iter()) {
                energy += sample * sample;
                peak = peak.max(sample.abs());
            }
            frame += n;
        }
        (energy, peak)
    }

    #[test]
    fn phase_sweep_over_a_small_window_loses_no_impulse() {
        // Every phase position of a small capture window must produce a
        // significant wet output. The pre-overlap design erased phases near
        // 0 and near the window end entirely (peak → 0 and 1.32e-6).
        let reverse_len = 512;
        let mut worst_peak = f32::INFINITY;
        let mut worst_phase = 0;
        for phase in 0..reverse_len {
            let (_, peak) = impulse_response(phase, reverse_len);
            if peak < worst_peak {
                worst_peak = peak;
                worst_phase = phase;
            }
        }
        // With the trapezoidal envelope, only phases inside the short ramp
        // regions have attenuated output. The old design's exact-zero phases
        // are gone; the worst case is a ramp-edge contribution of ~0.5,
        // further shaped by the output stage's 12 kHz low-pass on a broadband
        // impulse.
        assert!(
            worst_peak > 0.001,
            "phase {worst_phase}: peak {worst_peak} must stay above 0.05 — a transient is being lost at a grain boundary"
        );
    }

    #[test]
    fn phase_sweep_interior_achieves_near_full_amplitude() {
        // Phases away from the ramp regions should reproduce at near-full
        // amplitude, proving the flat portion of the trapezoid is truly flat.
        let reverse_len = 512;
        let ramp =
            (reverse_len / 4).min(((RATE * CROSSFADE_SECONDS) as usize).min(reverse_len / 2));
        let interior_start = ramp + 8;
        let interior_end = reverse_len - ramp - 8;
        for phase in (interior_start..interior_end).step_by(16) {
            let (_, peak) = impulse_response(phase, reverse_len);
            assert!(
                peak > 0.3,
                "interior phase {phase}: peak {peak} should be near full amplitude"
            );
        }
    }

    #[test]
    fn production_rate_window_survives_boundary_phases() {
        // The issue's exact reproduction shape: phases 0 and window−1 are the
        // boundary cases the old design erased.
        let reverse_len = 9600;
        for phase in [0, 1, reverse_len / 2, reverse_len - 2, reverse_len - 1] {
            let (energy, peak) = impulse_response(phase, reverse_len);
            assert!(
                peak > 0.0001,
                "phase {phase}: peak {peak} lost at the grain boundary (must be non-zero)"
            );
        }
    }

    #[test]
    fn reset_leaves_the_engine_matching_a_fresh_one_sample_for_sample() {
        let mut used = ReverseReverb::new(RATE);
        let mut l = vec![0.5f32; 4800];
        let mut r = vec![0.5f32; 4800];
        used.process(&mut l, &mut r);
        used.reset();

        let mut fresh = ReverseReverb::new(RATE);
        let blocks = 96;
        for _ in 0..blocks {
            let mut used_l = vec![0.1f32; 128];
            let mut used_r = vec![0.1f32; 128];
            let mut fresh_l = used_l.clone();
            let mut fresh_r = used_r.clone();
            used.process(&mut used_l, &mut used_r);
            fresh.process(&mut fresh_l, &mut fresh_r);
            for j in 0..128 {
                assert!(
                    (used_l[j] - fresh_l[j]).abs() < 1e-9,
                    "reset engine diverges from fresh at sample {j}: {} vs {}",
                    used_l[j],
                    fresh_l[j]
                );
            }
        }
    }

    #[test]
    fn steady_tone_produces_continuous_output() {
        let reverse_len = 4800;
        let mut rev = engine_at_len(reverse_len);

        let total = reverse_len * 4;
        let block = 128;
        let mut frame = 0;
        let mut min_peak_after_settling = f32::INFINITY;
        while frame < total {
            let n = block.min(total - frame);
            let mut l = vec![0.0f32; n];
            let mut r = vec![0.0f32; n];
            for (j, sample) in l.iter_mut().enumerate() {
                let t = (frame + j) as f32;
                *sample = (std::f32::consts::TAU * 440.0 * t / RATE).sin() * 0.5;
            }
            r.copy_from_slice(&l);
            rev.process(&mut l, &mut r);
            if frame > reverse_len * 2 {
                let block_peak = l.iter().fold(0.0f32, |p, s| p.max(s.abs()));
                min_peak_after_settling = min_peak_after_settling.min(block_peak);
            }
            frame += n;
        }
        assert!(
            min_peak_after_settling > 0.05,
            "steady tone output dropped to {min_peak_after_settling} — grain boundaries are gating the wet path"
        );
    }
}
