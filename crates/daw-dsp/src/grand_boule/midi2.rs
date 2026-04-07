//! MIDI 2.0 UMP + microtuning support (§2.3).
//!
//! Parses a subset of 32-bit and 64-bit Universal MIDI Packets sufficient to
//! drive the Grand Boule engine from a MIDI 2.0 source:
//!
//! * **MIDI 1.0 channel voice** (message type `0x2`, 32-bit UMP) — fallback
//!   for legacy controllers.
//! * **MIDI 2.0 channel voice** (message type `0x4`, 64-bit UMP) — 16-bit
//!   velocity, per-note attribute data, per-note pitch.
//!
//! Velocity is returned at the full MIDI 2.0 resolution (16 bits → 65536
//! levels). Microtuning is expressed in `signed 32-bit cents × 2^-24`, i.e.
//! >1/512 semitone resolution as required by the spec.

/// A parsed MIDI 2.0 voice event. Everything downstream the engine needs is
/// surfaced here — the engine never parses UMPs directly.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Midi2Event {
    /// Note-on. `velocity` is 16-bit unsigned (0 = note-off), `pitch_offset`
    /// is a signed microtuning offset in semitones × 2^24.
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u16,
        pitch_offset_q24: i32,
    },
    /// Note-off with a 16-bit release velocity.
    NoteOff {
        channel: u8,
        note: u8,
        velocity: u16,
    },
    /// MIDI CC (7-bit legacy or 32-bit MIDI 2.0). 32-bit value is passed
    /// through; translation to normalised [0, 1] happens at the sink.
    ControlChange {
        channel: u8,
        controller: u8,
        value: u32,
    },
    /// Per-note pitch bend. `semitones` is a signed value in semitones
    /// × 2^24; full range is ±128 semitones.
    PerNotePitch {
        channel: u8,
        note: u8,
        semitones_q24: i32,
    },
    /// A UMP that we do not care about (SysEx, clock, etc.).
    Ignored,
}

/// Parse a 32-bit UMP (legacy MIDI 1.0 channel voice).
/// Returns [`Midi2Event::Ignored`] for packets we do not implement.
pub fn parse_ump32(word0: u32) -> Midi2Event {
    let message_type = (word0 >> 28) & 0xF;
    if message_type != 0x2 {
        return Midi2Event::Ignored;
    }
    let status = ((word0 >> 16) & 0xFF) as u8;
    let opcode = status & 0xF0;
    let channel = status & 0x0F;
    let data1 = ((word0 >> 8) & 0xFF) as u8;
    let data2 = (word0 & 0xFF) as u8;
    match opcode {
        0x80 => Midi2Event::NoteOff {
            channel,
            note: data1 & 0x7F,
            velocity: ((data2 & 0x7F) as u16) << 9,
        },
        0x90 => {
            let v7 = data2 & 0x7F;
            if v7 == 0 {
                Midi2Event::NoteOff {
                    channel,
                    note: data1 & 0x7F,
                    velocity: 0,
                }
            } else {
                Midi2Event::NoteOn {
                    channel,
                    note: data1 & 0x7F,
                    velocity: (v7 as u16) << 9,
                    pitch_offset_q24: 0,
                }
            }
        }
        0xB0 => Midi2Event::ControlChange {
            channel,
            controller: data1 & 0x7F,
            value: ((data2 & 0x7F) as u32) << 25,
        },
        _ => Midi2Event::Ignored,
    }
}

/// Parse a 64-bit MIDI 2.0 channel voice UMP.
/// `word0` is the header word, `word1` the data word.
pub fn parse_ump64(word0: u32, word1: u32) -> Midi2Event {
    let message_type = (word0 >> 28) & 0xF;
    if message_type != 0x4 {
        return Midi2Event::Ignored;
    }
    let status = ((word0 >> 16) & 0xFF) as u8;
    let opcode = status & 0xF0;
    let channel = status & 0x0F;
    let note = ((word0 >> 8) & 0x7F) as u8;
    let attribute_type = (word0 & 0xFF) as u8;
    let value16_high = ((word1 >> 16) & 0xFFFF) as u16;
    let attribute_data = (word1 & 0xFFFF) as u16;

    match opcode {
        0x80 => Midi2Event::NoteOff {
            channel,
            note,
            velocity: value16_high,
        },
        0x90 => {
            // Attribute type 0x03 = pitch 7.9 (7 bits note + 9 bits cents /
            // 512). We expand it to Q24 semitones: whole semitones are the
            // difference between the attribute note and the base note.
            let pitch_offset_q24 = if attribute_type == 0x03 {
                attribute_pitch_to_q24(note, attribute_data)
            } else {
                0
            };
            Midi2Event::NoteOn {
                channel,
                note,
                velocity: value16_high,
                pitch_offset_q24,
            }
        }
        0x60 => {
            // Per-note pitch bend (MIDI 2.0 opcode 0x6X). The whole 32-bit
            // word1 is a normalised value, centre = 0x8000_0000. Full range
            // is ±128 semitones.
            let signed = (word1 as i64) - 0x8000_0000;
            let semitones_q24 = ((signed * 128) >> 7) as i32;
            Midi2Event::PerNotePitch {
                channel,
                note,
                semitones_q24,
            }
        }
        0xB0 => Midi2Event::ControlChange {
            channel,
            controller: (word0 & 0x7F) as u8,
            value: word1,
        },
        _ => Midi2Event::Ignored,
    }
}

