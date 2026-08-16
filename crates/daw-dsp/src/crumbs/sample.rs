/// Sample data storage and sample pool.
///
/// Holds decoded PCM audio in memory. Stereo samples are stored as
/// separate left/right channel vectors for cache-friendly per-channel access.
use super::types::{SampleCategory, SampleId, SampleMeta, MAX_POOL_SAMPLES};

// ── Sample Data ────────────────────────────────────────────────────────

/// Decoded PCM audio data for a single sample.
#[derive(Debug, Clone)]
pub struct SampleData {
    /// Left channel (or mono) PCM frames.
    pub left: Vec<f32>,
    /// Right channel PCM frames. Empty for mono samples.
    pub right: Vec<f32>,
    /// Metadata about this sample.
    pub meta: SampleMeta,
}

impl SampleData {
    /// Create a mono sample from raw PCM data.
    pub fn from_mono(data: Vec<f32>, sample_rate: u32) -> Self {
        let frame_count = data.len() as u32;
        Self {
            left: data,
            right: Vec::new(),
            meta: SampleMeta {
                sample_rate,
                channels: 1,
                frame_count,
                duration_secs: frame_count as f64 / sample_rate as f64,
                detected_root: None,
                detected_bpm: None,
                category: SampleCategory::Unknown,
            },
        }
    }

    /// Create a stereo sample from separate channel data.
    pub fn from_stereo(left: Vec<f32>, right: Vec<f32>, sample_rate: u32) -> Self {
        let frame_count = left.len().min(right.len()) as u32;
        Self {
            left,
            right,
            meta: SampleMeta {
                sample_rate,
                channels: 2,
                frame_count,
                duration_secs: frame_count as f64 / sample_rate as f64,
                detected_root: None,
                detected_bpm: None,
                category: SampleCategory::Unknown,
            },
        }
    }

    /// Create a stereo sample from interleaved data (L R L R ...).
    pub fn from_interleaved(interleaved: &[f32], sample_rate: u32, channels: u32) -> Self {
        if channels == 1 {
            return Self::from_mono(interleaved.to_vec(), sample_rate);
        }

        let frame_count = interleaved.len() / channels as usize;
        let mut left = Vec::with_capacity(frame_count);
        let mut right = Vec::with_capacity(frame_count);

        for frame in interleaved.chunks(channels as usize) {
            left.push(frame[0]);
            if frame.len() > 1 {
                right.push(frame[1]);
            } else {
                right.push(frame[0]);
            }
        }

        Self {
            left,
            right,
            meta: SampleMeta {
                sample_rate,
                channels: 2,
                frame_count: frame_count as u32,
                duration_secs: frame_count as f64 / sample_rate as f64,
                detected_root: None,
                detected_bpm: None,
                category: SampleCategory::Unknown,
            },
        }
    }

    /// True if this is a stereo sample.
    pub fn is_stereo(&self) -> bool {
        !self.right.is_empty()
    }

    /// Total number of frames.
    pub fn frame_count(&self) -> usize {
        self.left.len()
    }

    /// Read a sample from the left channel at a given frame index.
    /// Returns 0.0 for out-of-bounds access (safe for interpolation guard samples).
    pub fn read_left(&self, frame: usize) -> f32 {
        if frame < self.left.len() {
            self.left[frame]
        } else {
            0.0
        }
    }

    /// Read a sample from the right channel at a given frame index.
    /// Falls back to left channel for mono samples.
    pub fn read_right(&self, frame: usize) -> f32 {
        if self.right.is_empty() {
            self.read_left(frame)
        } else if frame < self.right.len() {
            self.right[frame]
        } else {
            0.0
        }
    }
}

// ── Sample Pool ────────────────────────────────────────────────────────

/// Arena-based sample storage indexed by SampleId.
///
/// Samples are never removed during playback — only added.
/// PCM ownership stays with the management thread; the pool holds `Arc`s the
/// audio thread reads through.
///
/// The slot vector is sized once, to `MAX_POOL_SAMPLES`, and never grows.
/// `set` is reachable from the audio thread — `CrumbsCommand::AddSample` is
/// drained inside the process callback — and the push loop it used to grow by
/// allocated there (audit F4). Storing is now an in-place write into a slot
/// that already exists, so the RT-reachable path allocates nothing; the `Arc`
/// itself was built off-thread by whoever sent the command.
#[derive(Debug, Clone)]
pub struct SamplePool {
    samples: Vec<Option<std::sync::Arc<SampleData>>>,
    next_id: SampleId,
    dropped_writes: u32,
}

impl SamplePool {
    pub fn new() -> Self {
        Self {
            samples: vec![None; MAX_POOL_SAMPLES],
            next_id: 0,
            dropped_writes: 0,
        }
    }

    /// Add a sample to the pool and return its ID.
    ///
    /// A full pool refuses the sample and returns the id it would have used
    /// without advancing the cursor, so `get` on that id reports `None` — the
    /// same "no sample" every caller already handles by falling silent. It
    /// never panics in release: dropping a note is a bounded loss, killing the
    /// render thread is not.
    pub fn add(&mut self, sample: std::sync::Arc<SampleData>) -> SampleId {
        let id = self.next_id;
        if !self.store(id, sample) {
            return id;
        }
        self.next_id += 1;
        id
    }

    /// Set a sample at a specific ID (useful for synced pools).
    pub fn set(&mut self, id: SampleId, sample: std::sync::Arc<SampleData>) {
        if !self.store(id, sample) {
            return;
        }
        if id >= self.next_id {
            self.next_id = id + 1;
        }
    }

    /// Write one slot in place. Returns false for an id past the fixed bound.
    ///
    /// Replacing an occupied slot drops the `Arc` that was there. The command
    /// side keeps its own clone of every sample it mirrors in (`instance
    /// .samples` in `src-tauri`), and its ids come from a monotonic counter, so
    /// the audio-thread path neither reuses a slot nor holds the last
    /// reference; the free, when it comes, happens where the sample map is
    /// cleared.
    ///
    /// A refusal only counts — no assert, even a debug one, because this is
    /// reached from inside the audio callback and a data-dependent panic there
    /// kills the render thread in every `debug_assertions` build.
    fn store(&mut self, id: SampleId, sample: std::sync::Arc<SampleData>) -> bool {
        let Some(slot) = self.samples.get_mut(id as usize) else {
            self.dropped_writes = self.dropped_writes.saturating_add(1);
            return false;
        };
        *slot = Some(sample);
        true
    }

    /// Writes refused because their id fell past the fixed pool bound.
    /// Non-zero means the host's monotonic id counter has outrun
    /// `MAX_POOL_SAMPLES` and samples are being silently dropped — surface it,
    /// don't ignore it.
    pub fn dropped_write_count(&self) -> u32 {
        self.dropped_writes
    }

    /// Get a reference to a sample by ID.
    pub fn get(&self, id: SampleId) -> Option<&std::sync::Arc<SampleData>> {
        self.samples.get(id as usize).and_then(|slot| slot.as_ref())
    }

    /// Get the number of loaded samples.
    pub fn count(&self) -> usize {
        self.samples.iter().filter(|s| s.is_some()).count()
    }
}

impl Default for SamplePool {
    fn default() -> Self {
        Self::new()
    }
}
