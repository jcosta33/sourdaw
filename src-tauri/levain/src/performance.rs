//! Performance intelligence — auto-divisi, auto-articulation, ensemble timing.
//!
//! Real levain sections don't play in perfect unison. This module
//! simulates the natural behaviors of ensemble playing.

use crate::types::*;
use crate::humanize::Rng;

// ---------------------------------------------------------------------------
// Auto-divisi
// ---------------------------------------------------------------------------

/// Auto-divisi: when a string ensemble plays a chord, individual players
/// divide onto different notes. This reduces the volume per note and
/// adds per-group variation.
/// Maximum simultaneous divisi notes.
const MAX_DIVISI_NOTES: usize = 16;

pub struct AutoDivisi {
    pub enabled: bool,
    /// Section size (total number of players, e.g., 16 violins).
    pub section_size: u8,
    /// Currently sounding notes (fixed-size, no heap allocation).
    held_notes: [u8; MAX_DIVISI_NOTES],
    held_count: usize,
}

impl AutoDivisi {
    pub fn new(section_size: u8) -> Self {
        Self {
            enabled: false,
            section_size: section_size.max(1),
            held_notes: [0; MAX_DIVISI_NOTES],
            held_count: 0,
        }
    }

    pub fn note_on(&mut self, note: u8) {
        // Check if already held.
        for i in 0..self.held_count {
            if self.held_notes[i] == note {
                return;
            }
        }
        if self.held_count < MAX_DIVISI_NOTES {
            self.held_notes[self.held_count] = note;
            self.held_count += 1;
        }
    }

    pub fn note_off(&mut self, note: u8) {
        let mut write = 0;
        for read in 0..self.held_count {
            if self.held_notes[read] != note {
                self.held_notes[write] = self.held_notes[read];
                write += 1;
            }
        }
        self.held_count = write;
    }

    pub fn divisi_gain(&self) -> f32 {
        if !self.enabled || self.held_count == 0 {
            return 1.0;
        }

        let note_count = self.held_count as f32;
        let players_per_note = self.section_size as f32 / note_count;
        let full_section = self.section_size as f32;

        (players_per_note / full_section).sqrt()
    }

    pub fn note_count(&self) -> usize {
        self.held_count
    }

    pub fn clear(&mut self) {
        self.held_count = 0;
    }
}

// ---------------------------------------------------------------------------
// Auto-articulation
// ---------------------------------------------------------------------------

/// Intelligent articulation selection based on playing patterns.
/// Analyzes note duration and speed to suggest articulations.
pub struct AutoArticulation {
    pub enabled: bool,
    /// Duration thresholds (seconds).
    pub short_threshold: f32,
    pub medium_threshold: f32,
    /// Speed threshold for runs detection (notes per second).
    pub runs_speed_threshold: f32,

    /// Recent note-on times for speed calculation.
    recent_note_times: [f32; 8],
    recent_idx: usize,
    recent_count: usize,
}

impl AutoArticulation {
    pub fn new() -> Self {
        Self {
            enabled: false,
            short_threshold: 0.2,
            medium_threshold: 0.5,
            runs_speed_threshold: 8.0,
            recent_note_times: [0.0; 8],
            recent_idx: 0,
            recent_count: 0,
        }
    }

    /// Record a note-on event time.
    pub fn record_note_on(&mut self, time_seconds: f32) {
        self.recent_note_times[self.recent_idx] = time_seconds;
        self.recent_idx = (self.recent_idx + 1) % 8;
        if self.recent_count < 8 {
            self.recent_count += 1;
        }
    }

    /// Suggest an articulation based on recent playing patterns.
    /// Returns None if auto-articulation is disabled or no suggestion.
    pub fn suggest(&self, note_duration: f32, has_overlap: bool) -> Option<ArticulationType> {
        if !self.enabled {
            return None;
        }

        // Overlapping notes → legato.
        if has_overlap {
            return Some(ArticulationType::Legato);
        }

        // Check for fast runs.
        if self.recent_count >= 3 {
            let speed = self.calculate_recent_speed();
            if speed > self.runs_speed_threshold {
                return Some(ArticulationType::Runs);
            }
        }

        // Duration-based.
        if note_duration > 0.0 && note_duration < self.short_threshold {
            Some(ArticulationType::Staccato)
        } else if note_duration < self.medium_threshold {
            Some(ArticulationType::Sustain)
        } else {
            Some(ArticulationType::Sustain)
        }
    }

    /// Calculate notes-per-second from recent history.
    fn calculate_recent_speed(&self) -> f32 {
        if self.recent_count < 2 {
            return 0.0;
        }

        let count = self.recent_count.min(8);
        let oldest_idx = if count < 8 {
            0
        } else {
            self.recent_idx
        };
        let newest_idx = if self.recent_idx == 0 { 7 } else { self.recent_idx - 1 };

        let time_span = self.recent_note_times[newest_idx] - self.recent_note_times[oldest_idx];
        if time_span <= 0.0 {
            return 0.0;
        }

        (count as f32 - 1.0) / time_span
    }
}

// ---------------------------------------------------------------------------
// Ensemble timing simulation
// ---------------------------------------------------------------------------

/// Simulates the natural timing, tuning, and dynamic variations that
/// occur when multiple players in a section play together.
pub struct EnsembleTiming {
    pub enabled: bool,
    /// Attack spread: players start ±N ms apart.
    pub attack_spread_ms: f32,
    /// Pitch convergence: start ±N cents out of tune, converge over M ms.
    pub initial_detune_cents: f32,
    pub convergence_time_ms: f32,
    /// Dynamic bloom: collective crescendo builds over N ms.
    pub bloom_time_ms: f32,
    rng: Rng,
}

impl EnsembleTiming {
    pub fn new(seed: u64) -> Self {
        Self {
            enabled: false,
            attack_spread_ms: 12.0,
            initial_detune_cents: 5.0,
            convergence_time_ms: 300.0,
            bloom_time_ms: 200.0,
            rng: Rng::new(seed),
        }
    }

    /// Generate per-voice ensemble timing offsets.
    pub fn generate_voice_offsets(&mut self) -> EnsembleVoiceOffsets {
        if !self.enabled {
            return EnsembleVoiceOffsets::default();
        }

        EnsembleVoiceOffsets {
            timing_offset_ms: self.rng.next_bipolar() * self.attack_spread_ms,
            initial_detune_cents: self.rng.next_bipolar() * self.initial_detune_cents,
            convergence_time_ms: self.convergence_time_ms,
            bloom_time_ms: self.bloom_time_ms,
        }
    }
}

/// Per-voice ensemble timing offsets.
#[derive(Debug, Clone, Copy)]
pub struct EnsembleVoiceOffsets {
    pub timing_offset_ms: f32,
    pub initial_detune_cents: f32,
    pub convergence_time_ms: f32,
    pub bloom_time_ms: f32,
}

impl Default for EnsembleVoiceOffsets {
    fn default() -> Self {
        Self {
            timing_offset_ms: 0.0,
            initial_detune_cents: 0.0,
            convergence_time_ms: 0.0,
            bloom_time_ms: 0.0,
        }
    }
}
