//! Wet-path tone and width, shared by every Dutch Oven algorithm.
//!
//! `high_cut`, `low_cut` and `width` are not properties of a reverberation
//! topology. They are a two-filter, one-matrix stage sitting on the wet signal
//! *after* the tank has produced it, and they mean the same thing whether that
//! tank is a Dattorro plate, a feedback delay network or a dispersive spring.
//! The plate owned all three privately, so the descriptor advertised three
//! controls that only one of four selectable algorithms answered to.
//!
//! This is the same extraction `early_reflections.rs` performed for
//! `early_late` in #1481, and for the same reason: a control the panel renders
//! on every algorithm must mean one thing across the device, which it cannot
//! do while its only implementation is a private field of one engine.
//!
//! RT-safe: `new` allocates nothing beyond the struct itself, and `set_param`
//! and `process` are branch-and-arithmetic over four one-pole states.

use std::f32::consts::TAU;

/// Descriptor defaults for the three controls, kept here rather than at each
/// call site so four engines cannot disagree about what an untouched Dutch
/// Oven sounds like. They mirror `NativeDspDescriptors.ts`'s `dutch-oven`
/// entries and the plate's historical constructor values.
pub const DEFAULT_HIGH_CUT_HZ: f32 = 12_000.0;
pub const DEFAULT_LOW_CUT_HZ: f32 = 80.0;
pub const DEFAULT_WIDTH: f32 = 1.0;

/// Declared range of `high_cut`, matching the descriptor's `minValue`/`maxValue`.
const HIGH_CUT_RANGE: (f32, f32) = (1_000.0, 20_000.0);
/// Declared range of `low_cut`.
const LOW_CUT_RANGE: (f32, f32) = (20.0, 1_000.0);
/// Declared range of `width`: 0 collapses to mono, 1 is neutral, 2 doubles the
/// side component.
const WIDTH_RANGE: (f32, f32) = (0.0, 2.0);

/// One-pole lowpass. Its state *is* its output.
struct HighCut {
    state: f32,
    coeff: f32,
}

impl HighCut {
    fn new(freq: f32, sample_rate: f32) -> Self {
        Self {
            state: 0.0,
            coeff: pole_coeff(freq, sample_rate),
        }
    }

    fn set_freq(&mut self, freq: f32, sample_rate: f32) {
        self.coeff = pole_coeff(freq, sample_rate);
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        self.state = input * (1.0 - self.coeff) + self.state * self.coeff;
        self.state
    }
}

/// One-pole highpass: the lowpass residual.
struct LowCut {
    state: f32,
    coeff: f32,
}

impl LowCut {
    fn new(freq: f32, sample_rate: f32) -> Self {
        Self {
            state: 0.0,
            coeff: pole_coeff(freq, sample_rate),
        }
    }

    fn set_freq(&mut self, freq: f32, sample_rate: f32) {
        self.coeff = pole_coeff(freq, sample_rate);
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let hp = input - self.state;
        self.state += (1.0 - self.coeff) * hp;
        hp
    }
}

#[inline]
fn pole_coeff(freq: f32, sample_rate: f32) -> f32 {
    (-TAU * freq / sample_rate).exp()
}

/// Independent left and right filter instances, then a mid/side width matrix.
///
/// The pair is not an optimisation opportunity: the two channels carry
/// different signals on every engine that has a stereo tank, and running one
/// filter over both would fold them together before the width matrix ever saw
/// a side component.
pub struct OutputStage {
    sample_rate: f32,
    high_cut_l: HighCut,
    high_cut_r: HighCut,
    low_cut_l: LowCut,
    low_cut_r: LowCut,
    width: f32,
}

