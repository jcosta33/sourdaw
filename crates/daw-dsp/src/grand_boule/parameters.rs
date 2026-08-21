//! Physical parameter tables for the Grand Boule piano.
//!
//! Project-authored curves are key-indexed from A0 (`key = 1`) through C8
//! (`key = 88`).
//!
//! Every helper here is a pure function, allocation-free and panic-free over
//! the valid key range.

/// Lowest piano key (A0) in MIDI note numbers.
pub const MIDI_A0: u8 = 21;

/// Highest piano key (C8) in MIDI note numbers.
pub const MIDI_C8: u8 = 108;

/// Number of keys on a standard grand piano.
pub const NUM_KEYS: usize = 88;

/// Reference tuning frequency for A4 (MIDI 69, key 49).
pub const A4_HZ: f32 = 440.0;

/// Historical temperament index. Used to select a tuning system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Temperament {
    Equal = 0,
    WerckmeisterIII = 1,
    KirnbergerIII = 2,
    Vallotti = 3,
    YoungII = 4,
    MeantoneQuarterComma = 5,
}

impl Temperament {
    /// Parse from an integer (used by set_param / WASM). Unknown values
    /// return `Equal`.
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::WerckmeisterIII,
            2 => Self::KirnbergerIII,
            3 => Self::Vallotti,
            4 => Self::YoungII,
            5 => Self::MeantoneQuarterComma,
            _ => Self::Equal,
        }
    }
}

/// Historical temperament cent offsets relative to A = 0.
/// Indexed by pitch class: [C, C#, D, D#, E, F, F#, G, G#, A, A#, B].
const WERCKMEISTER_III: [f32; 12] = [11.7, 2.0, 3.9, 5.9, 2.0, 9.8, 0.0, 7.8, 3.9, 0.0, 7.8, 3.9];
const KIRNBERGER_III: [f32; 12] = [
    10.3, 0.5, 3.4, 4.4, -3.4, 8.3, 0.5, 6.8, 2.4, 0.0, 6.4, -1.5,
];
const VALLOTTI: [f32; 12] = [
    5.9, 0.0, 2.0, 3.9, -2.0, 7.8, -2.0, 3.9, 2.0, 0.0, 5.9, -3.9,
];
const YOUNG_II: [f32; 12] = [
    5.9, -3.9, 2.0, 0.0, -2.0, 3.9, -5.9, 3.9, -2.0, 0.0, 2.0, -3.9,
];
const MEANTONE_QUARTER_COMMA: [f32; 12] = [
    10.3, -13.7, 3.4, 20.5, -3.4, 13.7, -10.3, 6.8, -17.1, 0.0, 17.1, -6.8,
];

/// Get the temperament cent offset for a given MIDI note. Returns 0.0 for
/// equal temperament.
pub fn temperament_offset_cents(temperament: Temperament, midi_note: u8) -> f32 {
    let table = match temperament {
        Temperament::Equal => return 0.0,
        Temperament::WerckmeisterIII => &WERCKMEISTER_III,
        Temperament::KirnbergerIII => &KIRNBERGER_III,
        Temperament::Vallotti => &VALLOTTI,
        Temperament::YoungII => &YOUNG_II,
        Temperament::MeantoneQuarterComma => &MEANTONE_QUARTER_COMMA,
    };
    let pitch_class = (midi_note % 12) as usize;
    table[pitch_class]
}

/// Convert a MIDI note number to a 1-indexed piano key (A0 = 1 .. C8 = 88).
/// Returns `None` if the note lies outside the piano range.
pub fn midi_to_key(midi_note: u8) -> Option<u32> {
    if midi_note < MIDI_A0 || midi_note > MIDI_C8 {
        return None;
    }
    Some((midi_note - MIDI_A0) as u32 + 1)
}

