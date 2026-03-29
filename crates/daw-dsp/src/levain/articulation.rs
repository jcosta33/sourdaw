//! Articulation state machine.
//!
//! Supports four switching methods simultaneously:
//! 1. Keyswitching — dedicated MIDI notes below playable range
//! 2. Articulation IDs — metadata per note-on (Logic Pro approach)
//! 3. Velocity-based — different velocity ranges trigger different articulations
//! 4. CC-based — a dedicated CC selects articulation by value range
//!
//! The state machine is deterministic and runs on the audio thread.

use crate::types::*;

// ---------------------------------------------------------------------------
// Keyswitch configuration
// ---------------------------------------------------------------------------

/// A single keyswitch mapping.
#[derive(Debug, Clone, Copy)]
pub struct KeyswitchEntry {
    pub note: u8,
    pub articulation: ArticulationId,
    /// If true, reverts when key is released (momentary). Otherwise latching.
    pub momentary: bool,
}

/// Velocity split point for velocity-based articulation switching.
#[derive(Debug, Clone, Copy)]
pub struct VelocitySplit {
    pub vel_lo: u8,
    pub vel_hi: u8,
    pub articulation: ArticulationId,
}

/// CC value range for CC-based articulation switching.
#[derive(Debug, Clone, Copy)]
pub struct CcSplit {
    pub cc_lo: u8,
    pub cc_hi: u8,
    pub articulation: ArticulationId,
}

// ---------------------------------------------------------------------------
// Articulation map
// ---------------------------------------------------------------------------

/// Maximum keyswitches, velocity splits, and CC splits.
const MAX_KEYSWITCHES: usize = 32;
const MAX_VEL_SPLITS: usize = 8;
const MAX_CC_SPLITS: usize = 16;

/// The complete articulation switching configuration for an instrument.
pub struct ArticulationMap {
    /// Keyswitch entries.
    keyswitches: [KeyswitchEntry; MAX_KEYSWITCHES],
    keyswitch_count: usize,

    /// Velocity-based splits.
    vel_splits: [VelocitySplit; MAX_VEL_SPLITS],
    vel_split_count: usize,

    /// CC-based splits (default CC32, configurable).
    cc_splits: [CcSplit; MAX_CC_SPLITS],
    cc_split_count: usize,
    /// Which CC number triggers articulation switching.
    pub switch_cc: u8,

    /// Articulation ID map: articulation_id -> internal index.
    /// For Logic Pro-style per-note articulation IDs.
    artid_map: [ArticulationId; 128],

    /// The lowest keyswitch note (for range detection).
    pub keyswitch_range_lo: u8,
    pub keyswitch_range_hi: u8,
}

impl ArticulationMap {
    pub fn new() -> Self {
        let default_ks = KeyswitchEntry {
            note: 0,
            articulation: 0,
            momentary: false,
        };
        let default_vs = VelocitySplit {
            vel_lo: 0,
            vel_hi: 127,
            articulation: 0,
        };
        let default_cc = CcSplit {
            cc_lo: 0,
            cc_hi: 127,
            articulation: 0,
        };

        let mut artid_map = [0u16; 128];
        for i in 0..128 {
            artid_map[i] = i as u16;
        }

        Self {
            keyswitches: [default_ks; MAX_KEYSWITCHES],
            keyswitch_count: 0,
            vel_splits: [default_vs; MAX_VEL_SPLITS],
            vel_split_count: 0,
            cc_splits: [default_cc; MAX_CC_SPLITS],
            cc_split_count: 0,
            switch_cc: 32, // Default articulation CC
            artid_map,
            keyswitch_range_lo: 0,
            keyswitch_range_hi: 0,
        }
    }

    pub fn add_keyswitch(&mut self, note: u8, articulation: ArticulationId, momentary: bool) {
        if self.keyswitch_count >= MAX_KEYSWITCHES {
            return;
        }
        self.keyswitches[self.keyswitch_count] = KeyswitchEntry {
            note,
            articulation,
            momentary,
        };
        self.keyswitch_count += 1;

        // Update range.
        if self.keyswitch_count == 1 {
            self.keyswitch_range_lo = note;
            self.keyswitch_range_hi = note;
        } else {
            self.keyswitch_range_lo = self.keyswitch_range_lo.min(note);
            self.keyswitch_range_hi = self.keyswitch_range_hi.max(note);
        }
    }

