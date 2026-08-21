//! Mastering EQ — 8-band parametric with M/S per-band option.

use super::biquad::{BiquadCoeffs, BiquadState, SmoothedBiquadCoeffs};

const NUM_BANDS: usize = 8;

#[derive(Clone, Copy, PartialEq)]
pub enum EqBandType {
    Peak,
    LowShelf,
    HighShelf,
    HighPass,
    LowPass,
}

#[derive(Clone, Copy, PartialEq)]
pub enum EqBandChannel {
    /// Normal L/R processing
    Stereo,
    /// Mid channel only
    Mid,
    /// Side channel only
    Side,
}

struct MasteringEqBand {
    enabled: bool,
    band_type: EqBandType,
    channel: EqBandChannel,
    freq: f64,
    gain_db: f64,
    q: f64,
    /// DSP-4: automation drives freq/gain/q continuously, so the band ramps to
    /// new coefficients instead of swapping them under the running filter.
    coeffs: SmoothedBiquadCoeffs,
    // For stereo mode: L/R states
    state_l: BiquadState,
    state_r: BiquadState,
    // For M/S mode: mid/side states
    state_m: BiquadState,
    state_s: BiquadState,
}

impl MasteringEqBand {
    fn new(freq: f64, band_type: EqBandType, sr: f64) -> Self {
        Self {
            enabled: false,
            band_type,
            channel: EqBandChannel::Stereo,
            freq,
            gain_db: 0.0,
            q: 1.0,
            coeffs: SmoothedBiquadCoeffs::new(BiquadCoeffs::unity(), sr),
            state_l: BiquadState::new(),
            state_r: BiquadState::new(),
            state_m: BiquadState::new(),
            state_s: BiquadState::new(),
        }
    }

    fn designed_coeffs(&self, sr: f64) -> BiquadCoeffs {
        match self.band_type {
            EqBandType::Peak => BiquadCoeffs::peak(self.freq, self.gain_db, self.q, sr),
            EqBandType::LowShelf => BiquadCoeffs::low_shelf(self.freq, self.gain_db, self.q, sr),
            EqBandType::HighShelf => BiquadCoeffs::high_shelf(self.freq, self.gain_db, self.q, sr),
            EqBandType::HighPass => BiquadCoeffs::highpass(self.freq, self.q, sr),
            EqBandType::LowPass => BiquadCoeffs::lowpass(self.freq, self.q, sr),
        }
    }

    fn recompute(&mut self, sr: f64) {
        let designed = self.designed_coeffs(sr);
        self.coeffs.set_target(designed);
    }
}

pub struct MasteringEq {
    bands: Vec<MasteringEqBand>,
    sample_rate: f64,
    output_gain: f32,
    bypassed: bool,
}

impl MasteringEq {
    pub fn new(sr: f64) -> Self {
        let default_freqs = [30.0, 80.0, 250.0, 800.0, 2500.0, 6000.0, 12000.0, 18000.0];
        let default_types = [
            EqBandType::HighPass,
            EqBandType::LowShelf,
            EqBandType::Peak,
            EqBandType::Peak,
            EqBandType::Peak,
            EqBandType::Peak,
            EqBandType::HighShelf,
            EqBandType::LowPass,
        ];

        let bands = (0..NUM_BANDS)
            .map(|i| {
                let mut band = MasteringEqBand::new(default_freqs[i], default_types[i], sr);
                if i >= 2 && i <= 5 {
                    band.enabled = true;
                }
                band
            })
            .collect();

        Self {
            bands,
            sample_rate: sr,
            output_gain: 1.0,
            bypassed: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if name == "eq_bypass" {
            self.bypassed = value > 0.5;
            return;
        }
        if name == "eq_output_gain" {
            // Same unclamped `powf` the chain trim carried: past ~+38 dB it
            // answers `inf` and the poisoned factor multiplies every later
            // sample until another message arrives.
            self.output_gain = super::chain::gain_from_db(value);
            return;
        }

        // Parse "eq_bandN_param" pattern
        if !name.starts_with("eq_band") || name.len() < 10 {
            return;
        }
        let idx = match name.as_bytes()[7] {
            b'0'..=b'7' => (name.as_bytes()[7] - b'0') as usize,
            _ => return,
        };
        if idx >= self.bands.len() {
            return;
        }
        let param = &name[9..]; // skip "eq_bandN_"

        match param {
            "freq" => {
                self.bands[idx].freq = (value as f64).clamp(20.0, 20000.0);
                self.bands[idx].recompute(self.sample_rate);
            }
            "gain" => {
                self.bands[idx].gain_db = (value as f64).clamp(-18.0, 18.0);
                self.bands[idx].recompute(self.sample_rate);
            }
            "q" => {
                self.bands[idx].q = (value as f64).clamp(0.1, 10.0);
                self.bands[idx].recompute(self.sample_rate);
            }
            "type" => {
                self.bands[idx].band_type = match value as u32 {
                    0 => EqBandType::Peak,
                    1 => EqBandType::LowShelf,
                    2 => EqBandType::HighShelf,
                    3 => EqBandType::HighPass,
                    4 => EqBandType::LowPass,
                    _ => EqBandType::Peak,
                };
                self.bands[idx].recompute(self.sample_rate);
            }
            "channel" => {
                self.bands[idx].channel = match value as u32 {
                    0 => EqBandChannel::Stereo,
                    1 => EqBandChannel::Mid,
                    2 => EqBandChannel::Side,
                    _ => EqBandChannel::Stereo,
                };
            }
            "enabled" => {
                self.bands[idx].enabled = value > 0.5;
            }
            _ => {}
        }
    }

    #[inline]
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }
        let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2;

        for i in 0..left.len() {
            let mut l = left[i];
            let mut r = right[i];

            for band in self.bands.iter_mut() {
                if !band.enabled {
                    continue;
                }

                // One ramp step per band per sample, shared by both channels.
                let coeffs = band.coeffs.next();

                match band.channel {
                    EqBandChannel::Stereo => {
                        l = band.state_l.process(l, &coeffs);
                        r = band.state_r.process(r, &coeffs);
                    }
                    EqBandChannel::Mid => {
                        let m = (l + r) * inv_sqrt2;
                        let s = (l - r) * inv_sqrt2;
                        let m_eq = band.state_m.process(m, &coeffs);
                        l = (m_eq + s) * inv_sqrt2;
                        r = (m_eq - s) * inv_sqrt2;
                    }
                    EqBandChannel::Side => {
                        let m = (l + r) * inv_sqrt2;
                        let s = (l - r) * inv_sqrt2;
                        let s_eq = band.state_s.process(s, &coeffs);
                        l = (m + s_eq) * inv_sqrt2;
                        r = (m - s_eq) * inv_sqrt2;
                    }
                }
            }

            left[i] = l * self.output_gain;
            right[i] = r * self.output_gain;
        }
    }

    pub fn is_bypassed(&self) -> bool {
        self.bypassed
    }
}
