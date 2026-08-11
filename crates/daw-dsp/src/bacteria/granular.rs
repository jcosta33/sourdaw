//! Real-time granular processor for Bacteria.
//!
//! Operates on live incoming audio using a circular buffer.
//! Supports grain size, density, position offset, pitch shift,
//! grain windowing (Hann/Gaussian), and freeze mode.

use std::f32::consts::PI;

/// Grain window shape.
#[derive(Clone, Copy)]
pub enum GrainWindow {
    Hann,
    Gaussian,
}

/// Single grain state.
struct Grain {
    active: bool,
    read_pos: f32,
    samples_behind_write_head: f32,
    frontier_fade_remaining: usize,
    frontier_fade_total: usize,
    size_samples: usize,
    progress: usize,
    pitch_ratio: f32,
    window: GrainWindow,
}

impl Grain {
    fn new() -> Self {
        Self {
            active: false,
            read_pos: 0.0,
            samples_behind_write_head: 0.0,
            frontier_fade_remaining: 0,
            frontier_fade_total: 0,
            size_samples: 0,
            progress: 0,
            pitch_ratio: 1.0,
            window: GrainWindow::Hann,
        }
    }

    fn window_value(&self) -> f32 {
        if self.size_samples == 0 {
            return 0.0;
        }
        let phase = self.progress as f32 / self.size_samples as f32;
        match self.window {
            GrainWindow::Hann => 0.5 * (1.0 - (2.0 * PI * phase).cos()),
            GrainWindow::Gaussian => {
                let x = (phase - 0.5) * 4.0; // ±2 sigma
                (-0.5 * x * x).exp()
            }
        }
    }
}

/// Real-time granular engine.
#[allow(dead_code)]
pub struct GranularProcessor {
    buffer: Vec<f32>,
    write_pos: usize,
    buffer_size: usize,

    grains: Vec<Grain>,
    max_grains: usize,

    // Parameters
    grain_size_ms: f32,
    density: f32, // grains per second
    pos_offset_ms: f32,
    pitch_semitones: f32,
    window: GrainWindow,
    freeze: bool,
    mix: f32,

    sample_rate: f32,
    spawn_counter: f32,
}

