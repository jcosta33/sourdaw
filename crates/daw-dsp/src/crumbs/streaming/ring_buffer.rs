/// Per-voice streaming ring buffer.
///
/// Each active voice that plays a streamed sample owns one circular buffer
/// per channel, read one frame at a time and refilled in blocks. Both halves
/// take `&mut self`: this is a single-owner structure, and the integration
/// layer is what decides which thread touches it when.
///
/// Budget: 64KB per voice (~186ms at 44.1kHz mono f32).
///
/// Reading and writing allocate nothing — capacity is fixed at construction —
/// which is the property the audio thread needs from whichever side of the
/// handoff it ends up on.
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

    /// Write samples into the buffer (called by the reader side).
    ///
    /// Returns the number of samples actually written.
    ///
    /// A short right channel — a truncated read at end-of-file, a source that
    /// went mono mid-stream — is filled with silence rather than left holding
    /// whatever the previous pass wrote there. Skipping those positions left
    /// the ring's stale right-channel content paired with fresh left-channel
    /// frames, so the voice played an unrelated fragment of the file in one
    /// ear.
    pub fn write(&mut self, left: &[f32], right: &[f32]) -> usize {
        let space = self.capacity - self.available;
        let to_write = left.len().min(space);

        let write_pos = (self.read_pos + self.available) % self.capacity;

        for i in 0..to_write {
            let pos = (write_pos + i) % self.capacity;
            self.buffer_left[pos] = left[i];
            if self.is_stereo {
                self.buffer_right[pos] = right.get(i).copied().unwrap_or(0.0);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Fill the ring with `value` in both channels and read it all back, so the
    /// underlying storage holds that value everywhere and the read cursor is
    /// back at the start.
    fn primed_buffer(value: f32) -> VoiceStreamBuffer {
        let mut buffer = VoiceStreamBuffer::new(true);
        let filler = vec![value; STREAM_FRAMES];
        assert_eq!(
            buffer.write(&filler, &filler),
            STREAM_FRAMES,
            "the priming write did not fill the ring"
        );
        for _ in 0..STREAM_FRAMES {
            buffer.read();
        }
        assert_eq!(buffer.buffered_samples(), 0, "the ring did not drain");
        buffer
    }

    /// Audit F13: a write whose right channel is shorter than its left — a
    /// truncated read at end-of-file — skipped the leftover positions instead
    /// of clearing them, so the ring's *previous* right-channel contents were
    /// paired with the new left-channel frames and one ear played an unrelated
    /// fragment of the file.
    #[test]
    fn a_short_right_channel_is_zero_filled_rather_than_left_stale() {
        const STALE: f32 = 0.75;
        const FRESH: f32 = -0.25;
        const LEFT_FRAMES: usize = 8;
        const RIGHT_FRAMES: usize = 4;

        let mut buffer = primed_buffer(STALE);
        let left = vec![FRESH; LEFT_FRAMES];
        let right = vec![FRESH; RIGHT_FRAMES];
        assert_eq!(buffer.write(&left, &right), LEFT_FRAMES);

        for frame in 0..LEFT_FRAMES {
            let (out_left, out_right, _) = buffer.read();
            assert_eq!(out_left, FRESH, "left channel at frame {frame}");
            let expected_right = if frame < RIGHT_FRAMES { FRESH } else { 0.0 };
            assert_eq!(
                out_right, expected_right,
                "right channel at frame {frame} read {out_right}; the shortfall is carrying the \
                 previous write's data instead of silence"
            );
        }
    }

    /// A mono buffer has no right storage at all, so a short right channel is
    /// nothing to fill and the left channel must still come through.
    #[test]
    fn a_mono_buffer_ignores_the_right_channel_entirely() {
        let mut buffer = VoiceStreamBuffer::new(false);
        assert_eq!(buffer.write(&[0.5, 0.25], &[]), 2);

        let (left, right, _) = buffer.read();
        assert_eq!(left, 0.5);
        assert_eq!(right, 0.5, "a mono buffer mirrors its left channel");
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