impl OutputStage {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            high_cut_l: HighCut::new(DEFAULT_HIGH_CUT_HZ, sample_rate),
            high_cut_r: HighCut::new(DEFAULT_HIGH_CUT_HZ, sample_rate),
            low_cut_l: LowCut::new(DEFAULT_LOW_CUT_HZ, sample_rate),
            low_cut_r: LowCut::new(DEFAULT_LOW_CUT_HZ, sample_rate),
            width: DEFAULT_WIDTH,
        }
    }

    /// Apply `name` if this stage owns it — the two **tone** ids only.
    ///
    /// Returns whether the write was consumed, so a caller's `set_param` can
    /// fall through to its own arms without listing these ids twice. The
    /// return value is what keeps this from becoming another `_ => {}`: an
    /// engine that forgets to consult it does not silently accept the write.
    ///
    /// `width` is deliberately *not* handled here, and `set_width` below is
    /// not reachable from a name. The filters apply to any wet signal, but the
    /// mid/side matrix only means something on an engine that produces two
    /// different channels — so each engine spells its own `"width"` arm, and
    /// an engine with a mono wet path simply has none. Accepting `width` in
    /// this shared file would also make it look reachable from every engine to
    /// `descriptorEngineParamWeld.spec.ts`, which resolves shared sources
    /// against all of them.
    pub fn set_param(&mut self, name: &str, value: f32) -> bool {
        match name {
            "high_cut" => {
                // The clamped value, not the raw one. The plate used to derive
                // the coefficient from the unclamped argument while storing the
                // clamped one in a field nothing read, so an out-of-range write
                // moved the filter somewhere the declared range does not reach.
                let freq = value.clamp(HIGH_CUT_RANGE.0, HIGH_CUT_RANGE.1);
                self.high_cut_l.set_freq(freq, self.sample_rate);
                self.high_cut_r.set_freq(freq, self.sample_rate);
                true
            }
            "low_cut" => {
                let freq = value.clamp(LOW_CUT_RANGE.0, LOW_CUT_RANGE.1);
                self.low_cut_l.set_freq(freq, self.sample_rate);
                self.low_cut_r.set_freq(freq, self.sample_rate);
                true
            }
            _ => false,
        }
    }

    /// Set the mid/side ratio. Called from a stereo engine's own `"width"` arm.
    pub fn set_width(&mut self, value: f32) {
        self.width = value.clamp(WIDTH_RANGE.0, WIDTH_RANGE.1);
    }

    /// Filter then widen one stereo frame of the **wet** signal.
    ///
    /// Callers pass the wet path only. Running the dry signal through here
    /// would filter the source as well as the reverb, which is not what any of
    /// the three controls claims to do.
    #[inline]
    pub fn process(&mut self, wet_l: f32, wet_r: f32) -> (f32, f32) {
        let filtered_l = self.low_cut_l.process(self.high_cut_l.process(wet_l));
        let filtered_r = self.low_cut_r.process(self.high_cut_r.process(wet_r));

        let mid = (filtered_l + filtered_r) * 0.5;
        let side = (filtered_l - filtered_r) * 0.5;
        (mid + side * self.width, mid - side * self.width)
    }

    /// Filter one **mono** wet sample. No width matrix — see `WIDTH`. Only the
    /// left filter pair runs; the right pair would be fed the same input from
    /// the same state and produce the same number.
    #[inline]
    pub fn process_mono(&mut self, wet: f32) -> f32 {
        self.low_cut_l.process(self.high_cut_l.process(wet))
    }

    /// The tone ids this stage answers to, for an engine's `param_names`.
    pub const PARAM_NAMES: [&'static str; 2] = ["high_cut", "low_cut"];

    /// The descriptor id a stereo engine adds alongside `PARAM_NAMES`.
    ///
    /// Separate because `width` is a mid/side matrix and a mono wet path has
    /// no side component for it to scale — the reverse engine writes one
    /// buffer and emits the same sample to both channels, so a `width` arm
    /// there would accept a value and provably not change an output sample.
    /// That is the discard this crate is trying to stop advertising, so the
    /// reverse engine takes the tone filters and does not claim the matrix.
    pub const WIDTH: &'static str = "width";
}

#[cfg(test)]
mod tests {
    use super::{OutputStage, DEFAULT_HIGH_CUT_HZ};

    /// A stage nobody wrote to and a stage written to the documented default
    /// must be the same filter, or the descriptor's `defaultValue` describes a
    /// setting the engine never actually starts from.
    #[test]
    fn the_constructor_agrees_with_the_documented_high_cut_default() {
        let mut untouched = OutputStage::new(48_000.0);
        let mut explicit = OutputStage::new(48_000.0);
        explicit.set_param("high_cut", DEFAULT_HIGH_CUT_HZ);

        for step in 0..64 {
            let input = (step as f32 * 0.37).sin();
            let (a_l, a_r) = untouched.process(input, -input);
            let (b_l, b_r) = explicit.process(input, -input);
            assert_eq!(a_l.to_bits(), b_l.to_bits());
            assert_eq!(a_r.to_bits(), b_r.to_bits());
        }
    }

    #[test]
    fn an_unowned_id_is_reported_as_not_consumed() {
        // The bool is the whole contract: an engine forwards on `false`. If
        // this returned `true` for everything, every engine using it would
        // regain the `_ => {}` it was built to remove.
        let mut stage = OutputStage::new(48_000.0);
        assert!(stage.set_param("low_cut", 200.0));
        assert!(!stage.set_param("decay", 0.5));
        assert!(!stage.set_param("shimmer", 1.0));
        // `width` is an engine-level arm, not a stage-level one.
        assert!(!stage.set_param("width", 0.5));
    }

    #[test]
    fn out_of_range_high_cut_lands_on_the_declared_edge() {
        let mut clamped = OutputStage::new(48_000.0);
        clamped.set_param("high_cut", 96_000.0);
        let mut at_max = OutputStage::new(48_000.0);
        at_max.set_param("high_cut", 20_000.0);

        for step in 0..64 {
            let input = (step as f32 * 0.11).cos();
            let (a_l, _) = clamped.process(input, input);
            let (b_l, _) = at_max.process(input, input);
            assert_eq!(
                a_l.to_bits(),
                b_l.to_bits(),
                "a write past the declared maximum must behave as the maximum"
            );
        }
    }
}
