//! Release trigger logic.
//!
//! When a real instrument stops playing, there's a characteristic sound:
//! bow lift (strings), embouchure relaxation (brass), breath stop (woodwinds),
//! damper return (piano). Release trigger samples capture these sounds and
//! play automatically on note-off.

use super::types::*;

/// Track per-note start times for release trigger volume scaling.
const MAX_NOTE_TRACKING: usize = 128;

pub struct ReleaseTracker {
    /// Per-note: sample count when the note was triggered (0 = not active).
    note_start_times: [u64; MAX_NOTE_TRACKING],
    config: ReleaseTriggerInfo,
    sample_rate: f32,
    sample_counter: u64,
}

impl ReleaseTracker {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            note_start_times: [0; MAX_NOTE_TRACKING],
            config: ReleaseTriggerInfo::default(),
            sample_rate,
            sample_counter: 1, // start at 1 so notes at time 0 are distinguishable from "not active"
        }
    }

    pub fn advance(&mut self, block_size: usize) {
        self.sample_counter += block_size as u64;
    }

    /// Record when a note starts.
    pub fn note_on(&mut self, note: u8) {
        if (note as usize) < MAX_NOTE_TRACKING {
            self.note_start_times[note as usize] = self.sample_counter;
        }
    }

    /// Compute release trigger volume for a note-off.
    /// Returns (should_trigger, volume).
    pub fn note_off(&mut self, note: u8, cc1_normalized: f32) -> (bool, f32) {
        let idx = note as usize;
        if idx >= MAX_NOTE_TRACKING {
            return (false, 0.0);
        }

        let start = self.note_start_times[idx];
        if start == 0 {
            return (false, 0.0);
        }

        let duration_samples = self.sample_counter.saturating_sub(start);
        let duration_secs = duration_samples as f32 / self.sample_rate;
        self.note_start_times[idx] = 0;

        // Scale volume by duration (longer held = louder release, up to threshold).
        let dur_scale = (duration_secs / self.config.duration_scale_max).min(1.0);

        // Scale by dynamic level (CC1).
        let dyn_scale = if self.config.dynamic_scale {
            cc1_normalized
        } else {
            1.0
        };

        // Release triggers are typically quieter than the main note.
        let volume = dur_scale * dyn_scale * 0.5;

        (volume > 0.01, volume)
    }

    pub fn set_config(&mut self, config: ReleaseTriggerInfo) {
        self.config = config;
    }

    /// Forget every in-flight note. Used by `LevainEngine::all_notes_off`
    /// so a subsequent note-on after transport stop sees a clean slate
    /// rather than a stale start-time from before the stop.
    pub fn clear_all(&mut self) {
        for t in self.note_start_times.iter_mut() {
            *t = 0;
        }
    }
}

/// Maximum deferred releases (fixed-size to avoid audio-thread allocation).
const MAX_DEFERRED: usize = 128;

/// State for deferred releases during sustain pedal hold.
/// Uses a fixed-size array to avoid heap allocation on the audio thread.
pub struct PedalDeferredRelease {
    /// Notes waiting for pedal release. (note, cc1_at_noteoff)
    deferred: [(u8, f32); MAX_DEFERRED],
    count: usize,
    pub pedal_held: bool,
}

impl PedalDeferredRelease {
    pub fn new() -> Self {
        Self {
            deferred: [(0, 0.0); MAX_DEFERRED],
            count: 0,
            pedal_held: false,
        }
    }

    /// When pedal is held, defer the note-off.
    pub fn defer_note_off(&mut self, note: u8, cc1: f32) {
        if self.count < MAX_DEFERRED {
            self.deferred[self.count] = (note, cc1);
            self.count += 1;
        }
    }

    /// Drop every deferred note-off without firing their callbacks. Used
    /// by `LevainEngine::all_notes_off` on transport stop: the voices
    /// those entries referenced are already being released silently, so
    /// firing them later (e.g. on the next pedal-up) would run stale
    /// callbacks and, worse, could wedge the queue at `MAX_DEFERRED` and
    /// silently drop subsequent legitimate deferred note-offs.
    pub fn clear(&mut self) {
        self.count = 0;
    }

    /// When pedal is released, iterate deferred notes with staggered timing.
    /// Calls the provided closure for each (note, cc1, stagger_samples).
    pub fn release_pedal<F: FnMut(u8, f32, u32)>(&mut self, sample_rate: f32, mut callback: F) {
        if self.count == 0 {
            return;
        }

        let base_stagger = (0.01 * sample_rate) as u32; // 10ms base

        for i in 0..self.count {
            let (note, cc1) = self.deferred[i];
            let stagger = if self.count > 1 {
                (base_stagger * 3 * i as u32) / (self.count as u32).max(1)
            } else {
                0
            };
            callback(note, cc1, stagger);
        }

        self.count = 0;
    }

    pub fn has_deferred(&self) -> bool {
        self.count > 0
    }
}
