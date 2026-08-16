//! Mechanical noise generator for the Grand Boule piano (§5.1).
//!
//! Models the small mechanical sounds a real grand makes around each note:
//! key-down thud, hammer let-off click, damper lift, and the pedal thump.
//!
//! Each event is a short burst of bandpass-filtered white noise with an
//! exponential-decay envelope. The generator holds a fixed pool of
//! single-shot voices (no dynamic allocation) and round-robins through
//! them; when the pool is full, the oldest voice is overwritten.

/// Maximum number of concurrent noise bursts.
pub const MAX_BURSTS: usize = 32;

/// Event type, controls the envelope & spectral shape of the burst.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoiseEvent {
    /// Finger hitting the key — broadband low thud, 5–15 ms.
    KeyDown,
    /// Hammer escapement click — bright, 2–5 ms.
    HammerLetoff,
    /// Damper returning to the string — muted, 5–10 ms.
    DamperLift,
    /// Sustain pedal engaging — low thud, 15–30 ms.
    PedalDown,
    /// Longitudinal "string precursor" — the bite that arrives at the
    /// bridge before the transverse wave because the longitudinal wave
    /// travels at `c_L ≫ c_T` (§A6 of the realism appendix). Bright,
    /// very short (~3 ms), ~25 dB above the structure-borne thump.
    StringPrecursor,
}

#[derive(Clone, Copy, Debug)]
struct Burst {
    /// Current amplitude, decays exponentially each sample.
    amplitude: f32,
    /// Per-sample multiplier.
    decay: f32,
    /// Bandpass coefficients. Centre frequency and bandwidth are fixed at
    /// `trigger` time, so the coefficients derived from them are too.
    c0: f32,
    c1: f32,
    c2: f32,
    /// Biquad state.
    b1_x1: f32,
    b1_x2: f32,
    b1_y1: f32,
    b1_y2: f32,
    /// Output gain.
    gain: f32,
    /// True once the envelope has decayed below the noise floor.
    finished: bool,
}

impl Burst {
    fn idle() -> Self {
        Self {
            amplitude: 0.0,
            decay: 0.0,
            c0: 0.0,
            c1: 0.0,
            c2: 0.0,
            b1_x1: 0.0,
            b1_x2: 0.0,
            b1_y1: 0.0,
            b1_y2: 0.0,
            gain: 0.0,
            finished: true,
        }
    }
}

#[derive(Clone, Debug)]
pub struct MechanicalNoise {
    sample_rate: f32,
    bursts: [Burst; MAX_BURSTS],
    next_slot: usize,
    /// LCG state for deterministic white noise.
    rng_state: u32,
}

