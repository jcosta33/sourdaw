use serde::{Deserialize, Serialize};

/// Represents a single discrete pitch segment (e.g., a "blob" in the UI).
/// The audio thread interpolates shifts between these segments if needed,
/// or applies them directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteSegment {
    /// Start time in milliseconds within the clip
    pub start_time_ms: f32,
    /// End time in milliseconds within the clip
    pub end_time_ms: f32,
    /// The shift in semitones to apply (e.g., +1.0 = up one semitone)
    pub shift_semitones: f32,
}

/// The IPC command sent from the UI to update a clip's pitch profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PitchEditCommand {
    /// Target clip ID
    pub clip_id: String,
    /// The new sequence of note segments
    pub segments: Vec<NoteSegment>,
}

/// An audio-thread-safe lookup table for pitch deltas.
/// We compile the `NoteSegment` vector into a dense flat array (e.g. 1 value per 256 samples)
/// to ensure O(1) lock-free reads during synthesis.
pub struct CompiledDeltaMap {
    /// Hop size in samples (e.g. 256). Each value in `deltas` covers this many samples.
    pub hop_size: usize,
    /// The actual semitone shift values over time.
    pub deltas: Vec<f32>,
}

impl CompiledDeltaMap {
    /// Create an empty delta map.
    pub fn empty() -> Self {
        Self {
            hop_size: 256,
            deltas: Vec::new(),
        }
    }

    /// Compile a list of NoteSegments into a dense array for a given audio length and sample rate.
    pub fn compile(segments: &[NoteSegment], sample_rate: f32, total_samples: usize, hop_size: usize) -> Self {
        let num_frames = (total_samples + hop_size - 1) / hop_size;
        let mut deltas = vec![0.0_f32; num_frames];

        for segment in segments {
            let start_sample = (segment.start_time_ms / 1000.0 * sample_rate) as usize;
            let end_sample = (segment.end_time_ms / 1000.0 * sample_rate) as usize;
            
            let start_frame = start_sample / hop_size;
            let end_frame = (end_sample / hop_size).min(num_frames);

            for i in start_frame..end_frame {
                deltas[i] = segment.shift_semitones;
            }
        }

        Self { hop_size, deltas }
    }

    /// Lock-free O(1) lookup. Given a sample index, returns the shift in semitones.
    #[inline(always)]
    pub fn get_shift_at(&self, sample_index: usize) -> f32 {
        if self.deltas.is_empty() {
            return 0.0;
        }
        let frame = sample_index / self.hop_size;
        if frame < self.deltas.len() {
            self.deltas[frame]
        } else {
            0.0
        }
    }
}