//! Legato engine — true legato, adaptive speed, polyphonic divisi, synthetic fallback.
//!
//! Best-in-class legato detection: if a new note-on occurs while a previous
//! note is held (overlap) and the time between ons is below a threshold,
//! choose legato behavior. Adaptive timing follows CSS-inspired approach:
//! slow (>300ms) → full transition, medium (100-300ms) → standard,
//! fast (<100ms) → abbreviated.

use super::types::*;

// ---------------------------------------------------------------------------
// Legato configuration
// ---------------------------------------------------------------------------

/// Speed thresholds for adaptive legato (in seconds).
const SLOW_LEGATO_THRESHOLD: f32 = 0.3;
const FAST_LEGATO_THRESHOLD: f32 = 0.1;

/// Default crossfade times (seconds).
const SLOW_CROSSFADE_IN: f32 = 0.06;
const SLOW_CROSSFADE_OUT: f32 = 0.15;
const MEDIUM_CROSSFADE_IN: f32 = 0.04;
const MEDIUM_CROSSFADE_OUT: f32 = 0.08;
const FAST_CROSSFADE_IN: f32 = 0.02;
const FAST_CROSSFADE_OUT: f32 = 0.04;

/// Velocity threshold below which portamento is triggered instead of slurred.
const PORTAMENTO_VELOCITY_THRESHOLD: u8 = 64;

// ---------------------------------------------------------------------------
// Held note tracking
// ---------------------------------------------------------------------------

/// Maximum simultaneously held notes for divisi tracking.
const MAX_HELD_NOTES: usize = 16;

/// Tracks a currently held note for polyphonic legato.
#[derive(Debug, Clone, Copy)]
pub struct HeldNote {
    pub note: u8,
    pub voice_index: usize,
    pub active: bool,
    /// Time this note was triggered (sample count from engine start).
    pub trigger_time: u64,
}

impl Default for HeldNote {
    fn default() -> Self {
        Self {
            note: 0,
            voice_index: 0,
            active: false,
            trigger_time: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// Legato transition store
// ---------------------------------------------------------------------------

/// Maximum stored legato transitions.
const MAX_TRANSITIONS: usize = 1024;

/// Stores available legato transition samples for lookup.
pub struct LegatoTransitionStore {
    transitions: Vec<LegatoTransition>,
}

impl LegatoTransitionStore {
    pub fn new() -> Self {
        Self {
            transitions: Vec::new(),
        }
    }

    /// Add a transition sample reference. Loading-time only (called from bank
    /// loading, never the audio thread), but still bounded at
    /// `MAX_TRANSITIONS` so a malformed bank can't grow this without limit.
    pub fn add(&mut self, transition: LegatoTransition) {
        if self.transitions.len() < MAX_TRANSITIONS {
            self.transitions.push(transition);
        }
    }

    /// Find the best matching transition for an interval and dynamic.
    pub fn find(
        &self,
        interval: i8,
        dynamic: Dynamic,
        transition_type: TransitionType,
    ) -> Option<&LegatoTransition> {
        // Exact match first.
        let exact = self.transitions.iter().find(|t| {
            t.interval == interval
                && t.dynamic as u8 == dynamic as u8
                && t.transition_type as u8 == transition_type as u8
        });
        if exact.is_some() {
            return exact;
        }

        // Fallback: same interval, any dynamic, same type.
        let any_dyn = self
            .transitions
            .iter()
            .find(|t| t.interval == interval && t.transition_type as u8 == transition_type as u8);
        if any_dyn.is_some() {
            return any_dyn;
        }

        // Fallback: same interval, any type.
        self.transitions.iter().find(|t| t.interval == interval)
    }

    pub fn len(&self) -> usize {
        self.transitions.len()
    }
}

// ---------------------------------------------------------------------------
// Legato engine
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegatoSpeed {
    Slow,
    Medium,
    Fast,
}

/// The result of legato detection on a new note-on.
pub enum LegatoResult {
    /// No legato: normal attack.
    Normal,
    /// True legato: transition sample available.
    TrueTransition {
        from_note: u8,
        from_voice: usize,
        transition: LegatoTransition,
        crossfade_in: f32,
        crossfade_out: f32,
    },
    /// Synthetic legato fallback: pitch glide.
    SyntheticGlide {
        from_note: u8,
        from_voice: usize,
        glide_time: f32,
    },
}

pub struct LegatoEngine {
    /// Currently held notes for polyphonic divisi tracking.
    held_notes: [HeldNote; MAX_HELD_NOTES],
    held_count: usize,

    /// Available transition samples.
    pub transitions: LegatoTransitionStore,

    /// Whether legato mode is enabled.
    pub enabled: bool,

    /// Global sample counter for timing.
    sample_counter: u64,
    sample_rate: f32,

    /// Last note-on time for adaptive speed detection.
    last_note_on_time: u64,

    /// Runtime-configurable speed thresholds (seconds).
    pub slow_threshold: f32,
    pub fast_threshold: f32,

    /// Runtime-configurable portamento velocity threshold (0-127).
    pub portamento_velocity_threshold: u8,
}

impl LegatoEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            held_notes: [HeldNote::default(); MAX_HELD_NOTES],
            held_count: 0,
            transitions: LegatoTransitionStore::new(),
            enabled: true,
            sample_counter: 0,
            sample_rate,
            last_note_on_time: 0,
            slow_threshold: SLOW_LEGATO_THRESHOLD,
            fast_threshold: FAST_LEGATO_THRESHOLD,
            portamento_velocity_threshold: PORTAMENTO_VELOCITY_THRESHOLD,
        }
    }