    pub fn add_velocity_split(&mut self, vel_lo: u8, vel_hi: u8, articulation: ArticulationId) {
        if self.vel_split_count >= MAX_VEL_SPLITS {
            return;
        }
        self.vel_splits[self.vel_split_count] = VelocitySplit {
            vel_lo,
            vel_hi,
            articulation,
        };
        self.vel_split_count += 1;
    }

    pub fn add_cc_split(&mut self, cc_lo: u8, cc_hi: u8, articulation: ArticulationId) {
        if self.cc_split_count >= MAX_CC_SPLITS {
            return;
        }
        self.cc_splits[self.cc_split_count] = CcSplit {
            cc_lo,
            cc_hi,
            articulation,
        };
        self.cc_split_count += 1;
    }

    /// Check if a note is in the keyswitch range.
    pub fn is_keyswitch(&self, note: u8) -> bool {
        self.keyswitch_count > 0
            && note >= self.keyswitch_range_lo
            && note <= self.keyswitch_range_hi
    }

    /// Find articulation for a keyswitch note.
    pub fn find_keyswitch(&self, note: u8) -> Option<(ArticulationId, bool)> {
        for i in 0..self.keyswitch_count {
            if self.keyswitches[i].note == note {
                return Some((self.keyswitches[i].articulation, self.keyswitches[i].momentary));
            }
        }
        None
    }

    /// Find articulation for a velocity value.
    pub fn find_velocity_split(&self, velocity: u8) -> Option<ArticulationId> {
        for i in 0..self.vel_split_count {
            let split = &self.vel_splits[i];
            if velocity >= split.vel_lo && velocity <= split.vel_hi {
                return Some(split.articulation);
            }
        }
        None
    }

    /// Find articulation for a CC value.
    pub fn find_cc_split(&self, value: u8) -> Option<ArticulationId> {
        for i in 0..self.cc_split_count {
            let split = &self.cc_splits[i];
            if value >= split.cc_lo && value <= split.cc_hi {
                return Some(split.articulation);
            }
        }
        None
    }

    /// Map an articulation ID to internal index.
    pub fn map_artid(&self, artid: u8) -> ArticulationId {
        self.artid_map[artid as usize]
    }
}

// ---------------------------------------------------------------------------
// Articulation state machine
// ---------------------------------------------------------------------------

pub struct ArticulationState {
    /// Currently active articulation.
    pub current: ArticulationId,
    /// Previous articulation (for momentary revert).
    previous: ArticulationId,
    /// Whether a momentary keyswitch is held.
    momentary_held: bool,
    /// Current CC value for the switch CC.
    switch_cc_value: u8,
    /// The articulation map (switching configuration).
    pub map: ArticulationMap,
}

impl ArticulationState {
    pub fn new() -> Self {
        Self {
            current: 0,
            previous: 0,
            momentary_held: false,
            switch_cc_value: 0,
            map: ArticulationMap::new(),
        }
    }

    /// Handle a note-on event. Returns true if the note is a keyswitch
    /// (should NOT be passed to the voice allocator).
    pub fn handle_note_on(&mut self, note: u8, velocity: u8) -> bool {
        // Check keyswitch.
        if self.map.is_keyswitch(note) {
            if let Some((art, momentary)) = self.map.find_keyswitch(note) {
                if momentary {
                    self.previous = self.current;
                    self.momentary_held = true;
                }
                self.current = art;
                return true;
            }
        }

        // Check velocity split (only if velocity splits are configured).
        if let Some(art) = self.map.find_velocity_split(velocity) {
            self.current = art;
        }

        false
    }

    /// Handle a note-off event. Returns true if it was a keyswitch release.
    pub fn handle_note_off(&mut self, note: u8) -> bool {
        if self.momentary_held && self.map.is_keyswitch(note) {
            if let Some((_, true)) = self.map.find_keyswitch(note) {
                self.current = self.previous;
                self.momentary_held = false;
                return true;
            }
        }
        false
    }

    /// Handle a CC message that might switch articulations.
    pub fn handle_cc(&mut self, cc: u8, value: u8) {
        if cc == self.map.switch_cc {
            self.switch_cc_value = value;
            if let Some(art) = self.map.find_cc_split(value) {
                self.current = art;
            }
        }
    }

    /// Set articulation directly (from articulation ID metadata on note).
    pub fn set_articulation_id(&mut self, artid: u8) {
        self.current = self.map.map_artid(artid);
    }
}
