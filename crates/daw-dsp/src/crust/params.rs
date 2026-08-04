//! Crust's discrete parameter spaces and per-algorithm voicing.
//!
//! The indices here are the wire format the TypeScript param bridge encodes
//! into (`src/modules/Crust/useCases/crustParamBridge/helpers.ts`); the two
//! tables have to agree or the panel selects a different algorithm than the one
//! it draws as active.

/// Limiting algorithms the panel's SHAPE level offers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Algorithm {
    Transparent,
    Punchy,
    Dynamic,
    Allround,
    Aggressive,
    Bus,
    Safe,
    Wall,
}

impl Algorithm {
    pub fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Punchy,
            2 => Self::Dynamic,
            3 => Self::Allround,
            4 => Self::Aggressive,
            5 => Self::Bus,
            6 => Self::Safe,
            7 => Self::Wall,
            _ => Self::Transparent,
        }
    }

    /// The PLAY level's three-way `style` control is a simplification of the
    /// same eight algorithms, not a separate mechanism.
    pub fn from_style_index(index: u32) -> Self {
        match index {
            1 => Self::Punchy,
            2 => Self::Wall,
            _ => Self::Transparent,
        }
    }

    /// Attack and release used when the panel's auto switches are on.
    ///
    /// These are what separates the algorithms: a limiter's character is
    /// almost entirely its envelope timing, so an "algorithm" that did not move
    /// them would be a label with no signal behind it.
    pub fn profile(self) -> AlgorithmProfile {
        match self {
            // Long release, instant attack: nothing is coloured, peaks are
            // simply not allowed through.
            Self::Transparent => AlgorithmProfile {
                attack_ms: 0.0,
                release_ms: 320.0,
                link_scale: 1.0,
            },
            // Short release lets level back between hits, which is what reads
            // as punch.
            Self::Punchy => AlgorithmProfile {
                attack_ms: 0.4,
                release_ms: 60.0,
                link_scale: 0.8,
            },
            Self::Dynamic => AlgorithmProfile {
                attack_ms: 0.2,
                release_ms: 150.0,
                link_scale: 0.9,
            },
            Self::Allround => AlgorithmProfile {
                attack_ms: 0.1,
                release_ms: 120.0,
                link_scale: 1.0,
            },
            Self::Aggressive => AlgorithmProfile {
                attack_ms: 0.0,
                release_ms: 30.0,
                link_scale: 0.6,
            },
            // Bus duty: slow enough not to modulate a mix's own envelope.
            Self::Bus => AlgorithmProfile {
                attack_ms: 0.6,
                release_ms: 260.0,
                link_scale: 1.0,
            },
            Self::Safe => AlgorithmProfile {
                attack_ms: 0.0,
                release_ms: 450.0,
                link_scale: 1.0,
            },
            // Brickwall: hold the gain down and keep it down.
            Self::Wall => AlgorithmProfile {
                attack_ms: 0.0,
                release_ms: 12.0,
                link_scale: 1.0,
            },
        }
    }
}

#[derive(Clone, Copy)]
pub struct AlgorithmProfile {
    pub attack_ms: f32,
    pub release_ms: f32,
    /// Multiplier applied to both channel-link controls, so an algorithm can
    /// bias toward independent channels without taking the control away.
    pub link_scale: f32,
}

/// Stereo processing domain.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum StereoMode {
    LeftRight,
    MidSide,
}

impl StereoMode {
    pub fn from_index(index: u32) -> Self {
        if index == 1 {
            Self::MidSide
        } else {
            Self::LeftRight
        }
    }
}

/// Output dither, mapped onto the shared [`crate::proof::dither`] modes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DitherKind {
    Off,
    /// TPDF at the selected output bit depth.
    Tpdf,
    /// Noise-shaped (POW-R family).
    NoiseShaped,
}

impl DitherKind {
    /// Panel order: off, tpdf16, tpdf24, powr1, powr2, powr3.
    pub fn from_index(index: u32) -> Self {
        match index {
            1 | 2 => Self::Tpdf,
            3..=5 => Self::NoiseShaped,
            _ => Self::Off,
        }
    }

    /// Bit depth the TPDF entries name explicitly. The POW-R entries and `off`
    /// carry none, so the engine keeps the panel's `outputBitDepth`.
    pub fn implied_bit_depth(index: u32) -> Option<u32> {
        match index {
            1 => Some(16),
            2 => Some(24),
            _ => None,
        }
    }

    pub fn shared_mode_index(self) -> f32 {
        match self {
            Self::Off => 0.0,
            Self::Tpdf => 1.0,
            Self::NoiseShaped => 2.0,
        }
    }
}

/// Band count the ROUTE level's multiband control selects.
pub fn band_count_from_index(index: u32) -> usize {
    match index {
        1 => 3,
        2 => 5,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{band_count_from_index, Algorithm, DitherKind, StereoMode};

    /// The index tables are a wire format shared with the TypeScript bridge.
    /// An off-by-one here selects a different algorithm than the panel draws.
    #[test]
    fn algorithm_indices_match_the_panel_order() {
        let expected = [
            Algorithm::Transparent,
            Algorithm::Punchy,
            Algorithm::Dynamic,
            Algorithm::Allround,
            Algorithm::Aggressive,
            Algorithm::Bus,
            Algorithm::Safe,
            Algorithm::Wall,
        ];
        for (index, algorithm) in expected.iter().enumerate() {
            assert_eq!(Algorithm::from_index(index as u32), *algorithm);
        }
    }

    #[test]
    fn an_out_of_range_algorithm_index_falls_back_to_transparent() {
        assert_eq!(Algorithm::from_index(99), Algorithm::Transparent);
    }

    #[test]
    fn styles_resolve_onto_the_algorithms_they_simplify() {
        assert_eq!(Algorithm::from_style_index(0), Algorithm::Transparent);
        assert_eq!(Algorithm::from_style_index(1), Algorithm::Punchy);
        assert_eq!(Algorithm::from_style_index(2), Algorithm::Wall);
    }

    /// Every algorithm has to actually move the envelope, or the control is a
    /// label. Releases must all differ from the transparent baseline except
    /// where the table deliberately shares one.
    #[test]
    fn each_algorithm_carries_its_own_release() {
        let releases: Vec<f32> = (0..8)
            .map(|index| Algorithm::from_index(index).profile().release_ms)
            .collect();
        let mut sorted = releases.clone();
        sorted.sort_by(f32::total_cmp);
        sorted.dedup();

        assert_eq!(
            sorted.len(),
            releases.len(),
            "releases collided: {releases:?}"
        );
    }

    #[test]
    fn dither_indices_map_onto_the_shared_modes_and_bit_depths() {
        assert_eq!(DitherKind::from_index(0), DitherKind::Off);
        assert_eq!(DitherKind::from_index(1), DitherKind::Tpdf);
        assert_eq!(DitherKind::from_index(2), DitherKind::Tpdf);
        assert_eq!(DitherKind::from_index(5), DitherKind::NoiseShaped);
        assert_eq!(DitherKind::implied_bit_depth(1), Some(16));
        assert_eq!(DitherKind::implied_bit_depth(2), Some(24));
        assert_eq!(DitherKind::implied_bit_depth(4), None);
    }

    #[test]
    fn stereo_and_band_indices_match_the_panel_order() {
        assert!(StereoMode::from_index(0) == StereoMode::LeftRight);
        assert!(StereoMode::from_index(1) == StereoMode::MidSide);
        assert_eq!(band_count_from_index(0), 1);
        assert_eq!(band_count_from_index(1), 3);
        assert_eq!(band_count_from_index(2), 5);
    }
}