impl GranularProcessor {
    pub fn new(sample_rate: f32) -> Self {
        let buffer_size = (sample_rate * 2.0) as usize; // 2 seconds circular buffer
        Self {
            buffer: vec![0.0; buffer_size],
            write_pos: 0,
            buffer_size,
            grains: (0..64).map(|_| Grain::new()).collect(),
            max_grains: 64,
            grain_size_ms: 80.0,
            density: 15.0,
            pos_offset_ms: 100.0,
            pitch_semitones: 0.0,
            window: GrainWindow::Hann,
            freeze: false,
            mix: 0.5,
            sample_rate,
            spawn_counter: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "grainSize" => self.grain_size_ms = value.clamp(1.0, 500.0),
            "grainDensity" => self.density = value.clamp(0.1, 100.0),
            "grainPosOffset" => self.pos_offset_ms = value.clamp(0.0, 2000.0),
            "grainPitch" => self.pitch_semitones = value,
            "grainWindow" => {
                self.window = if value < 0.5 {
                    GrainWindow::Hann
                } else {
                    GrainWindow::Gaussian
                };
            }
            "grainFreeze" => {
                let freeze = value > 0.5;
                if freeze && !self.freeze {
                    for grain in &mut self.grains {
                        if !grain.active || grain.frontier_fade_total != 0 {
                            continue;
                        }
                        let causal_remaining = ((grain.samples_behind_write_head.max(0.0)
                            / grain.pitch_ratio)
                            .floor() as usize)
                            .saturating_add(1);
                        let envelope_remaining = grain.size_samples.saturating_sub(grain.progress);
                        if causal_remaining < envelope_remaining {
                            grain.frontier_fade_remaining = causal_remaining;
                            grain.frontier_fade_total = causal_remaining;
                        }
                    }
                }
                self.freeze = freeze;
            }
            "grainMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        // Write to circular buffer (unless frozen)
        if !self.freeze {
            self.buffer[self.write_pos] = input;
            self.write_pos = (self.write_pos + 1) % self.buffer_size;
            for grain in &mut self.grains {
                if grain.active {
                    grain.samples_behind_write_head += 1.0;
                }
            }
        }

        // Spawn new grains based on density
        self.spawn_counter += self.density / self.sample_rate;
        while self.spawn_counter >= 1.0 {
            self.spawn_counter -= 1.0;
            self.spawn_grain();
        }

        // Sum active grains
        let mut grain_sum = 0.0;
        for grain in &mut self.grains {
            if !grain.active {
                continue;
            }
            if grain.samples_behind_write_head < 0.0 {
                grain.active = false;
                continue;
            }

            let frontier_gain = match grain.frontier_fade_total {
                0 => 1.0,
                1 => 0.0,
                total => (grain.frontier_fade_remaining - 1) as f32 / (total - 1) as f32,
            };
            let win = grain.window_value() * frontier_gain;
            let read_idx = grain.read_pos.floor() as usize % self.buffer_size;
            let next_idx = (read_idx + 1) % self.buffer_size;
            let fraction = grain.read_pos.fract();
            let sample =
                self.buffer[read_idx] + (self.buffer[next_idx] - self.buffer[read_idx]) * fraction;
            grain_sum += sample * win;

            grain.read_pos = (grain.read_pos + grain.pitch_ratio) % self.buffer_size as f32;
            grain.samples_behind_write_head -= grain.pitch_ratio;
            grain.progress += 1;
            if grain.frontier_fade_total != 0 {
                grain.frontier_fade_remaining = grain.frontier_fade_remaining.saturating_sub(1);
            }
            if grain.progress >= grain.size_samples {
                grain.active = false;
            }
            if grain.frontier_fade_total != 0 && grain.frontier_fade_remaining == 0 {
                grain.active = false;
            }
        }

        // Mix dry and granular
        input * (1.0 - self.mix) + grain_sum * self.mix
    }

    fn spawn_grain(&mut self) {
        let grain_size = (self.grain_size_ms * 0.001 * self.sample_rate) as usize;
        let offset = (self.pos_offset_ms * 0.001 * self.sample_rate) as usize;
        let offset = offset.min(self.buffer_size - 1);
        let pitch_ratio = 2.0_f32.powf(self.pitch_semitones / 12.0);

        // Find inactive grain slot
        for grain in &mut self.grains {
            if !grain.active {
                grain.active = true;
                // Preserve Position as the exact start point. When the play
                // head would catch the causal recording frontier, shorten the
                // grain so its window still closes instead of reading old ring
                // history or ending abruptly.
                let max_causal_size = if self.freeze {
                    ((offset as f32 / pitch_ratio).floor() as usize).saturating_add(1)
                } else if pitch_ratio > 1.0 {
                    ((offset as f32 / (pitch_ratio - 1.0)).floor() as usize).saturating_add(1)
                } else {
                    grain_size
                };
                grain.size_samples = grain_size.max(1).min(max_causal_size.max(1));
                grain.progress = 0;
                grain.pitch_ratio = pitch_ratio;
                grain.window = self.window;
                grain.samples_behind_write_head = offset as f32;
                grain.frontier_fade_remaining = 0;
                grain.frontier_fade_total = 0;

                // Read position: `offset` samples back from the most recently
                // written sample.
                //
                // `process_sample` writes and *then* advances `write_pos`, so
                // by the time this runs `write_pos` addresses the slot the
                // next sample will occupy and `write_pos - 1` holds the newest
                // one. Counting back from `write_pos` itself — which this did
                // until #1570 — makes `offset == 0` select the slot about to
                // be overwritten: the *oldest* sample the buffer holds, a full
                // `buffer_size - 1` behind. Position's declared minimum is
                // 0 ms, so asking for live audio reproduced the input 95 999
                // samples (2.000 s) later at 48 kHz, and every non-zero
                // setting was one sample short. Same defect and same shape as
                // #1569 on the Dutch Oven's `DelayLine::read`.
                //
                // The `.min` guards exactly one value, and it is worth being
                // precise about which. `offset` is
                // `(pos_offset_ms * 0.001 * sample_rate) as usize` with
                // `pos_offset_ms` clamped to 2000.0, and `buffer_size` is
                // `(sample_rate * 2.0) as usize` — the same product — so the
                // largest offset the control can produce equals `buffer_size`
                // exactly and can never exceed it. That one value is one past
                // the newest sample's own slot, so without the clamp the
                // subtraction goes a sample too far: it underflows outright
                // when `write_pos == 0` and silently reads one further back
                // otherwise. With the clamp it delivers `buffer_size - 1`, the
                // oldest sample the ring can still name.
                //
                // It is therefore an underflow guard, not a behaviour change:
                // at `offset == buffer_size` the old branch reduced to
                // `write_pos` for every `write_pos`, and so does this
                // expression. Position 2000 ms renders what it always did.
                let start = (self.write_pos + self.buffer_size - 1 - offset) % self.buffer_size;
                grain.read_pos = start as f32;
                break;
            }
        }
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
        for grain in &mut self.grains {
            grain.active = false;
        }
        self.spawn_counter = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    /// A processor whose density is low enough that nothing spawns by itself
    /// over the ramps below, so the only grain in play is the one the test
    /// spawns and `grains[0]` is always it.
    fn quiet_spawner() -> GranularProcessor {
        let mut processor = GranularProcessor::new(SR);
        processor.set_param("grainDensity", 0.1);
        processor
    }

    /// Write `1.0, 2.0, … count` and hand back the last value written.
    ///
    /// A counting ramp is the only stimulus that can tell "the grain starts
    /// `n` samples back" from "the grain starts `n + 1` samples back" — every
    /// slot holds a different number, so the value that comes back names the
    /// slot. Pinning `write_pos` or the index arithmetic instead would have
    /// been green throughout #1570: the pointer was always correct and the
    /// count back from it was not.
    fn drive_ramp(processor: &mut GranularProcessor, count: usize) -> f32 {
        for i in 1..=count {
            processor.process_sample(i as f32);
        }
        count as f32
    }

    /// The buffer value the next grain to be spawned would start on.
    fn spawned_grain_start_value(processor: &mut GranularProcessor) -> f32 {
        processor.spawn_grain();
        let grain = processor
            .grains
            .iter()
            .find(|grain| grain.active)
            .expect("spawn_grain must activate a grain");
        processor.buffer[grain.read_pos as usize % processor.buffer_size]
    }

    #[test]
    fn a_grain_starts_the_requested_number_of_samples_back_from_the_newest_one() {
        let newest = 300.0_f32;

        for (offset_ms, expected) in [
            // Position 0 ms is *live audio* — the sample written by the call
            // the grain was spawned from, not the one about to be overwritten.
            (0.0_f32, newest),
            (1.0, newest - 48.0),
            (5.0, newest - 240.0),
        ] {
            let mut processor = quiet_spawner();
            processor.set_param("grainPosOffset", offset_ms);
            drive_ramp(&mut processor, newest as usize);

            let started_on = spawned_grain_start_value(&mut processor);
            assert_eq!(
                started_on, expected,
                "Position {offset_ms} ms must start the grain on the sample written \
                 {} samples before the newest one. It started on {started_on}, which is \
                 {} samples back — #1570.",
                (offset_ms * 0.001 * SR) as usize,
                newest - started_on
            );
        }
    }

    #[test]
    fn a_grain_never_starts_past_the_oldest_sample_the_buffer_still_holds() {
        // `grainPosOffset` clamps to 2000 ms, which is exactly the buffer
        // length at every rate the product runs at, so the largest reachable
        // request names a slot the ring cannot address. It has to saturate on
        // the oldest sample rather than wrap forward onto a recent one.
        //
        // What this row is an instrument for, stated because it is narrower
        // than the name suggests: it fails when the clamp is removed, and it
        // is *blind to the pointer order this file exists for*. At
        // `offset == buffer_size` both the pre-#1570 branch and the current
        // expression reduce to `write_pos` for every `write_pos` — not by
        // coincidence and not because of what a particular slot happened to
        // hold, but algebraically, so no choice of ramp or starting position
        // can make this row separate them. The three rows around it are the
        // ones that do.
        let mut processor = quiet_spawner();
        let buffer_size = processor.buffer_size;
        processor.set_param("grainPosOffset", 2000.0);
        drive_ramp(&mut processor, buffer_size);

        let started_on = spawned_grain_start_value(&mut processor);
        assert_eq!(
            started_on, 1.0,
            "Position 2000 ms must saturate on the oldest sample the buffer holds \
             (1.0 of a {buffer_size}-sample ramp). It started on {started_on}."
        );
    }

    #[test]
    fn a_grain_still_finds_the_newest_sample_after_the_ring_has_wrapped() {
        // The defect's signature is that Position 0 lands on `buffer[write_pos]`
        // — indistinguishable from the newest sample while the ring is still
        // being filled for the first time, because that slot is zero either
        // way. Wrapping it first is what makes the two answers different
        // numbers, and 137 is an arbitrary offset past the wrap so `write_pos`
        // is nowhere near 0.
        let mut processor = quiet_spawner();
        let count = processor.buffer_size + 137;
        processor.set_param("grainPosOffset", 0.0);
        let newest = drive_ramp(&mut processor, count);

        let started_on = spawned_grain_start_value(&mut processor);
        assert_eq!(
            started_on, newest,
            "after {count} writes into a {}-sample ring, Position 0 ms must still start \
             on the newest sample ({newest}). It started on {started_on}, which is the \
             sample from {} writes ago.",
            processor.buffer_size,
            newest - started_on
        );
    }

    /// Grain length used by the frozen render below, in milliseconds and in
    /// samples at [`SR`]. Small enough that the whole grain fits inside a ramp
    /// a test can drive, large enough that the Hann window has real shape
    /// across it.
    const FROZEN_GRAIN_MS: f32 = 20.0;
    const FROZEN_GRAIN_SAMPLES: usize = 960;

    #[test]
    fn a_frozen_buffer_replays_the_samples_it_captured_across_the_whole_grain() {
        // Freeze stops the writes, so `write_pos` stands still and the newest
        // sample stays newest. A count back from the wrong end of a frozen
        // buffer is the same defect with no moving pointer to hide behind.
        //
        // This asserts the **rendered** grain over its full length rather than
        // the one slot it starts on. An earlier revision read the start slot
        // only, which named a single sample of a grain that is 960 long and
        // said nothing about the 959 after it — a read head that started right
        // and then drifted would have passed.
        //
        // Position is set to one whole grain length deliberately. Under freeze
        // the write head does not move while the read head still advances, so
        // a grain started fewer than `grain_size` samples back runs off the end
        // of the captured audio partway through — which is a real defect, filed
        // separately, and not the one this row is measuring. At Position ==
        // grain length the grain replays exactly the last `grain_size` samples
        // captured, ending on the newest one.
        //
        // The shipped `bac-frozen-texture` preset sits on this path, at
        // Position 100 ms with 120 ms grains, and it is the only shipped patch
        // that does.
        let mut processor = quiet_spawner();
        processor.set_param("grainMix", 1.0);
        processor.set_param("grainSize", FROZEN_GRAIN_MS);
        processor.set_param("grainPosOffset", FROZEN_GRAIN_MS);
        let newest = drive_ramp(&mut processor, 4_000);
        processor.set_param("grainFreeze", 1.0);

        processor.spawn_grain();
        let rendered: Vec<f32> = (0..FROZEN_GRAIN_SAMPLES)
            .map(|_| processor.process_sample(0.0))
            .collect();

        // The grain must replay ramp values `newest - 960 … newest - 1`, each
        // scaled by the Hann window at its own progress. The window is written
        // out here as its definition rather than borrowed from the code under
        // test, so a change to the shape has to be argued for in both places.
        let expected: Vec<f32> = (0..FROZEN_GRAIN_SAMPLES)
            .map(|progress| {
                let captured = newest - FROZEN_GRAIN_SAMPLES as f32 + progress as f32;
                let phase = progress as f32 / FROZEN_GRAIN_SAMPLES as f32;
                captured * 0.5 * (1.0 - (2.0 * PI * phase).cos())
            })
            .collect();

        // A one-slot error moves each sample by up to a whole ramp step (1.0),
        // so this tolerance separates "replayed the wrong samples" from float
        // noise on values that reach 4000 without being fitted to either.
        let tolerance = 1e-3_f32;
        let worst = rendered
            .iter()
            .zip(&expected)
            .enumerate()
            .map(|(progress, (got, want))| (progress, (got - want).abs(), *got, *want))
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .expect("the grain rendered no samples at all");
        assert!(
            worst.1 <= tolerance,
            "under freeze the grain must replay the last {FROZEN_GRAIN_SAMPLES} samples \
             captured. At progress {} it rendered {} where the frozen ramp says {} \
             (off by {}).",
            worst.0,
            worst.2,
            worst.3,
            worst.1
        );

        // Anti-vacuity: a grain that rendered silence would satisfy nothing
        // above if `expected` were also silent, and would satisfy the tolerance
        // only by accident if it were not. Say so directly.
        let energy: f32 = rendered.iter().map(|s| s.abs()).sum();
        assert!(
            energy > 1e5,
            "the frozen grain rendered {energy} total magnitude across \
             {FROZEN_GRAIN_SAMPLES} samples of a ramp that reaches {newest}; it is not \
             replaying anything."
        );
    }

    fn processor_with_poisoned_history(
        recent_silence_samples: usize,
        grain_size_ms: f32,
        position_ms: f32,
        pitch_semitones: f32,
        freeze: bool,
    ) -> GranularProcessor {
        let mut processor = quiet_spawner();
        processor.buffer.fill(1.0);
        processor.set_param("grainMix", 1.0);
        processor.set_param("grainSize", grain_size_ms);
        processor.set_param("grainPosOffset", position_ms);
        processor.set_param("grainPitch", pitch_semitones);
        for _ in 0..recent_silence_samples {
            processor.process_sample(0.0);
        }
        processor.set_param("grainFreeze", if freeze { 1.0 } else { 0.0 });
        processor.spawn_grain();
        processor
    }

    #[test]
    fn a_pitched_live_grain_never_reads_ahead_into_old_ring_history() {
        let mut processor = processor_with_poisoned_history(128, 200.0, 0.0, 0.1, false);
        assert_eq!(processor.grains[0].size_samples, 1);
        let peak = (0..9_600)
            .map(|_| processor.process_sample(0.0).abs())
            .fold(0.0_f32, f32::max);

        assert!(
            peak <= f32::EPSILON,
            "a +0.1 semitone grain at Position 0 read poisoned ring history at peak {peak}"
        );
    }

    #[test]
    fn causal_room_preserves_the_requested_grain_size() {
        let processor = processor_with_poisoned_history(4_801, 80.0, 100.0, 12.0, false);

        assert_eq!(processor.grains[0].size_samples, 3_840);
    }

    #[test]
    fn a_frozen_grain_never_reads_past_the_newest_captured_sample() {
        let offset_samples = 960;
        let mut processor =
            processor_with_poisoned_history(offset_samples + 1, 40.0, 20.0, 0.0, true);
        assert_eq!(processor.grains[0].size_samples, offset_samples + 1);
        let peak = (0..1_920)
            .map(|_| processor.process_sample(0.0).abs())
            .fold(0.0_f32, f32::max);

        assert!(
            peak <= f32::EPSILON,
            "a frozen grain read past its {offset_samples}-sample capture window at peak {peak}"
        );
    }

    #[test]
    fn freezing_an_active_grain_still_enforces_the_capture_frontier() {
        let mut processor = processor_with_poisoned_history(961, 40.0, 20.0, 0.0, false);
        assert_eq!(processor.grains[0].size_samples, 1_920);
        processor.set_param("grainFreeze", 1.0);

        let peak = (0..1_920)
            .map(|_| processor.process_sample(0.0).abs())
            .fold(0.0_f32, f32::max);

        assert!(
            peak <= f32::EPSILON,
            "freezing an active grain let it read poisoned history at peak {peak}"
        );
    }

    #[test]
    fn freezing_an_active_grain_fades_before_the_capture_frontier() {
        let mut processor = quiet_spawner();
        processor.buffer.fill(1.0);
        processor.write_pos = 2_000;
        processor.set_param("grainMix", 1.0);
        processor.set_param("grainSize", 40.0);
        processor.set_param("grainPosOffset", 20.0);
        processor.spawn_grain();
        processor.set_param("grainFreeze", 1.0);

        let rendered: Vec<f32> = (0..962).map(|_| processor.process_sample(0.0)).collect();
        let peak = rendered.iter().copied().fold(0.0_f32, f32::max);
        let worst_step = rendered
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).abs())
            .fold(0.0_f32, f32::max);

        assert!(peak > 0.2, "the active grain was inaudible at peak {peak}");
        assert!(
            worst_step < 0.01,
            "Freeze cut a sounding grain by {worst_step} instead of fading it"
        );
    }

    #[test]
    fn a_fractional_pitched_grain_interpolates_between_ring_samples() {
        let mut processor = quiet_spawner();
        for (index, sample) in processor.buffer.iter_mut().enumerate() {
            *sample = index as f32;
        }
        processor.write_pos = 4_000;
        processor.set_param("grainMix", 1.0);
        processor.set_param("grainSize", 20.0);
        processor.set_param("grainPosOffset", 20.0);
        processor.set_param("grainPitch", -12.0);
        processor.set_param("grainFreeze", 1.0);
        processor.spawn_grain();

        let progress = 479;
        let rendered = (0..=progress)
            .map(|_| processor.process_sample(0.0))
            .last()
            .expect("the grain rendered no samples");
        let phase = progress as f32 / FROZEN_GRAIN_SAMPLES as f32;
        let window = 0.5 * (1.0 - (2.0 * PI * phase).cos());
        let start = 4_000.0 - 1.0 - 960.0;
        let expected = (start + progress as f32 * 0.5) * window;

        assert!(
            (rendered - expected).abs() <= 1e-3,
            "fractional read rendered {rendered}; linear interpolation requires {expected}"
        );
    }
}
