//! The instrument class's voice, free of either format's vocabulary: one held
//! note that writes a constant stereo level.
//!
//! A note-on at sample `n` sets every output sample from `n` on to
//! `gain * velocity` (velocity normalised to 0..1, as both formats carry it)
//! and a note-off of the held key at sample `m` returns them to silence from
//! `m` on. There is no envelope, no latency and no tail, so a test reads the
//! notes straight off the printed samples: where a note lands is the first
//! sample that is not zero.
//!
//! One voice: a later note-on replaces the held key, and a note-off for any
//! other key is ignored.

use std::cell::Cell;

/// The key no note-on has named, or the key a note-off released.
const NO_KEY: i16 = -1;

/// The held note, shared by `&NoteVoice` alone and touched only by activation
/// while the instance is inactive and by processing while it is active — the
/// lifecycle exclusion [`crate::echo::Echo`] relies on.
pub(crate) struct NoteVoice {
    key: Cell<i16>,
    velocity: Cell<f32>,
}

impl NoteVoice {
    pub(crate) fn new() -> Self {
        Self {
            key: Cell::new(NO_KEY),
            velocity: Cell::new(0.0),
        }
    }

    /// Release whatever is held, as activation and a host reset require.
    pub(crate) fn reset(&self) {
        self.key.set(NO_KEY);
        self.velocity.set(0.0);
    }

    pub(crate) fn note_on(&self, key: i16, velocity: f32) {
        self.key.set(key);
        self.velocity.set(velocity);
    }

    pub(crate) fn note_off(&self, key: i16) {
        if self.key.get() == key {
            self.reset();
        }
    }

    /// The level of the next output sample, in both channels. Allocation- and
    /// lock-free.
    pub(crate) fn level(&self, gain: f32) -> f32 {
        gain * self.velocity.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_held_note_sounds_until_its_own_key_is_released() {
        let voice = NoteVoice::new();
        assert_eq!(voice.level(1.0), 0.0);

        voice.note_on(60, 0.5);
        assert_eq!(voice.level(0.5), 0.25);

        voice.note_off(61);
        assert_eq!(voice.level(0.5), 0.25, "another key's release is ignored");

        voice.note_off(60);
        assert_eq!(voice.level(0.5), 0.0);
    }

    #[test]
    fn a_later_note_replaces_the_held_one() {
        let voice = NoteVoice::new();
        voice.note_on(60, 0.5);
        voice.note_on(62, 1.0);

        voice.note_off(60);
        assert_eq!(voice.level(1.0), 1.0, "the replaced key no longer holds it");

        voice.note_off(62);
        assert_eq!(voice.level(1.0), 0.0);
    }
}
