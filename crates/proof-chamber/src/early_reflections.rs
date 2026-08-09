//! Tapped delay line producing the early-reflection portion of a reverb.
//!
//! Shared by the FDN engines and the plate so that `early_late` means one
//! thing across the Dutch Oven rather than one thing per engine. It lived
//! inside `fdn.rs` while the FDN was its only caller; the plate's `set_param`
//! had no `early_late` arm at all, so the Early/Late knob — which the panel
//! drives and which reaches Rust intact — fell through the plate's `_ => {}`
//! and did nothing on the *default* algorithm.
//!
//! RT-safe once constructed: `process` and `update_room_size` index a
//! preallocated buffer and a fixed tap table, and neither allocates, locks nor
//! blocks. The allocation happens in `new`, alongside every other delay line
//! the engines build at construction time.

/// Number of simulated first reflections.
///
/// Derived from `TAP_TIMES_MS` rather than written down twice: the two must
/// agree, and a literal here would let them drift.
const TAP_COUNT: usize = TAP_TIMES_MS.len();

/// Arrival times of the modelled reflections, in milliseconds, before the
/// room-size scaling in `tap_delay`. Irregularly spaced so the pattern does
/// not ring at a single frequency.
const TAP_TIMES_MS: [f32; 12] = [
    1.0, 3.2, 5.1, 7.8, 11.3, 15.7, 20.4, 26.1, 33.0, 41.2, 52.8, 67.0,
];

/// Longest reflection the buffer can hold, in seconds.
const MAX_DELAY_SECONDS: f32 = 0.1;

/// Delay of tap `index` in samples for a given room size, clamped into the
/// buffer. Single source of the mapping so `new` and `update_room_size` cannot
/// disagree about where a tap sits — they did not, but only because the
/// expression was copied.
fn tap_delay(index: usize, sample_rate: f32, room_size: f32, buffer_len: usize) -> usize {
    // First reflection arrives 5–50 ms out depending on room size.
    let base_delay_ms = 5.0 + room_size * 45.0;
    let delay =
        ((TAP_TIMES_MS[index] * room_size + base_delay_ms * 0.1) / 1000.0 * sample_rate) as usize;
    delay.min(buffer_len.saturating_sub(1))
}

/// Gain of tap `index`: reflections thin out as `1/sqrt(t)`, with alternating
/// signs so the summed pattern decorrelates rather than combing.
fn tap_gain(index: usize) -> f32 {
    let magnitude = 0.7 / (1.0 + (index as f32) * 0.3).sqrt();
    if index % 2 == 0 {
        magnitude
    } else {
        -magnitude
    }
}

pub struct EarlyReflections {
    buffer: Vec<f32>,
    write_pos: usize,
    /// `(delay_samples, gain)` per reflection.
    taps: [(usize, f32); TAP_COUNT],
    len: usize,
}

impl EarlyReflections {
    pub fn new(sample_rate: f32, room_size: f32) -> Self {
        let len = ((sample_rate * MAX_DELAY_SECONDS) as usize).max(2);
        let mut taps = [(0usize, 0.0f32); TAP_COUNT];
        for (index, tap) in taps.iter_mut().enumerate() {
            *tap = (
                tap_delay(index, sample_rate, room_size, len),
                tap_gain(index),
            );
        }

        Self {
            buffer: vec![0.0; len],
            write_pos: 0,
            taps,
            len,
        }
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        self.buffer[self.write_pos] = input;
        self.write_pos = (self.write_pos + 1) % self.len;

        let mut sum = 0.0_f32;
        for &(delay, gain) in &self.taps {
            // Second copy of #1547's expression, fixed with the first. The
            // write above post-increments, so `write_pos - 1` holds the sample
            // that just arrived and a delay of `delay` counts back from there.
            // Counting from `write_pos` made every reflection arrive one sample
            // early: tap 0 requested 156 samples and delivered its first
            // non-zero at 155, which is where the plate's and the FDNs' shared
            // "+155 samples" onset figure came from.
            //
            // One sample, not the plate's half-second, because `tap_delay`
            // never returns 0 — `base_delay_ms * 0.1` puts the shortest
            // reflection 0.5 ms out at Size 0 — so this copy never met the
            // 0-aliases-to-`len` case that made the pre-delay render silence.
            // It is fixed anyway. Leaving one copy of the defective expression
            // in the crate that just fixed the other is an invitation to the
            // next caller to copy it, and #1570 is what that looks like when
            // the invitation is accepted.
            //
            // `.min(self.len - 1)` is new and load-bearing. Without it the
            // subtraction underflows for any `delay >= len`, and this line was
            // safe only because both writers of `taps` happen to route through
            // `tap_delay`, which clamps. The clamp belongs where the read is,
            // not in every producer of a tap position.
            let pos = (self.write_pos + self.len - 1 - delay.min(self.len - 1)) % self.len;
            sum += self.buffer[pos] * gain;
        }
        sum
    }