/// Convert a MIDI 2.0 7.9 pitch attribute into Q24 semitones relative to
/// the event's note number.
fn attribute_pitch_to_q24(base_note: u8, attribute_data: u16) -> i32 {
    // Attribute format: high 7 bits = note number, low 9 bits = 1/512ths of
    // a semitone.
    let note = ((attribute_data >> 9) & 0x7F) as i32;
    let fraction_512 = (attribute_data & 0x1FF) as i32;
    let whole_semitones = note - base_note as i32;
    let whole_q24 = whole_semitones << 24;
    let fraction_q24 = (fraction_512 << 24) / 512;
    whole_q24 + fraction_q24
}

/// Convert a 16-bit MIDI 2.0 velocity to a normalised `[0, 1]` float at
/// full 16-bit resolution.
pub fn velocity_to_unit(velocity: u16) -> f32 {
    velocity as f32 / 65_535.0
}

/// Convert a Q24 semitone offset into a linear frequency ratio.
/// `semitones_q24` is signed 32-bit: `value / (1 << 24)` semitones.
pub fn pitch_offset_to_ratio(semitones_q24: i32) -> f32 {
    let semitones = semitones_q24 as f32 / (1 << 24) as f32;
    (2.0_f32).powf(semitones / 12.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_midi1_note_on() {
        // Message type 2, channel 0, note on, C4 (60), vel 100.
        let word = 0x2090_3C64;
        match parse_ump32(word) {
            Midi2Event::NoteOn {
                channel,
                note,
                velocity,
                pitch_offset_q24,
            } => {
                assert_eq!(channel, 0);
                assert_eq!(note, 60);
                assert!(velocity > 0);
                assert_eq!(pitch_offset_q24, 0);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn parses_midi1_note_off_from_velocity_zero() {
        // Note on with velocity 0 must become note-off per MIDI spec.
        let word = 0x2090_3C00;
        match parse_ump32(word) {
            Midi2Event::NoteOff { note, velocity, .. } => {
                assert_eq!(note, 60);
                assert_eq!(velocity, 0);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn parses_midi2_note_on_with_full_velocity() {
        // Message type 4, note-on op 0x90, note 69, vel 0xFFFF in high bits.
        let word0 = 0x4090_4500;
        let word1 = 0xFFFF_0000;
        match parse_ump64(word0, word1) {
            Midi2Event::NoteOn { note, velocity, .. } => {
                assert_eq!(note, 69);
                assert_eq!(velocity, 0xFFFF);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn per_note_pitch_is_signed_and_centered() {
        // Centre (0x8000_0000) should parse as zero offset.
        let centre = parse_ump64(0x4060_4500, 0x8000_0000);
        match centre {
            Midi2Event::PerNotePitch { semitones_q24, .. } => {
                assert_eq!(semitones_q24, 0);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn pitch_ratio_round_trips() {
        // +12 semitones (Q24) = octave up.
        let q24 = 12 << 24;
        let ratio = pitch_offset_to_ratio(q24);
        assert!((ratio - 2.0).abs() < 1.0e-4);
        // -12 semitones = octave down.
        let ratio = pitch_offset_to_ratio(-(12 << 24));
        assert!((ratio - 0.5).abs() < 1.0e-4);
    }

    #[test]
    fn velocity_unit_is_full_range() {
        assert_eq!(velocity_to_unit(0), 0.0);
        assert!((velocity_to_unit(0xFFFF) - 1.0).abs() < 1.0e-6);
    }

    #[test]
    fn microtuning_precision_is_at_least_1_over_512() {
        // 1/512 semitone in Q24.
        let one_over_512 = (1 << 24) / 512;
        let ratio_a = pitch_offset_to_ratio(0);
        let ratio_b = pitch_offset_to_ratio(one_over_512);
        assert!(ratio_b > ratio_a);
    }
}
