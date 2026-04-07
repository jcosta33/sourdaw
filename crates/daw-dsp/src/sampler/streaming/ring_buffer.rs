/// Per-voice streaming ring buffer.
///
/// Each active voice that plays a streamed sample owns a pair of ring
/// buffers (ping-pong) filled by the background I/O thread. The audio
/// thread only reads from the ring buffer — never writes or allocates.
///
/// Budget: 64KB per voice (~186ms at 44.1kHz mono f32).
///
/// This module provides the data structures. The actual `rtrb`-based
/// implementation requires the `rtrb` crate, which lives in the
/// integration layer (daw-engine / src-tauri). This module defines
/// the interface and a simple fallback for WASM (where disk streaming
/// is not applicable — samples are fully in memory).

use super::super::types::{FADE_UNDERRUN_SAMPLES, STREAM_BUF_SIZE};

/// Number of f32 samples that fit in one stream buffer.
const STREAM_FRAMES: usize = STREAM_BUF_SIZE / core::mem::size_of::<f32>();

/// Status of a streaming voice's buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamStatus {
    /// Buffer has enough data for playback.
    Ok,
    /// Buffer is running low — I/O thread should prioritize this voice.
    Low,
    /// Buffer is empty — apply underrun fade.
    Underrun,
}

/// Streaming buffer state for a single voice.
///
/// In the native path, this wraps `rtrb` ring buffers.
/// In WASM, samples are fully in memory and this is unused.
#[derive(Debug)]
pub struct VoiceStreamBuffer {
    /// Circular buffer for left channel.
    buffer_left: Vec<f32>,
    /// Circular buffer for right channel.
    buffer_right: Vec<f32>,
    /// Read position.
    read_pos: usize,
    /// Number of valid samples available.
    available: usize,
    /// Total capacity in frames.
    capacity: usize,
    /// Whether this buffer is for a stereo sample.
    is_stereo: bool,
    /// Underrun fade counter.
    underrun_fade: usize,
}

impl VoiceStreamBuffer {
    pub fn new(is_stereo: bool) -> Self {
        Self {
            buffer_left: vec![0.0; STREAM_FRAMES],
            buffer_right: if is_stereo {
                vec![0.0; STREAM_FRAMES]
            } else {
                Vec::new()
            },
            read_pos: 0,
            available: 0,
            capacity: STREAM_FRAMES,
            is_stereo,
            underrun_fade: 0,
        }
    }

    /// Read one stereo sample pair from the buffer.
    /// Returns (left, right, status).
    pub fn read(&mut self) -> (f32, f32, StreamStatus) {
        if self.available == 0 {
            // Underrun — track fade counter for the voice to apply fade-out.
            if self.underrun_fade < FADE_UNDERRUN_SAMPLES {
                self.underrun_fade += 1;
            }
            return (0.0, 0.0, StreamStatus::Underrun);
        }

        let left = self.buffer_left[self.read_pos];
        let right = if self.is_stereo {
            self.buffer_right[self.read_pos]
        } else {
            left
        };

        self.read_pos = (self.read_pos + 1) % self.capacity;
        self.available -= 1;
        self.underrun_fade = 0;

        let status = if self.available < self.capacity / 4 {
            StreamStatus::Low
        } else {
            StreamStatus::Ok
        };

        (left, right, status)
    }

    /// Write samples into the buffer (called by the I/O thread).
    ///
    /// Returns the number of samples actually written.
    pub fn write(&mut self, left: &[f32], right: &[f32]) -> usize {
        let space = self.capacity - self.available;
        let to_write = left.len().min(space);

        let write_pos = (self.read_pos + self.available) % self.capacity;

        for i in 0..to_write {
            let pos = (write_pos + i) % self.capacity;
            self.buffer_left[pos] = left[i];
            if self.is_stereo && i < right.len() {
                self.buffer_right[pos] = right[i];
            }
        }

        self.available += to_write;
        to_write
    }

    /// Get the number of buffered samples remaining.
    pub fn buffered_samples(&self) -> usize {
        self.available
    }

    /// Get the buffer status.
    pub fn status(&self) -> StreamStatus {
        if self.available == 0 {
            StreamStatus::Underrun
        } else if self.available < self.capacity / 4 {
            StreamStatus::Low
        } else {
            StreamStatus::Ok
        }
    }

    /// Reset the buffer (e.g., when a voice is reassigned).
    pub fn reset(&mut self) {
        self.read_pos = 0;
        self.available = 0;
        self.underrun_fade = 0;
    }
}

/// Request from the audio thread to the I/O thread.
#[derive(Debug, Clone)]
pub struct StreamRequest {
    /// Voice index that needs data.
    pub voice_index: usize,
    /// Sample ID to stream from.
    pub sample_id: u32,
    /// Frame position in the source file to read from.
    pub source_frame: u64,
    /// Number of frames requested.
    pub frames_needed: usize,
    /// Priority (lower = more urgent). Based on buffered_samples_remaining.
    pub priority: usize,
}
