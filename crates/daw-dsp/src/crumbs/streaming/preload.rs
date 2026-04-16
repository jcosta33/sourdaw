/// Preload cache — RAM-resident attack portion of each sample.
///
/// The first `PRELOAD_SIZE` bytes (~12KB, ~68ms at 44.1kHz mono) of each
/// sample are kept in RAM to guarantee instant playback start without
/// waiting for disk I/O. The preload covers the critical attack transient
/// that must be available immediately when a note is triggered.
use super::super::types::{SampleId, PRELOAD_SIZE};

/// Number of f32 samples that fit in the preload buffer.
const PRELOAD_FRAMES: usize = PRELOAD_SIZE / core::mem::size_of::<f32>();

/// Preloaded attack data for a single sample (mono or stereo).
#[derive(Debug, Clone)]
pub struct PreloadBuffer {
    pub sample_id: SampleId,
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub frame_count: usize,
    pub is_stereo: bool,
}

impl PreloadBuffer {
    /// Create a preload buffer from the beginning of a sample's channel data.
    pub fn from_channels(sample_id: SampleId, left: &[f32], right: &[f32]) -> Self {
        let frames = left.len().min(PRELOAD_FRAMES);
        let is_stereo = !right.is_empty();

        Self {
            sample_id,
            left: left[..frames].to_vec(),
            right: if is_stereo {
                right[..frames.min(right.len())].to_vec()
            } else {
                Vec::new()
            },
            frame_count: frames,
            is_stereo,
        }
    }

    /// Read a sample from the preload's left channel.
    pub fn read_left(&self, frame: usize) -> Option<f32> {
        self.left.get(frame).copied()
    }

    /// Read a sample from the preload's right channel.
    pub fn read_right(&self, frame: usize) -> Option<f32> {
        if self.is_stereo {
            self.right.get(frame).copied()
        } else {
            self.read_left(frame)
        }
    }

    /// Check if a frame position is within the preloaded region.
    pub fn contains(&self, frame: usize) -> bool {
        frame < self.frame_count
    }
}

/// Cache of preloaded sample attacks, indexed by SampleId.
#[derive(Debug, Default)]
pub struct PreloadCache {
    buffers: Vec<Option<PreloadBuffer>>,
}

impl PreloadCache {
    pub fn new() -> Self {
        Self {
            buffers: Vec::new(),
        }
    }

    /// Add a preload buffer for a sample.
    pub fn insert(&mut self, buffer: PreloadBuffer) {
        let id = buffer.sample_id as usize;
        while self.buffers.len() <= id {
            self.buffers.push(None);
        }
        self.buffers[id] = Some(buffer);
    }

    /// Get the preload buffer for a sample.
    pub fn get(&self, sample_id: SampleId) -> Option<&PreloadBuffer> {
        self.buffers
            .get(sample_id as usize)
            .and_then(|slot| slot.as_ref())
    }
}
