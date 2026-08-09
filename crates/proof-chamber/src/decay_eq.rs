//! Decay Rate EQ — six bands of control over *how fast each part of the
//! spectrum decays*, rather than over how loud it is.
//!
//! # What the panel sends
//!
//! `ProofChamberPanel`'s Decay EQ overlay drags six nodes and writes
//! `decay_eq_0` … `decay_eq_5`, each a **decay-time multiplier** in
//! 0.25x…4.0x. 1.0x is "this band decays at the base rate", which is the
//! default and is bit-exactly transparent — see `recompute_filter`.
//!
//! # How a multiplier becomes a filter
//!
//! Jot's frequency-dependent decay: a recirculating loop whose per-pass gain is
//! `g` has `RT60 ∝ -1 / log10(g)`, so a band that should decay `m` times slower
//! needs a per-pass gain of `g^(1/m)` in that band. The filter therefore has to
//! supply `g^(1/m) / g = g^(1/m - 1)`, which in dB is
//!
//! ```text
//! gain_db = 20 * log10(g) * (1/m - 1) = head_room_db * (1 - 1/m)
//! ```
//!
//! where `head_room_db = -20 * log10(g) >= 0` is how much the loop already
//! loses on each pass.
//!
//! **The whole design lives in that identity, and the reason it is written in
//! terms of the loop gain rather than in terms of an RT60 is that only one of
//! the four engines that run this stage has an RT60.** The FDN does
//! (`loop_gain_from_rt60` converts); the plate's tank has a per-pass
//! coefficient, and the spring has a feedback gain. Expressing the stage in
//! seconds would have forced two of the three to invent one.
//!
//! It is also what makes the stage sample-rate independent without a single
//! rate term of its own: `g` is per pass, the loop length in *seconds* does not
//! change with the rate on any of the three engines, and the band centres are
//! absolute hertz converted through `TAU * freq / sample_rate` in the designer.
//!
//! # Realtime
//!
//! Filters are redesigned only when a multiplier or the base loop gain changes,
//! and each redesign is six `Biquad::design_*` calls — transcendental, but
//! allocation-free, lock-free and bounded. `process` is six multiply-add pairs.

use std::f32::consts::TAU;

// ---------------------------------------------------------------------------
// Biquad filter (second-order IIR)
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::new()
    }
}

