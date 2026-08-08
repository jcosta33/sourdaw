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
            let pos = (self.write_pos + self.len - delay) % self.len;
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