    pub fn update_room_size(&mut self, sample_rate: f32, room_size: f32) {
        let len = self.len;
        for (index, tap) in self.taps.iter_mut().enumerate() {
            tap.0 = tap_delay(index, sample_rate, room_size, len);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 1_000.0;

    /// Drive one tap and silence the rest, so `process` returns exactly what
    /// that tap read.
    fn single_tap(reflections: &mut EarlyReflections, delay: usize) {
        for tap in reflections.taps.iter_mut() {
            *tap = (0, 0.0);
        }
        reflections.taps[0] = (delay, 1.0);
    }

    /// Feed `1.0, 2.0, …` and return the last sample out, so a returned value
    /// names the write that produced it.
    fn ramp_through(reflections: &mut EarlyReflections, writes: usize) -> f32 {
        let mut out = 0.0;
        for step in 1..=writes {
            out = reflections.process(step as f32);
        }
        out
    }

    /// The tap positions mean sample delays, measured on the line rather than
    /// read off `tap_delay`.
    ///
    /// #1547's second copy lived here: the read counted back from `write_pos`
    /// after `process` had already advanced it, so every reflection arrived one
    /// sample early. A test that asserted `tap_delay` returned the right number
    /// would have been green throughout — the tap table was never wrong.
    #[test]
    fn a_tap_reads_the_sample_written_that_many_steps_ago() {
        let mut reflections = EarlyReflections::new(SR, 0.5);
        let len = reflections.len;

        for delay in [0_usize, 1, 7, 40] {
            let mut probe = EarlyReflections::new(SR, 0.5);
            single_tap(&mut probe, delay);
            let out = ramp_through(&mut probe, len);
            assert_eq!(
                out,
                (len - delay) as f32,
                "a tap at {delay} should read the sample written {delay} steps \
                 before the newest one. Reading one early is #1547's second \
                 copy: tap 0 asks for 156 samples and delivers at 155."
            );
        }

        // And the shared instance is untouched by the probes above, so the
        // constructor's own tap table is what the engine runs.
        assert_eq!(reflections.taps.len(), TAP_COUNT);
        assert!(reflections.process(1.0).is_finite());
    }

    /// The clamp in `process`, which is the only thing standing between a tap
    /// at or past the buffer length and a subtraction that underflows.
    ///
    /// This guard exists because the line was previously safe *by accident*:
    /// every writer of `taps` happens to route through `tap_delay`, which
    /// clamps, so nothing here would have noticed the clamp going missing. A
    /// future caller setting a tap directly — or a `tap_delay` that stops
    /// clamping — turns that into a panic on the audio thread.
    #[test]
    fn a_tap_past_the_end_of_the_line_saturates_instead_of_underflowing() {
        let mut probe = EarlyReflections::new(SR, 0.5);
        let len = probe.len;

        // Exactly at the length, one past it, and absurdly past it. Without
        // `delay.min(self.len - 1)` the first of these already computes
        // `write_pos + len - len`, and the other two underflow `usize`.
        for delay in [len, len + 1, len * 10] {
            let mut probe_at = EarlyReflections::new(SR, 0.5);
            single_tap(&mut probe_at, delay);
            let out = ramp_through(&mut probe_at, len);
            assert_eq!(
                out, 1.0,
                "a tap at {delay} on a {len}-sample line should saturate on the \
                 oldest sample the line holds — the first of {len} writes — \
                 rather than underflow or wrap round to a short delay"
            );
        }

        single_tap(&mut probe, len - 1);
        let oldest = ramp_through(&mut probe, len);
        assert_eq!(
            oldest, 1.0,
            "the largest in-range tap must already read the oldest sample, or \
             the saturation above is landing somewhere else"
        );
    }
}