/// Twelve-tone equal-tempered frequency for a MIDI note (no Railsback applied).
pub fn midi_to_hz_equal_tempered(midi_note: u8) -> f32 {
    let semitones = midi_note as f32 - 69.0;
    A4_HZ * (2.0_f32).powf(semitones / 12.0)
}

/// Project hammer-stiffness curve:
/// `log10(K(key)) ≈ 8.0 + 0.020·(key-1)`.
///
/// Ranges from ~10⁸ in the bass to ~5.5×10⁹ in the treble.
pub fn hammer_stiffness_k(key: u32) -> f32 {
    let exponent = 8.0_f32 + 0.020 * (key as f32 - 1.0);
    (10.0_f32).powf(exponent)
}

/// Project hammer-felt exponent curve: `p(key) = 2.0 + 0.017·(key-1)`.
pub fn hammer_exponent_p(key: u32) -> f32 {
    2.0 + 0.017 * (key as f32 - 1.0)
}

/// Project hammer-mass curve: `m_H(key) = 11.0·exp(-0.0134·(key-1))` grams.
pub fn hammer_mass_kg(key: u32) -> f32 {
    let grams = 11.0_f32 * (-0.0134 * (key as f32 - 1.0)).exp();
    grams * 1.0e-3
}

/// Inharmonicity coefficient `B` interpolated log-linearly between three
/// project constants: A0=0.0002, C4=0.0007, and C8=0.10.
pub fn inharmonicity_b(key: u32) -> f32 {
    // Anchors: (key, B)
    const ANCHORS: [(f32, f32); 3] = [(1.0, 0.0002), (40.0, 0.0007), (88.0, 0.10)];
    let k = key as f32;
    // Log-linear interpolation.
    let interpolate = |k0: f32, b0: f32, k1: f32, b1: f32| -> f32 {
        let t = (k - k0) / (k1 - k0);
        let log_b = b0.ln() + t * (b1.ln() - b0.ln());
        log_b.exp()
    };
    if k <= ANCHORS[1].0 {
        interpolate(ANCHORS[0].0, ANCHORS[0].1, ANCHORS[1].0, ANCHORS[1].1)
    } else {
        interpolate(ANCHORS[1].0, ANCHORS[1].1, ANCHORS[2].0, ANCHORS[2].1)
    }
}

/// Smooth Railsback stretch curve, in cents, relative to equal temperament.
///
/// Anchors are taken from Jaatinen & Pätynen (2022, JASA 152(2):1146,
/// DOI: 10.1121/10.0013572) measurements of a Steinway D 274 cm: bass extreme
/// −19 cents, treble extreme +45 cents (≈ 64 cent total stretch). The curve
/// passes through 0 at A4 (key 49) and is interpolated piecewise-linearly
/// between intermediate anchors so it stays smooth across the wound/plain
/// transition. Per-note ±1–3 cent fluctuations are added on top via
/// [`railsback_jitter_cents`] (Hinrichsen 2012, arXiv:1203.5101).
pub fn railsback_smooth_cents(key: u32) -> f32 {
    // Anchors fitted to the Jaatinen/Pätynen Steinway D curve.
    const ANCHORS: [(f32, f32); 5] = [
        (1.0, -19.0),
        (16.0, -8.0),
        (40.0, -0.5),
        (49.0, 0.0),
        (88.0, 45.0),
    ];
    let k = key as f32;
    let mut lo = ANCHORS[0];
    let mut hi = ANCHORS[ANCHORS.len() - 1];
    for pair in ANCHORS.windows(2) {
        if k >= pair[0].0 && k <= pair[1].0 {
            lo = pair[0];
            hi = pair[1];
            break;
        }
    }
    let t = ((k - lo.0) / (hi.0 - lo.0)).clamp(0.0, 1.0);
    lo.1 + t * (hi.1 - lo.1)
}

