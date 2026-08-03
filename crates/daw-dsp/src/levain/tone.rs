//! The Tone macro's brightness tilt.
//!
//! A tilt is the conventional shape for a sampler tone macro — a low shelf and
//! a high shelf hinged at one frequency and moved in opposite directions, so
//! the centre position is flat and either extreme trades one end of the
//! spectrum for the other.
//!
//! It is the standard first-order tilt section, not a complementary one-pole
//! split. The split (`low + high == x`, scale each band) is the cheaper thing
//! and it is what `voice.rs` uses for the MPE timbre tilt, but its magnitude
//! response is +3.3 dB at the hinge at ±6 dB of tilt rather than 0 dB, so its
//! "hinge" is not where the shelves cross. Placing the zero at `w0/G` and the
//! pole at `w0·G` gives `1/G` at DC, `G` at Nyquist and exactly `1` at `w0` —
//! a see-saw about a fixed, stated pivot, which is what the control claims to
//! be.

/// Hinge frequency, in Hz. 1 kHz is the standard tilt-EQ pivot (Tonelux Tilt,
/// the Niveau filter), and for an orchestral instrument it sits above the
/// fundamentals of everything but the piccolo while staying below the bow,
/// breath and air region a player reaches for the Tone knob to adjust. Fixed,
/// not exposed: a macro that also asked which frequency to hinge at would be an
/// EQ.
const HINGE_HZ: f32 = 1_000.0;

/// Gain at each extreme, in dB. ±6 dB per side means the full sweep from dark
/// to bright is 12 dB of tilt — enough to be a voicing decision, not enough to
/// be a filter.
const MAX_TILT_DB: f32 = 6.0;

pub struct ToneTilt {
    /// Prewarped hinge, `tan(pi * f0 / fs)`. Fixed at construction.
    hinge_k: f32,
    b0: f32,
    b1: f32,
    a1: f32,
    x1: f32,
    y1: f32,
    /// False at the centre position, where the tilt is the identity and the
    /// section is taken out of the path entirely rather than multiplied by one.
    engaged: bool,
}

impl ToneTilt {
    pub fn new(sample_rate: f32) -> Self {
        let hinge_k = (std::f32::consts::PI * HINGE_HZ / sample_rate.max(1.0)).tan();
        Self {
            hinge_k,
            b0: 1.0,
            b1: 0.0,
            a1: 0.0,
            x1: 0.0,
            y1: 0.0,
            engaged: false,
        }
    }

    /// Set the tilt from a 0..1 macro position: 0 fully dark, 0.5 flat, 1 fully
    /// bright. Control rate only — no allocation, but `powf` and `tan` are not
    /// for the audio thread.
    pub fn set_position(&mut self, position: f32) {
        let tilt_db = (position.clamp(0.0, 1.0) - 0.5) * 2.0 * MAX_TILT_DB;
        if tilt_db.abs() <= 1.0e-4 {
            self.engaged = false;
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.a1 = 0.0;
            self.x1 = 0.0;
            self.y1 = 0.0;
            return;
        }

        // Bilinear transform of H(s) = G (s + w0/G) / (s + w0 G), with the
        // hinge prewarped so the pivot lands on HINGE_HZ.
        let gain = 10.0_f32.powf(tilt_db / 20.0);
        let k = self.hinge_k;
        let denominator = 1.0 + gain * k;
        self.b0 = (gain + k) / denominator;
        self.b1 = (k - gain) / denominator;
        self.a1 = (gain * k - 1.0) / denominator;
        self.engaged = true;
    }

    #[inline]
    pub fn tick(&mut self, input: f32) -> f32 {
        if !self.engaged {
            return input;
        }
        let output = self.b0 * input + self.b1 * self.x1 - self.a1 * self.y1;
        self.x1 = input;
        self.y1 = output;
        output
    }
}

#[cfg(test)]
mod tests {
    use super::{ToneTilt, HINGE_HZ, MAX_TILT_DB};

    const SAMPLE_RATE: f32 = 48_000.0;

    /// Steady-state gain the tilt applies to a sine at `hz`, in dB. Measured as
    /// an RMS ratio rather than a peak ratio: a 10 kHz sine at 48 kHz is only
    /// ~5 samples per cycle, so its sampled peak lands wherever the phase
    /// happens to fall and reads several tenths of a dB off, in different
    /// directions for input and output.
    ///
    /// A tilt's whole claim is that it moves the two ends of the spectrum in
    /// opposite directions, which no broadband measurement can see. This is
    /// per frequency for that reason.
    fn gain_db_at(position: f32, hz: f32) -> f32 {
        let mut tilt = ToneTilt::new(SAMPLE_RATE);
        tilt.set_position(position);

        let settle = 4_800;
        let frames = 48_000;
        let mut energy_in = 0.0_f64;
        let mut energy_out = 0.0_f64;
        for frame in 0..(settle + frames) {
            let phase = frame as f32 / SAMPLE_RATE * hz * std::f32::consts::TAU;
            let input = phase.sin();
            let output = tilt.tick(input);
            if frame >= settle {
                energy_in += (input as f64) * (input as f64);
                energy_out += (output as f64) * (output as f64);
            }
        }
        20.0 * (energy_out / energy_in).sqrt().log10() as f32
    }

    #[test]
    fn the_bright_extreme_lifts_highs_and_cuts_lows_by_the_stated_amount() {
        // Well below and well above the hinge, where the shelves have reached
        // their plateaus rather than approached them.
        let low = gain_db_at(1.0, 50.0);
        let high = gain_db_at(1.0, 10_000.0);

        assert!(
            (low + MAX_TILT_DB).abs() < 0.5,
            "the bright extreme must cut the low band by {MAX_TILT_DB} dB, got {low} dB"
        );
        assert!(
            (high - MAX_TILT_DB).abs() < 0.5,
            "the bright extreme must lift the high band by {MAX_TILT_DB} dB, got {high} dB"
        );
    }

    #[test]
    fn the_dark_extreme_is_the_mirror_of_the_bright_one() {
        let low = gain_db_at(0.0, 50.0);
        let high = gain_db_at(0.0, 10_000.0);

        assert!(
            (low - MAX_TILT_DB).abs() < 0.5,
            "the dark extreme must lift the low band by {MAX_TILT_DB} dB, got {low} dB"
        );
        assert!(
            (high + MAX_TILT_DB).abs() < 0.5,
            "the dark extreme must cut the high band by {MAX_TILT_DB} dB, got {high} dB"
        );
    }

    #[test]
    fn the_hinge_is_the_pivot_the_shelves_cross_at() {
        let hinge = gain_db_at(1.0, HINGE_HZ);
        let below = gain_db_at(1.0, 250.0);
        let above = gain_db_at(1.0, 4_000.0);

        assert!(
            hinge.abs() < 0.2,
            "the tilt must pass its own hinge frequency flat, got {hinge} dB at {HINGE_HZ} Hz"
        );
        assert!(
            below < -1.0 && above > 1.0,
            "the hinge must separate a cut from a boost, got {below} dB at 250 Hz \
             and {above} dB at 4 kHz"
        );
    }

    #[test]
    fn the_centre_position_is_the_identity() {
        let mut tilt = ToneTilt::new(SAMPLE_RATE);
        tilt.set_position(0.5);

        for frame in 0..1_000 {
            let input = (frame as f32 * 0.017).sin() * 0.7;
            assert_eq!(
                tilt.tick(input),
                input,
                "a centred Tone macro must return the sample bit-unchanged"
            );
        }
    }
}