    /// Advance the sample counter (call once per block with block size).
    pub fn advance(&mut self, block_size: usize) {
        self.sample_counter += block_size as u64;
    }

    /// Process a note-on for legato. Returns a LegatoResult.
    pub fn note_on(
        &mut self,
        note: u8,
        velocity: u8,
        voice_index: usize,
        current_dynamic: Dynamic,
    ) -> LegatoResult {
        if !self.enabled {
            self.register_held(note, voice_index);
            self.last_note_on_time = self.sample_counter;
            return LegatoResult::Normal;
        }

        // Find the closest currently held note for legato.
        let closest = self.find_closest_held(note);

        let result = if let Some(held) = closest {
            let interval = note as i8 - held.note as i8;

            // Determine adaptive speed.
            let time_since_last =
                (self.sample_counter - self.last_note_on_time) as f32 / self.sample_rate;
            let speed = classify_speed(time_since_last, self.slow_threshold, self.fast_threshold);

            // Determine transition type from velocity.
            let transition_type = if velocity < self.portamento_velocity_threshold {
                TransitionType::Portamento
            } else {
                TransitionType::Slurred
            };

            // Try to find a recorded transition sample.
            if let Some(trans) = self
                .transitions
                .find(interval, current_dynamic, transition_type)
            {
                let (cf_in, cf_out) = crossfade_times(speed);
                // An authored `crossfadeOutMs` wins over the speed-derived
                // default: the bank knows how long its own recording takes to
                // hand over to the sustain, and note spacing does not. `0.0`
                // means "unauthored" — every bank shipped in this repo
                // registers no transitions at all, and one that registers a
                // transition without a crossfade time still gets exactly the
                // adaptive behaviour it would have got before.
                let crossfade_out = if trans.crossfade_out_ms > 0.0 {
                    trans.crossfade_out_ms / 1000.0
                } else {
                    cf_out
                };
                LegatoResult::TrueTransition {
                    from_note: held.note,
                    from_voice: held.voice_index,
                    transition: *trans,
                    crossfade_in: cf_in,
                    crossfade_out,
                }
            } else if interval.abs() <= MAX_LEGATO_INTERVAL {
                // Synthetic glide fallback for intervals without recorded transitions.
                let glide_time = match speed {
                    LegatoSpeed::Slow => 0.08,
                    LegatoSpeed::Medium => 0.05,
                    LegatoSpeed::Fast => 0.03,
                };
                LegatoResult::SyntheticGlide {
                    from_note: held.note,
                    from_voice: held.voice_index,
                    glide_time,
                }
            } else {
                LegatoResult::Normal
            }
        } else {
            LegatoResult::Normal
        };

        self.register_held(note, voice_index);
        self.last_note_on_time = self.sample_counter;
        result
    }

    /// Process a note-off for legato tracking.
    pub fn note_off(&mut self, note: u8) {
        for i in 0..self.held_count {
            if self.held_notes[i].active && self.held_notes[i].note == note {
                self.held_notes[i].active = false;
                break;
            }
        }
        // Compact held notes.
        self.compact_held();
    }

    /// Release all held notes.
    pub fn all_notes_off(&mut self) {
        self.held_count = 0;
        for note in self.held_notes.iter_mut() {
            note.active = false;
        }
    }

    fn register_held(&mut self, note: u8, voice_index: usize) {
        // Find a free slot or reuse oldest.
        let slot = if self.held_count < MAX_HELD_NOTES {
            let s = self.held_count;
            self.held_count += 1;
            s
        } else {
            // Reuse the oldest slot.
            let mut oldest = 0;
            let mut oldest_time = u64::MAX;
            for i in 0..MAX_HELD_NOTES {
                if self.held_notes[i].trigger_time < oldest_time {
                    oldest_time = self.held_notes[i].trigger_time;
                    oldest = i;
                }
            }
            oldest
        };

        self.held_notes[slot] = HeldNote {
            note,
            voice_index,
            active: true,
            trigger_time: self.sample_counter,
        };
    }

    /// Find the closest held note (in pitch) for polyphonic legato.
    fn find_closest_held(&self, target_note: u8) -> Option<HeldNote> {
        let mut closest: Option<HeldNote> = None;
        let mut min_distance = i16::MAX;

        for i in 0..self.held_count {
            let held = &self.held_notes[i];
            if !held.active {
                continue;
            }
            let distance = (target_note as i16 - held.note as i16).abs();
            if distance < min_distance {
                min_distance = distance;
                closest = Some(*held);
            }
        }

        closest
    }

    fn compact_held(&mut self) {
        let mut write = 0;
        for read in 0..self.held_count {
            if self.held_notes[read].active {
                if write != read {
                    self.held_notes[write] = self.held_notes[read];
                }
                write += 1;
            }
        }
        self.held_count = write;
    }
}

fn classify_speed(time_since_last_seconds: f32, slow: f32, fast: f32) -> LegatoSpeed {
    if time_since_last_seconds > slow {
        LegatoSpeed::Slow
    } else if time_since_last_seconds > fast {
        LegatoSpeed::Medium
    } else {
        LegatoSpeed::Fast
    }
}

fn crossfade_times(speed: LegatoSpeed) -> (f32, f32) {
    match speed {
        LegatoSpeed::Slow => (SLOW_CROSSFADE_IN, SLOW_CROSSFADE_OUT),
        LegatoSpeed::Medium => (MEDIUM_CROSSFADE_IN, MEDIUM_CROSSFADE_OUT),
        LegatoSpeed::Fast => (FAST_CROSSFADE_IN, FAST_CROSSFADE_OUT),
    }
}
