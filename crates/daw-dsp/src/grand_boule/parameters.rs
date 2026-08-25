//! Project tuning curves and standard piano mappings for Grand Boule.
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

/// Project-authored hammer-stiffness curve. It rises non-linearly through the
/// keyboard rather than retaining the legacy measured-data fit.
pub fn hammer_stiffness_k(key: u32) -> f32 {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    let exponent = 7.86_f32 + 1.88 * t.powf(1.32) + 0.14 * t * (1.0 - t);
    (10.0_f32).powf(exponent)
}

/// Project hammer-felt exponent curve. This is a product voicing, not a
/// measured instrument data series.
pub fn hammer_exponent_p(key: u32) -> f32 {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    2.28 + 1.12 * t.powf(1.18) + 0.10 * t * (1.0 - t)
}

/// Project hammer-mass curve in kilograms. This is a product voicing, not a
/// measured instrument data series.
pub fn hammer_mass_kg(key: u32) -> f32 {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    let grams = 3.6 + 7.8 * (1.0 - t).powf(1.22);
    grams * 1.0e-3
}

/// Monotonic project voicing for the dimensionless inharmonicity coefficient
/// `B`. It is independently shaped rather than sampled from an instrument.
pub fn inharmonicity_b(key: u32) -> f32 {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    0.00018 * (6.0 * t.powf(1.55)).exp()
}

/// Smooth project-authored Railsback-style stretch in cents relative to equal
/// temperament. A4 remains the zero anchor; the bass and treble use separate
/// curves chosen for this instrument's product voicing.
pub fn railsback_smooth_cents(key: u32) -> f32 {
    let clamped = key.clamp(1, NUM_KEYS as u32) as f32;
    if clamped <= 49.0 {
        let t = (49.0 - clamped) / 48.0;
        -(14.0 * t.powf(1.35) + 3.0 * t * t * t)
    } else {
        let t = (clamped - 49.0) / 39.0;
        32.0 * t.powf(1.5) + 7.0 * t * t * t
    }
}

/// Deterministic project tuning variation on top of the smooth stretch curve.
/// Adjacent keys share a small three-key blend and A4 remains exact.
pub fn railsback_jitter_cents(key: u32) -> f32 {
    fn raw_at(index: usize) -> f32 {
        let mut value = (index as u32).wrapping_add(0x6D2B_79F5);
        value ^= value >> 15;
        value = value.wrapping_mul(0x2C1B_3C6D);
        value ^= value >> 12;
        value = value.wrapping_mul(0x297A_2D39);
        value ^= value >> 15;
        value as f32 / u32::MAX as f32 * 2.0 - 1.0
    }

    fn blended_at(index: usize) -> f32 {
        let previous = raw_at(index.saturating_sub(1));
        let current = raw_at(index);
        let next = raw_at((index + 1).min(NUM_KEYS - 1));
        previous * 0.22 + current * 0.56 + next * 0.22
    }

    let index = (key as usize).saturating_sub(1).min(NUM_KEYS - 1);
    let anchored = blended_at(index) - blended_at(48);
    let register_scale = 1.45 - 0.35 * (index as f32 / (NUM_KEYS - 1) as f32);
    anchored * register_scale
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
    fn project_hammer_stiffness_curve_is_non_linear_and_pinned() {
        let bass = hammer_stiffness_k(1);
        let middle = hammer_stiffness_k(49);
        let treble = hammer_stiffness_k(88);

        assert!((bass - 72_443_600.0).abs() < 64.0);
        assert!((middle - 565_092_000.0).abs() < 1_024.0);
        assert!((treble - 5_495_409_000.0).abs() < 16_384.0);
        assert!(middle / bass < treble / middle);
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