impl Biquad {
    pub fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// Design a peaking EQ filter.
    ///
    /// At `gain_db == 0.0` this is **bit-exactly** a pass-through, and that is
    /// load-bearing rather than incidental: it is what lets the default 1.0x
    /// curve leave `plate_parameter_surface.rs`'s and
    /// `algorithm_switch_parameter_retention.rs`'s pinned digests where they
    /// are. `a` is `10^0 == 1.0`, so `b0/a0` divides `1 + alpha` by the
    /// identical expression `1 + alpha`, and `b1`/`a1` and `b2`/`a2` are
    /// likewise the same float. `process` then computes `1.0 * x + 0.0` and
    /// leaves its state at exactly zero. The same holds for both shelves below.
    pub fn design_peak(&mut self, freq: f32, gain_db: f32, q: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    /// Design a low shelf filter.
    pub fn design_low_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (-2.0 * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    /// Design a high shelf filter.
    pub fn design_high_shelf(&mut self, freq: f32, gain_db: f32, sample_rate: f32) {
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * freq / sample_rate;
        let alpha = w0.sin() / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let cos_w0 = w0.cos();
        let sqrt_a_alpha = 2.0 * a.sqrt() * alpha;

        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + sqrt_a_alpha;
        self.b0 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 + sqrt_a_alpha)) / a0;
        self.b1 = (-2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
        self.b2 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 - sqrt_a_alpha)) / a0;
        self.a1 = (2.0 * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
        self.a2 = ((a + 1.0) - (a - 1.0) * cos_w0 - sqrt_a_alpha) / a0;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

// ---------------------------------------------------------------------------
// Decay Rate EQ (6-band)
// ---------------------------------------------------------------------------

pub const NUM_BANDS: usize = 6;

/// The travel of one band, matching `DecayEqOverlay.tsx`'s `MIN_MULT`/`MAX_MULT`
/// and the `decay_eq_*` rows in `NativeDspDescriptors.ts`. All three are welded
/// by `declaredRangeVsKnobTravel.spec.ts`.
pub const MIN_MULTIPLIER: f32 = 0.25;
pub const MAX_MULTIPLIER: f32 = 4.0;
pub const DEFAULT_MULTIPLIER: f32 = 1.0;

/// The six wire names, in band order.
///
/// Declared here so `param_names()` on three engines cannot drift from each
/// other. The `set_param` **arms** are still spelled out literally in each
/// engine, and deliberately so: `descriptorEngineParamWeld.spec.ts` reads match
/// arms out of the Rust, treats everything outside an engine's own file as
/// shared by *every* engine, and would therefore read an arm placed here as
/// proof that the reverse engine answers to these ids — which it does not.
pub const PARAM_NAMES: [&str; NUM_BANDS] = [
    "decay_eq_0",
    "decay_eq_1",
    "decay_eq_2",
    "decay_eq_3",
    "decay_eq_4",
    "decay_eq_5",
];

/// The band a `decay_eq_N` write addresses, or `None` for anything else.
///
/// Deliberately not named `*param*`: the weld spec scans the body of every
/// function whose name contains "param" for match arms, and a helper holding
/// all six literals in one shared file would vouch for engines that drop them.
pub fn band_index_for_name(name: &str) -> Option<usize> {
    PARAM_NAMES.iter().position(|candidate| *candidate == name)
}

/// The per-pass loop gain a delay line of `delay_samples` runs at to reach
/// `rt60_seconds` — Jot's `g = 10^(-3M / (fs * RT60))`.
///
/// The FDN's own `AbsorptiveFilter` computes the identical expression for its
/// low band; this exists so the decay EQ is told the *same* base gain the line
/// is actually running at rather than a second approximation of it.
pub fn loop_gain_from_rt60(delay_samples: usize, sample_rate: f32, rt60_seconds: f32) -> f32 {
    if rt60_seconds <= 0.01 || sample_rate <= 0.0 {
        return MIN_BASE_LOOP_GAIN;
    }
    let m = delay_samples as f32;
    10.0_f32.powf(-3.0 * m / (sample_rate * rt60_seconds))
}

/// Floor on the base loop gain, i.e. a ceiling of 60 dB on `head_room_db`.
///
/// Without it a plate at `decay = 0` divides by `log10(0)` and every filter is
/// designed at infinite gain. 60 dB is past any setting an engine reaches in
/// practice — the FDN's shortest line at its shortest RT60 is about 36 dB — and
/// a peaking section designed at the ceiling still has its poles comfortably
/// inside the unit circle in `f32`.
const MIN_BASE_LOOP_GAIN: f32 = 0.001;

/// How much of the loop's per-pass headroom the cascade may spend on boosts,
/// summed across all six bands.
///
/// **This is a stability bound, not a taste control, and it is the one thing
/// the original `decay_eq.rs` was missing.** Each band on its own is stable by
/// construction: the resulting per-pass gain in that band is `g^(1/m)`, which
/// is below unity for every finite `m`. Six *cascaded* sections are not, because
/// their magnitudes multiply — a frequency sitting between two boosted bells
/// receives both boosts, and with several bands pushed to 4.0x the compound
/// gain exceeds the loop's headroom and the reverb self-oscillates.
///
/// The bound is the conservative one, which is what makes it cheap enough to
/// evaluate on a parameter write: a cascade's magnitude in dB is the sum of its
/// sections', and a peaking or shelving section never exceeds its own design
/// gain, so `|H| <= sum of the positive design gains`. Writing each design gain
/// as `head_room_db * (1 - 1/m)` makes the whole bound scale-free — the
/// `head_room_db` factors cancel — and stability reduces to
///
/// ```text
/// sum over boosted bands of (1 - 1/m) < 1
/// ```
///
/// 0.95 leaves 5% of the headroom as margin. One band alone reaches
/// `1 - 1/4 = 0.75` and is never scaled, so the common case and every per-band
/// measurement in `decay_eq_parameter_surface.rs` are untouched by this; it
/// engages only when two or more bands are boosted hard at once, and then it
/// scales the boosts proportionally rather than refusing the write. Cuts are
/// left alone: they can only shorten the tail.
const MAX_TOTAL_BOOST: f32 = 0.95;

/// One band of the Decay Rate EQ.
#[derive(Clone, Copy)]
pub struct DecayEqBand {
    pub freq: f32,
    pub multiplier: f32,
    pub q: f32,
    pub band_type: BandType,
}

#[derive(Clone, Copy, PartialEq)]
pub enum BandType {
    LowShelf,
    Bell,
    HighShelf,
}

/// The six band centres, matching `BAND_FREQS` in `DecayEqOverlay.tsx`.
pub fn default_bands() -> [DecayEqBand; NUM_BANDS] {
    [
        DecayEqBand {
            freq: 100.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 0.707,
            band_type: BandType::LowShelf,
        },
        DecayEqBand {
            freq: 400.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 1200.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 3500.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 8000.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 1.0,
            band_type: BandType::Bell,
        },
        DecayEqBand {
            freq: 12000.0,
            multiplier: DEFAULT_MULTIPLIER,
            q: 0.707,
            band_type: BandType::HighShelf,
        },
    ]
}

/// Decay Rate EQ for **one** recirculating path.
///
/// One instance per independent loop: two on the plate (one per tank half), one
/// on the spring, and one per delay line on the FDN — where each line has its
/// own length and therefore its own base loop gain.
pub struct DecayRateEq {
    biquads: [Biquad; NUM_BANDS],
    bands: [DecayEqBand; NUM_BANDS],
    sample_rate: f32,
    /// Per-pass gain of the loop this stage sits in, before the EQ.
    base_loop_gain: f32,
}

impl DecayRateEq {
    pub fn new(sample_rate: f32, base_loop_gain: f32) -> Self {
        let mut eq = Self {
            biquads: core::array::from_fn(|_| Biquad::new()),
            bands: default_bands(),
            sample_rate,
            base_loop_gain: base_loop_gain.clamp(MIN_BASE_LOOP_GAIN, 1.0),
        };
        eq.recompute_filters();
        eq
    }

    /// Set a band's decay multiplier.
    ///
    /// Recomputes **all six** filters rather than only this one, because
    /// `MAX_TOTAL_BOOST` couples them: raising one band can require the others'
    /// boosts to be scaled back.
    pub fn set_band_multiplier(&mut self, band_index: usize, multiplier: f32) {
        if band_index >= NUM_BANDS {
            return;
        }
        let clamped = multiplier.clamp(MIN_MULTIPLIER, MAX_MULTIPLIER);
        if self.bands[band_index].multiplier == clamped {
            return;
        }
        self.bands[band_index].multiplier = clamped;
        self.recompute_filters();
    }

    pub fn band_multiplier(&self, band_index: usize) -> f32 {
        if band_index >= NUM_BANDS {
            return DEFAULT_MULTIPLIER;
        }
        self.bands[band_index].multiplier
    }

    /// Tell the stage what the loop around it is doing.
    ///
    /// Called whenever the host engine's decay, damping or delay length moves —
    /// the shaping is *relative* to the base decay, so a curve set at one Decay
    /// setting has to keep meaning the same thing at the next one.
    pub fn set_base_loop_gain(&mut self, gain: f32) {
        let clamped = gain.clamp(MIN_BASE_LOOP_GAIN, 1.0);
        if self.base_loop_gain == clamped {
            return;
        }
        self.base_loop_gain = clamped;
        self.recompute_filters();
    }

    /// True while every band sits at 1.0x, i.e. while the cascade is the
    /// identity. Engines use it for nothing; guards use it to state what they
    /// are measuring.
    pub fn is_neutral(&self) -> bool {
        self.bands
            .iter()
            .all(|band| band.multiplier == DEFAULT_MULTIPLIER)
    }

    fn recompute_filters(&mut self) {
        // `-20 * log10(g)`, the per-pass loss the loop already has, which is
        // both the scale of the shaping and the budget it has to stay inside.
        let head_room_db = -20.0 * self.base_loop_gain.log10();

        let mut boost_total = 0.0_f32;
        for band in self.bands.iter() {
            boost_total += (1.0 - 1.0 / band.multiplier).max(0.0);
        }
        let mut boost_scale = 1.0_f32;
        if boost_total > MAX_TOTAL_BOOST {
            boost_scale = MAX_TOTAL_BOOST / boost_total;
        }

        for index in 0..NUM_BANDS {
            self.recompute_filter(index, head_room_db, boost_scale);
        }
    }

    fn recompute_filter(&mut self, index: usize, head_room_db: f32, boost_scale: f32) {
        let band = self.bands[index];

        // `share > 0` lengthens this band's decay and spends headroom;
        // `share < 0` shortens it and cannot destabilise anything, so only the
        // positive side is scaled. At the 1.0x default `share` is exactly 0.0
        // and `gain_db` is exactly 0.0, which is the transparency the digests
        // depend on.
        let share = 1.0 - 1.0 / band.multiplier;
        let mut scaled = share;
        if share > 0.0 {
            scaled = share * boost_scale;
        }
        let gain_db = head_room_db * scaled;

        // A band centre above Nyquist designs a filter with an aliased centre
        // frequency, which is how a stage that measures correctly at 48 kHz
        // renders something else at another rate. 0.45 keeps the top shelf
        // below the fold at every rate the engine is constructed with.
        let freq = band.freq.min(self.sample_rate * 0.45);

        match band.band_type {
            BandType::LowShelf => self.biquads[index].design_low_shelf(freq, gain_db, self.sample_rate),
            BandType::Bell => self.biquads[index].design_peak(freq, gain_db, band.q, self.sample_rate),
            BandType::HighShelf => {
                self.biquads[index].design_high_shelf(freq, gain_db, self.sample_rate)
            }
        }
    }

    /// Process one sample through all six bands.
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let mut signal = input;
        for bq in self.biquads.iter_mut() {
            signal = bq.process(signal);
        }
        signal
    }

    pub fn reset(&mut self) {
        for bq in self.biquads.iter_mut() {
            bq.reset();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        band_index_for_name, loop_gain_from_rt60, DecayRateEq, DEFAULT_MULTIPLIER, MAX_MULTIPLIER,
        MIN_MULTIPLIER, NUM_BANDS, PARAM_NAMES,
    };

    #[test]
    fn every_wire_name_resolves_to_its_own_band_and_nothing_else_resolves() {
        for (index, name) in PARAM_NAMES.iter().enumerate() {
            assert_eq!(band_index_for_name(name), Some(index));
        }
        assert_eq!(band_index_for_name("decay_eq_6"), None);
        assert_eq!(band_index_for_name("decay"), None);
        assert_eq!(band_index_for_name("decay_eq_"), None);
    }

    #[test]
    fn the_neutral_curve_is_bit_exactly_transparent() {
        // The claim `plate_parameter_surface.rs`'s and
        // `algorithm_switch_parameter_retention.rs`'s pinned digests rest on.
        for gain in [0.999_f32, 0.9, 0.5, 0.1, 0.01] {
            let mut eq = DecayRateEq::new(48_000.0, gain);
            assert!(eq.is_neutral());
            for step in 0..2_000 {
                let input = ((step as f32) * 0.017).sin() * 0.7;
                let output = eq.process(input);
                assert_eq!(
                    output.to_bits(),
                    input.to_bits(),
                    "a 1.0x curve at base gain {gain} altered sample {step}: {input} -> {output}"
                );
            }
        }
    }

    #[test]
    fn writes_outside_the_declared_travel_are_clamped_to_it() {
        let mut eq = DecayRateEq::new(48_000.0, 0.5);
        eq.set_band_multiplier(0, 99.0);
        assert_eq!(eq.band_multiplier(0), MAX_MULTIPLIER);
        eq.set_band_multiplier(0, -3.0);
        assert_eq!(eq.band_multiplier(0), MIN_MULTIPLIER);
        // Out-of-range band indices are dropped, not panicked on: `set_param`
        // is reached from the audio thread.
        eq.set_band_multiplier(NUM_BANDS, 2.0);
        for index in 0..NUM_BANDS {
            let expected = if index == 0 {
                MIN_MULTIPLIER
            } else {
                DEFAULT_MULTIPLIER
            };
            assert_eq!(eq.band_multiplier(index), expected);
        }
    }

    #[test]
    fn all_six_bands_at_full_boost_stay_inside_the_loop_headroom() {
        // The bound `MAX_TOTAL_BOOST` exists for. Feed an impulse into the
        // cascade *inside* a loop running at the base gain and check the
        // energy dies rather than growing.
        let base_gain = 0.5_f32;
        let mut eq = DecayRateEq::new(48_000.0, base_gain);
        for index in 0..NUM_BANDS {
            eq.set_band_multiplier(index, MAX_MULTIPLIER);
        }

        let mut state = 1.0_f32;
        let mut peak_late = 0.0_f32;
        for step in 0..400_000 {
            state = eq.process(state) * base_gain;
            assert!(state.is_finite(), "loop diverged to {state} at step {step}");
            if step > 200_000 {
                peak_late = peak_late.max(state.abs());
            }
        }
        assert!(
            peak_late < 1e-3,
            "six bands at {MAX_MULTIPLIER}x must still decay; late peak was {peak_late}"
        );
    }

    #[test]
    fn rt60_conversion_matches_the_jot_gain_the_fdn_lines_run_at() {
        // 24_000 samples at 48 kHz is 0.5 s of delay; an RT60 of 1.5 s is three
        // passes, so the gain is 10^(-3 * 0.5 / 1.5) = 10^-1.
        let gain = loop_gain_from_rt60(24_000, 48_000.0, 1.5);
        assert!((gain - 0.1).abs() < 1e-6, "expected 0.1, got {gain}");
        // A degenerate RT60 floors rather than dividing by zero.
        assert_eq!(loop_gain_from_rt60(24_000, 48_000.0, 0.0), 0.001);
    }
}