/// Note-to-note tuning fluctuations (±1–3 cents) on top of the smooth
/// Railsback curve. Hinrichsen (2012) shows these are not measurement
/// noise — they reflect individual string irregularities and partial-
/// intensity variations and are essential for the "alive" character of
/// a real instrument.
///
/// The values are produced by a deterministic LCG seeded per key and
/// then low-pass filtered across keys to give a correlation length of
/// roughly 3–5 semitones, matching the spatial smoothness Hinrichsen
/// observed. Returned in cents.
pub fn railsback_jitter_cents(key: u32) -> f32 {
    // Deterministic smoothed jitter computed on-the-fly. Called only from
    // `note_on` (never on the audio thread); ~88 LCG samples + a 5-tap
    // smoother per call is negligible. No allocations, no statics.
    fn smoothed_at(index: usize, raw: &[f32; NUM_KEYS]) -> f32 {
        let lo2 = raw[index.saturating_sub(2)];
        let lo1 = raw[index.saturating_sub(1)];
        let mid = raw[index];
        let hi1 = raw[(index + 1).min(NUM_KEYS - 1)];
        let hi2 = raw[(index + 2).min(NUM_KEYS - 1)];
        // Symmetric 5-tap [1 4 6 4 1]/16 — correlation length ≈ 5 semitones,
        // matching Hinrichsen's (2012) measured spatial smoothness.
        (lo2 + 4.0 * lo1 + 6.0 * mid + 4.0 * hi1 + hi2) / 16.0
    }

    let mut state: u32 = 0xC0FF_EE00;
    let mut raw = [0.0_f32; NUM_KEYS];
    for slot in raw.iter_mut() {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let r = (state >> 8) as f32 / (1u32 << 24) as f32;
        *slot = 2.0 * r - 1.0;
    }

    // A4 (key 49, index 48) is the tuning anchor and must remain exact.
    // Subtract its smoothed jitter from every read so the offset there is
    // identically zero.
    let anchor = smoothed_at(48, &raw);
    let index = (key as usize).saturating_sub(1).min(NUM_KEYS - 1);
    let smoothed = smoothed_at(index, &raw) - anchor;

    // Bass slightly larger than treble — wound/plain transition concentrates
    // irregularities low. Final scale: ≈ ±2 cents typical.
    let bass_emphasis = 1.0 + 0.5 * (1.0 - index as f32 / NUM_KEYS as f32);
    smoothed * 2.0 * bass_emphasis
}

/// Total Railsback offset (smooth curve + per-note jitter). Use this when
/// you want the final tuning offset for a key.
pub fn railsback_cents(key: u32) -> f32 {
    railsback_smooth_cents(key) + railsback_jitter_cents(key)
}

/// Hammer strike position as a fraction of string length.
/// Bass (~1/7) → middle (~1/8) → treble (~1/12).
pub fn hammer_strike_ratio(key: u32) -> f32 {
    // Piecewise linear: bass (key 1) ≈ 1/7, middle (key 40) ≈ 1/8, treble (key 88) ≈ 1/12.
    let k = key as f32;
    let bass_end = 1.0_f32;
    let bass_pos = 1.0_f32 / 7.0;
    let mid_key = 40.0_f32;
    let mid_pos = 1.0_f32 / 8.0;
    let treble_end = 88.0_f32;
    let treble_pos = 1.0_f32 / 12.0;
    if k <= mid_key {
        let t = (k - bass_end) / (mid_key - bass_end);
        bass_pos + t * (mid_pos - bass_pos)
    } else {
        let t = (k - mid_key) / (treble_end - mid_key);
        mid_pos + t * (treble_pos - mid_pos)
    }
}

/// Fundamental frequency of a key with Railsback stretched tuning applied.
pub fn key_fundamental_hz(key: u32) -> f32 {
    debug_assert!(key >= 1 && key as usize <= NUM_KEYS);
    let midi_note = (key as u8 - 1) + MIDI_A0;
    let equal = midi_to_hz_equal_tempered(midi_note);
    let cents = railsback_cents(key);
    equal * (2.0_f32).powf(cents / 1200.0)
}