impl MechanicalNoise {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            bursts: [Burst::idle(); MAX_BURSTS],
            next_slot: 0,
            rng_state: 0x9E37_79B9,
        }
    }

    pub fn reset(&mut self) {
        for burst in self.bursts.iter_mut() {
            *burst = Burst::idle();
        }
        self.next_slot = 0;
    }

    /// Number of bursts still sounding. Lets callers assert that an event
    /// fired without reaching into the pool.
    pub fn active_burst_count(&self) -> usize {
        self.bursts.iter().filter(|burst| !burst.finished).count()
    }

    /// Trigger a noise event at the given velocity (0..1).
    pub fn trigger(&mut self, event: NoiseEvent, velocity: f32) {
        use core::f32::consts::{PI, TAU};
        let v = velocity.clamp(0.0, 1.0);
        let (duration_s, centre, bandwidth, level_db) = match event {
            NoiseEvent::KeyDown => (0.010, 180.0, 400.0, -35.0),
            NoiseEvent::HammerLetoff => (0.003, 4_000.0, 3_000.0, -48.0),
            NoiseEvent::DamperLift => (0.007, 600.0, 800.0, -52.0),
            NoiseEvent::PedalDown => (0.020, 120.0, 300.0, -38.0),
            // §A6 string precursor: broadband, peaks above 3 kHz, decays
            // in <5 ms. Russell & Rossing place its peak ~25 dB above the
            // structure-borne thump — at our reference, that's about
            // -23 dBFS, but we attenuate further so it never dominates.
            NoiseEvent::StringPrecursor => (0.004, 3_500.0, 4_500.0, -32.0),
        };
        let gain = db_to_gain(level_db) * (0.3 + 0.7 * v);
        let slot = self.next_slot;
        self.next_slot = (self.next_slot + 1) % MAX_BURSTS;

        let decay = (-1.0 / (duration_s * self.sample_rate)).exp();
        // Resonator coefficients depend only on the centre frequency and
        // bandwidth chosen above, both fixed for the life of the burst. They
        // are computed here, once, instead of per sample.
        let theta = TAU * centre / self.sample_rate;
        let r = (-PI * bandwidth / self.sample_rate).exp();
        let c0 = (1.0 - r * r) * theta.sin() * 0.5;
        let c1 = 2.0 * r * theta.cos();
        let c2 = -(r * r);
        self.bursts[slot] = Burst {
            amplitude: 1.0,
            decay,
            c0,
            c1,
            c2,
            b1_x1: 0.0,
            b1_x2: 0.0,
            b1_y1: 0.0,
            b1_y2: 0.0,
            gain,
            finished: false,
        };
    }

    /// Process one sample and return the summed mono noise burst output.
    #[inline]
    pub fn tick(&mut self) -> f32 {
        let mut output = 0.0_f32;
        for burst in self.bursts.iter_mut() {
            if burst.finished {
                continue;
            }
            // Coefficients were computed once in `trigger`. They used to be
            // rebuilt here every sample — 4 transcendentals per burst, up to
            // 128 per sample across a full pool, for values that never change
            // while the burst lives.
            let (c0, c1, c2) = (burst.c0, burst.c1, burst.c2);

            self.rng_state = self
                .rng_state
                .wrapping_mul(1_664_525)
                .wrapping_add(1_013_904_223);
            let sample = (self.rng_state as i32 as f32) / (i32::MAX as f32);

            let y = c0 * (sample - burst.b1_x2) + c1 * burst.b1_y1 + c2 * burst.b1_y2;
            burst.b1_x2 = burst.b1_x1;
            burst.b1_x1 = sample;
            burst.b1_y2 = burst.b1_y1;
            burst.b1_y1 = y;
            output += y * burst.amplitude * burst.gain;

            burst.amplitude *= burst.decay;
            if burst.amplitude < 1.0e-5 {
                burst.finished = true;
            }
        }
        output
    }
}

fn db_to_gain(db: f32) -> f32 {
    (10.0_f32).powf(db / 20.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_when_no_bursts_triggered() {
        let mut noise = MechanicalNoise::new(48_000.0);
        for _ in 0..100 {
            assert_eq!(noise.tick(), 0.0);
        }
    }

    #[test]
    fn triggered_burst_produces_output() {
        let mut noise = MechanicalNoise::new(48_000.0);
        noise.trigger(NoiseEvent::KeyDown, 0.8);
        let mut total = 0.0_f32;
        for _ in 0..1_000 {
            total += noise.tick().abs();
        }
        assert!(total > 0.0);
    }

    #[test]
    fn burst_decays_to_silence() {
        let mut noise = MechanicalNoise::new(48_000.0);
        noise.trigger(NoiseEvent::HammerLetoff, 1.0);
        // Short event: should decay inside ~50 ms.
        for _ in 0..3_000 {
            let _ = noise.tick();
        }
        let mut tail = 0.0_f32;
        for _ in 0..1_000 {
            tail += noise.tick().abs();
        }
        assert_eq!(tail, 0.0);
    }

    #[test]
    fn pool_wraps_without_panic() {
        let mut noise = MechanicalNoise::new(48_000.0);
        for _ in 0..(MAX_BURSTS * 3) {
            noise.trigger(NoiseEvent::KeyDown, 0.5);
        }
    }
}
