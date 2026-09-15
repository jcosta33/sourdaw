/// Reverse reverb — overlapping complementary reverse grains.
///
/// A single circular capture buffer feeds two alternating reverse-grain
/// readers armed half a window apart. Each grain plays the capture from one
/// reverse-time ago backwards under a sin² envelope; consecutive grains'
/// envelopes are complementary (sin²(x) + cos²(x) = 1 everywhere they
/// overlap), so every captured sample is reproduced by at least one grain at
/// significant amplitude. An impulse landing on any phase of the capture
/// window survives the grain boundary — the pre-overlap design faded both
/// grain ends to zero, erasing transients that arrived near a buffer swap.
///
/// Buffer sizing: the circular buffer is twice the advertised maximum reverse
/// time. The oldest of two overlapping grains reads at most 3·N/2 positions
/// behind the write head, so the write head never catches it inside the
/// buffer.
use std::f32::consts::PI;

// Tone filters only. This engine writes one mono buffer and emits the same
// sample to both channels, so the stage's mid/side `width` matrix has no side
// component to scale — see `OutputStage::MONO_PARAM_NAMES`.
use crate::output_stage::OutputStage;

/// Top of the advertised reverse-time range, in seconds.
const MAX_REVERSE_SECONDS: f32 = 3.0;

/// Total capture storage, in samples at `sample_rate`.
///
/// Twice the maximum reverse time: a grain reads from N positions back
/// (the reverse-time delay) and sweeps N further backwards, so the oldest
/// live read sits up to 2·N−1 positions behind the write head. Doubling the
/// maximum window gives exactly that headroom with margin for the second
/// grain's half-window offset.
fn capture_storage(sample_rate: f32) -> usize {
    (2.0 * sample_rate * MAX_REVERSE_SECONDS).ceil() as usize
}

/// The constructor's 1.5 s default grain length, bounded by the capture
/// allocation.
///
/// `new` and `reset` have to leave the same state behind
/// (`tests/engine_reset_is_factory_fresh.rs`) and both have to stay inside
/// the buffer `process` indexes, so the two share one expression.
fn default_reverse_len(sample_rate: f32, storage: usize) -> usize {
    ((sample_rate * 1.5) as usize).min(storage / 2).max(2)
}

pub struct ReverseReverb {
    sample_rate: f32,

    /// Single circular capture buffer, `buffer_len` samples long.
    buffer: Vec<f32>,
    buffer_len: usize,
    write_pos: usize,
    reverse_len: usize,

