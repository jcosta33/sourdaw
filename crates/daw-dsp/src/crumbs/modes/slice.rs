/// Slice mode — marker-based sample slicing mapped to keys/pads.
///
/// A single sample is divided into regions by slice markers (typically
/// placed at transients via onset detection). Each slice maps to a MIDI
/// note for chromatic or sequential triggering.
///
/// Slices can be reordered, and each slice has its own start/end frame
/// derived from the marker positions.
use super::super::types::{
    FilterType, LoopMode, PlaybackMode, SampleId, SliceMarker, LOOP_CROSSFADE_DEFAULT,
};
use super::super::voice::VoiceTriggerParams;

// ── Constants ──────────────────────────────────────────────────────────

/// Maximum number of slices.
pub const MAX_SLICES: usize = 128;

/// Default base note for slice mapping.
const DEFAULT_BASE_NOTE: u8 = 36; // C2

/// Slices in the default chop, before any markers have been set.
///
/// Equal division is the no-analysis chop every sampler offers — the MPC's
/// Chop > Equal, Maschine's Slice > Split, Ableton's "Divide beat by" — and
/// sixteen is the pad count all three default to. Onset detection is the
/// better chop, but it needs the sample's PCM and it allocates, so it belongs
/// on the setup path (`set_markers_from_onsets`) and cannot run here.
const DEFAULT_SLICE_COUNT: u32 = 16;

// ── Slice Mode ─────────────────────────────────────────────────────────

/// Slice mode state: markers define regions within a single sample.
#[derive(Debug, Clone)]
pub struct SliceMode {
    pub sample_id: SampleId,
    /// Length of `sample_id` in frames, so the default chop has something to
    /// divide. Zero means nothing is loaded and no note maps to a slice.
    sample_frames: u32,
    markers: Vec<SliceMarker>,
    base_note: u8,

    // Shared playback settings for all slices.
    pub playback_mode: PlaybackMode,
    pub loop_mode: LoopMode,
    pub loop_crossfade: u32,

    // Shared envelope.
    pub attack: f32,
    pub hold: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,

    // Shared filter.
    pub filter_cutoff: f32,
    pub filter_resonance: f32,
    pub filter_type: FilterType,
}

impl Default for SliceMode {
    fn default() -> Self {
        Self {
            sample_id: 0,
            sample_frames: 0,
            markers: Vec::new(),
            base_note: DEFAULT_BASE_NOTE,
            playback_mode: PlaybackMode::OneShot,
            loop_mode: LoopMode::Off,
            loop_crossfade: LOOP_CROSSFADE_DEFAULT,
            attack: 0.0,
            hold: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.005,
            filter_cutoff: 20000.0,
            filter_resonance: 0.0,
            filter_type: FilterType::Lowpass,
        }
    }
}

impl SliceMode {
    /// Set slice markers from onset detection results.
    ///
    /// Markers are sorted by start_frame and assigned sequential MIDI notes
    /// starting from `base_note`.
    pub fn set_markers_from_onsets(&mut self, onset_frames: &[u32], total_frames: u32) {
        self.markers.clear();

        if onset_frames.is_empty() {
            return;
        }

        // Sort onsets.
        let mut sorted: Vec<u32> = onset_frames.to_vec();
        sorted.sort();
        sorted.dedup();

        // Create markers: each onset starts a slice that ends at the next onset.
        for (idx, &start) in sorted.iter().enumerate() {
            let end = if idx + 1 < sorted.len() {
                sorted[idx + 1]
            } else {
                total_frames
            };

            if start >= end {
                continue;
            }

            let mapped_note = (self.base_note as usize + self.markers.len()).min(127) as u8;

            self.markers.push(SliceMarker {
                start_frame: start,
                end_frame: end,
                mapped_note,
            });

            if self.markers.len() >= MAX_SLICES {
                break;
            }
        }
    }

    /// Add a single marker at a specific frame position.
    ///
    /// Inserts in sorted order and recalculates neighboring slice boundaries.
    pub fn add_marker(&mut self, frame: u32, total_frames: u32) {
        if self.markers.len() >= MAX_SLICES {
            return;
        }

        // Find insertion point.
        let insert_idx = self
            .markers
            .iter()
            .position(|m| m.start_frame > frame)
            .unwrap_or(self.markers.len());

        // Determine the end frame for the new slice.
        let end = if insert_idx < self.markers.len() {
            self.markers[insert_idx].start_frame
        } else {
            total_frames
        };

        // Update the previous slice's end frame.
        if insert_idx > 0 {
            self.markers[insert_idx - 1].end_frame = frame;
        }

        let mapped_note = (self.base_note as usize + insert_idx).min(127) as u8;

        self.markers.insert(
            insert_idx,
            SliceMarker {
                start_frame: frame,
                end_frame: end,
                mapped_note,
            },
        );

        // Reassign MIDI notes after insertion.
        self.reassign_notes();
    }