/// Number of unison strings for a given key.
/// Standard piano construction: lowest ~8 notes are single-wound, next ~8
/// double-wound, and the rest (B2 upward) are trichord.
pub fn unison_count(key: u32) -> u32 {
    if key <= 8 {
        1
    } else if key <= 16 {
        2
    } else {
        3
    }
}

/// Per-unison detuning in cents, offset from the fundamental.
/// Returns zero for the first unison, and small symmetric offsets for the
/// remaining strings. The detuning spreads with pitch (bass: ~0.5c, treble: ~2c).
pub fn unison_detune_cents(key: u32, unison_index: u32) -> f32 {
    let count = unison_count(key);
    if unison_index >= count || count == 1 {
        return 0.0;
    }
    // Spread scales from 0.5 cents (bass) to 2 cents (treble).
    let spread = 0.5 + 1.5 * ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    match (count, unison_index) {
        (2, 0) => -spread * 0.5,
        (2, 1) => spread * 0.5,
        (3, 0) => -spread,
        (3, 1) => 0.0,
        (3, 2) => spread,
        _ => 0.0,
    }
}

/// Whether a key has a damper.
/// Notes above C7 (key 76) have no dampers.
pub fn has_damper(key: u32) -> bool {
    key <= 76
}

/// Whether a key has phantom longitudinal modes.
/// Enabled below C5 (key 52).
pub fn has_longitudinal_modes(key: u32) -> bool {
    key < 52
}

/// Whether a key has duplex-scale resonance.
/// Enabled from C4 upward.
pub fn has_duplex_resonance(key: u32) -> bool {
    key >= 40
}

/// Approximate damper coefficient at full pedal-up (key held) position.
/// Scales inversely with the square root of the key index.
pub fn damper_strength(key: u32) -> f32 {
    let base = 80.0_f32;
    base / (key as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_mapping_covers_piano_range() {
        assert_eq!(midi_to_key(MIDI_A0), Some(1));
        assert_eq!(midi_to_key(MIDI_C8), Some(88));
        assert_eq!(midi_to_key(60), Some(40)); // Middle C
        assert_eq!(midi_to_key(20), None);
        assert_eq!(midi_to_key(109), None);
    }

    #[test]
    fn a4_is_440_with_railsback() {
        let hz = key_fundamental_hz(49);
        assert!((hz - 440.0).abs() < 0.05);
    }

    #[test]
    fn inharmonicity_monotonic() {
        let lo = inharmonicity_b(1);
        let mid = inharmonicity_b(40);
        let hi = inharmonicity_b(88);
        assert!(lo < mid);
        assert!(mid < hi);
    }

    #[test]
    fn hammer_mass_decreases_with_pitch() {
        assert!(hammer_mass_kg(1) > hammer_mass_kg(88));
    }

    #[test]
    fn equal_temperament_has_zero_offsets() {
        for midi in 21..=108 {
            assert_eq!(temperament_offset_cents(Temperament::Equal, midi), 0.0);
        }
    }

    #[test]
    fn werckmeister_a_is_zero() {
        // A is pitch class 9. MIDI 69 = A4.
        assert_eq!(
            temperament_offset_cents(Temperament::WerckmeisterIII, 69),
            0.0
        );
    }

    #[test]
    fn meantone_has_large_offsets() {
        // D# should be +20.5 cents in meantone.
        let offset = temperament_offset_cents(Temperament::MeantoneQuarterComma, 63); // D#4
        assert!((offset - 20.5).abs() < 0.01);
    }

    #[test]
    fn temperament_from_u8_roundtrips() {
        assert_eq!(Temperament::from_u8(0), Temperament::Equal);
        assert_eq!(Temperament::from_u8(1), Temperament::WerckmeisterIII);
        assert_eq!(Temperament::from_u8(5), Temperament::MeantoneQuarterComma);
        assert_eq!(Temperament::from_u8(99), Temperament::Equal);
    }
}