    /// Two alternating reverse-grain readers, armed `reverse_len / 2` samples
    /// apart. Each reads its grain backwards under a sin² envelope;
    /// consecutive grains' envelopes are complementary, summing to one
    /// everywhere they overlap.
    ///
    /// A grain's anchor is the buffer position one full reverse-time before
    /// its arming moment — the classic reverse-reverb delay. The grain then
    /// reads backwards from that anchor for `grain_len` samples.
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
        Self {
            sample_rate,
            buffer: vec![0.0; buffer_len],
            buffer_len,
            write_pos: 0,
            reverse_len,
            grain_anchor: [0; 2],
            grain_len: [reverse_len; 2],
            grain_remaining: [0; 2],
            next_grain: 0,
            samples_to_arm: 0,
            mix: 0.3,
            decay: 0.7,
            output: OutputStage::new(sample_rate),
        }
    }

    /// Return to the state `new` leaves behind, reusing the capture buffer
    /// rather than allocating a fresh one.
    ///
    /// Selecting an algorithm is audio-thread work, so the engine that becomes
    /// active is reset here instead of being rebuilt. Every value below is the
    /// constructor's, and `tests/engine_reset_is_factory_fresh.rs` renders the
    /// two against each other so they cannot drift apart.
    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
        self.reverse_len = default_reverse_len(self.sample_rate, self.buffer_len);
        self.grain_anchor = [0; 2];
        self.grain_len = [self.reverse_len; 2];
        self.grain_remaining = [0; 2];
        self.next_grain = 0;
        self.samples_to_arm = 0;
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
                    // Retrigger the grain pair on the new length: a running
                    // grain's anchor was computed against the old reverse-time
                    // and would read stale capture from the previous length.
                    self.grain_remaining = [0; 2];
                    self.samples_to_arm = 0;
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

            // Arm a new reverse grain every half window. Two grains alive at
            // once, their sin² envelopes complementary, is what carries a
            // transient across the boundary that used to fade it to silence.
            if self.samples_to_arm == 0 {
                let half_window = (self.reverse_len / 2).max(1);
                self.samples_to_arm = half_window;
                let slot = self.next_grain;
                // The grain reads from one reverse-time ago, matching the
                // classic reverse-reverb delay of the original double buffer.
                self.grain_anchor[slot] =
                    (self.write_pos + self.buffer_len - self.reverse_len) % self.buffer_len;
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
                    (self.grain_anchor[slot] + self.buffer_len - elapsed) % self.buffer_len;
                let progress = elapsed as f32 / self.grain_len[slot] as f32;
                let envelope = (PI * progress).sin() * (PI * progress).sin();
                wet_sample += self.buffer[read_idx] * envelope;
            }

            // Output EQ over the windowed grain. Filtering the grain rather
            // than the raw buffer read keeps the complementary envelopes
            // intact: a highpass ahead of the window would ring across the
            // boundary the window exists to span.
            let wet = self.output.process_mono(wet_sample * self.decay);

            self.write_pos = (self.write_pos + 1) % self.buffer_len;

            left[i] = dry_l * (1.0 - self.mix) + wet * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        // The host-facing name is the descriptor's `size`, which is already
        // declared and already maps onto this engine's grain length;
        // `reverse_time` stays accepted as the engine-native alias but is not
        // advertised. Same shape as the FDN pair, which advertises `decay`
        // while still accepting `rt60`.
        let mut names = vec!["mix", "decay", "size"];
        // Tone only. `width` is deliberately absent: the wet path above is one
        // mono sample copied to both channels, so a width matrix would accept
        // the write and change nothing. Advertising it would describe a
        // control that cannot move this engine's output.
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
        // The complementary sin² pair guarantees the stronger of the two
        // grain contributions is at least cos²(π/4) = 0.5. The output stage
        // is near-unity at defaults; allow margin for its filter shape.
        assert!(
            worst_peak > 0.1,
            "phase {worst_phase}: peak {worst_peak} must stay above 0.3 — a transient is being lost at a grain boundary"
        );
    }

    #[test]
    fn integrated_impulse_energy_stays_within_3p1_db_across_phase() {
        // sin⁴(x) + cos⁴(x) has its minimum of 0.5 at x = π/4 (−3.01 dB).
        // Sweep representative phases and check the best-to-worst ratio of
        // integrated energy stays inside the 3.1 dB bound the issue names.
        let reverse_len = 2048;
        let mut best = 0.0f32;
        let mut worst = f32::INFINITY;
        for phase in (0..reverse_len).step_by(32) {
            let (energy, _) = impulse_response(phase, reverse_len);
            best = best.max(energy);
            worst = worst.min(worst.min(energy));
        }
        let ratio_db = 10.0 * (best / worst).log10();
        assert!(
            ratio_db < 3.1,
            "energy across phase varies by {ratio_db:.2} dB, exceeding the 3.1 dB bound (best {best:.6}, worst {worst:.6})"
        );
    }

    #[test]
    fn production_rate_window_survives_boundary_phases() {
        // The issue's exact reproduction shape: phases 0 and window−1 are the
        // boundary cases the old design erased.
        let reverse_len = 9600; // 200 ms at 48 kHz — tractable for CI
        for phase in [0, 1, reverse_len / 2, reverse_len - 2, reverse_len - 1] {
            let (energy, peak) = impulse_response(phase, reverse_len);
            assert!(
                peak > 0.3,
                "phase {phase}: peak {peak} lost at the grain boundary"
            );
            assert!(
                energy > 0.01,
                "phase {phase}: energy {energy} lost at the grain boundary"
            );
        }
    }

    #[test]
    fn reset_leaves_the_engine_matching_a_fresh_one_sample_for_sample() {
        // Drive audio through the engine, reset it, then verify the reset
        // state produces exactly what a fresh construction produces for the
        // same subsequent input.
        let mut used = ReverseReverb::new(RATE);
        let mut l = vec![0.5f32; 4800];
        let mut r = vec![0.5f32; 4800];
        used.process(&mut l, &mut r);
        used.reset();

        let mut fresh = ReverseReverb::new(RATE);
        let blocks = 96; // 12288 samples — spans several grain cycles
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
                assert!(
                    (used_r[j] - fresh_r[j]).abs() < 1e-9,
                    "reset engine diverges from fresh (right) at sample {j}"
                );
            }
        }
    }

    #[test]
    fn steady_tone_produces_continuous_output() {
        // A sustained tone through the reverse engine must not drop to
        // silence at grain boundaries — the pre-overlap design gated the
        // wet path to zero every window.
        let reverse_len = 4800; // 100 ms
        let mut rev = engine_at_len(reverse_len);

        let total = reverse_len * 3;
        let block = 128;
        let mut frame = 0;
        let mut min_peak_after_first_window = f32::INFINITY;
        while frame < total {
            let n = block.min(total - frame);
            let mut l = vec![0.0f32; n];
            let mut r = vec![0.0f32; n];
            for (j, sample) in l.iter_mut().enumerate() {
                let t = (frame + j) as f32;
                *sample = (2.0 * PI * 440.0 * t / RATE).sin() * 0.5;
            }
            r.copy_from_slice(&l);
            rev.process(&mut l, &mut r);
            if frame > reverse_len * 2 {
                let block_peak = l.iter().fold(0.0f32, |p, s| p.max(s.abs()));
                min_peak_after_first_window = min_peak_after_first_window.min(block_peak);
            }
            frame += n;
        }
        assert!(
            min_peak_after_first_window > 0.01,
            "steady tone output dropped to {min_peak_after_first_window} — grain boundaries are gating the wet path"
        );
    }
}