    /// Remove the marker closest to the given frame position.
    pub fn remove_marker_near(&mut self, frame: u32) {
        if self.markers.is_empty() {
            return;
        }

        let mut closest_idx = 0;
        let mut closest_dist = u32::MAX;

        for (idx, marker) in self.markers.iter().enumerate() {
            let dist = if frame >= marker.start_frame {
                frame - marker.start_frame
            } else {
                marker.start_frame - frame
            };
            if dist < closest_dist {
                closest_dist = dist;
                closest_idx = idx;
            }
        }

        // Merge with the previous slice (extend its end to cover the removed slice).
        if closest_idx > 0 {
            self.markers[closest_idx - 1].end_frame = self.markers[closest_idx].end_frame;
        } else if self.markers.len() > 1 {
            // Removing the first marker: the next slice extends backward.
            self.markers[1].start_frame = self.markers[0].start_frame;
        }

        self.markers.remove(closest_idx);
        self.reassign_notes();
    }

    /// Select which sample the slices cut, and how long it is.
    ///
    /// Two writes, no allocation — safe on the audio thread, which is where
    /// the engine's sample selection is applied.
    pub fn set_sample(&mut self, sample_id: SampleId, frame_count: u32) {
        self.sample_id = sample_id;
        self.sample_frames = frame_count;
    }

    /// Get the slice marker for a given MIDI note.
    ///
    /// Falls back to the default equal chop while no markers have been set, so
    /// a freshly loaded sample is already sliced. Returned by value because the
    /// default slices are computed rather than stored.
    fn note_to_slice(&self, note: u8) -> Option<SliceMarker> {
        if !self.markers.is_empty() {
            return self.markers.iter().copied().find(|m| m.mapped_note == note);
        }
        self.default_slice(note)
    }

    /// The `n`th of `DEFAULT_SLICE_COUNT` equal parts, where `n` is how far the
    /// note sits above the base note.
    ///
    /// Bounded on both sides on purpose: below the base note and past the last
    /// slice there is nothing mapped, so "the sample is chopped" stays
    /// distinguishable from "every note plays from somewhere".
    fn default_slice(&self, note: u8) -> Option<SliceMarker> {
        if self.sample_frames == 0 || note < self.base_note {
            return None;
        }

        let index = u32::from(note - self.base_note);
        if index >= DEFAULT_SLICE_COUNT {
            return None;
        }

        // 64-bit intermediates: `frames * index` overflows u32 for samples
        // longer than ~93 minutes at 48 kHz, which a long field recording
        // reaches.
        let frames = u64::from(self.sample_frames);
        let count = u64::from(DEFAULT_SLICE_COUNT);
        let start = (frames * u64::from(index) / count) as u32;
        let end = (frames * u64::from(index + 1) / count) as u32;

        if start >= end {
            return None;
        }

        Some(SliceMarker {
            start_frame: start,
            end_frame: end,
            mapped_note: note,
        })
    }

    /// Build voice trigger parameters for a given MIDI note.
    pub fn trigger_params(&self, note: u8, velocity: u8) -> Option<VoiceTriggerParams> {
        let slice = self.note_to_slice(note)?;

        Some(VoiceTriggerParams {
            note,
            velocity,
            sample_id: self.sample_id,
            root_note: note, // Slices play at original pitch.
            choke_group: 0,
            playback_mode: self.playback_mode,
            loop_mode: self.loop_mode,
            loop_start: slice.start_frame,
            loop_end: slice.end_frame,
            loop_crossfade: self.loop_crossfade,
            start_frame: slice.start_frame,
            attack: self.attack,
            hold: self.hold,
            decay: self.decay,
            sustain: self.sustain,
            release: self.release,
            filter_cutoff: self.filter_cutoff,
            filter_resonance: self.filter_resonance,
            filter_type: self.filter_type,
        })
    }

    /// Get all markers (read-only).
    pub fn markers(&self) -> &[SliceMarker] {
        &self.markers
    }

    /// Get the number of slices.
    pub fn slice_count(&self) -> usize {
        self.markers.len()
    }

    /// Get the base note.
    pub fn base_note(&self) -> u8 {
        self.base_note
    }

    /// Set the base note and reassign MIDI mappings.
    pub fn set_base_note(&mut self, note: u8) {
        self.base_note = note;
        self.reassign_notes();
    }

    // ── Internal ───────────────────────────────────────────────────────

    /// Reassign sequential MIDI notes starting from base_note.
    fn reassign_notes(&mut self) {
        for (idx, marker) in self.markers.iter_mut().enumerate() {
            marker.mapped_note = (self.base_note as usize + idx).min(127) as u8;
        }
    }
}
