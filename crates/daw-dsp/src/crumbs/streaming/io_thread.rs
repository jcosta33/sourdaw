/// I/O thread management for disk streaming.
///
/// The I/O thread runs in the background and fills voice stream buffers
/// from disk. It uses a priority queue sorted by `buffered_samples_remaining`
/// to ensure the most starved voices get filled first.
///
/// This module defines the data structures and scheduling logic.
/// The actual thread spawning and file I/O happens in the integration
/// layer (sourdaw-native) since it requires OS threading and file system
/// access that is not available in WASM.
use super::ring_buffer::StreamRequest;

// ── I/O Priority Queue ────────────────────────────────────────────────

/// Priority queue for stream requests, sorted by urgency.
///
/// Uses a simple sorted Vec — with 128 max voices, the linear scan
/// is faster than a heap for this size.
#[derive(Debug, Default)]
pub struct StreamScheduler {
    requests: Vec<StreamRequest>,
}

impl StreamScheduler {
    pub fn new() -> Self {
        Self {
            requests: Vec::with_capacity(128),
        }
    }

    /// Add a stream request. Maintains sorted order by priority (ascending).
    pub fn push(&mut self, request: StreamRequest) {
        // Remove any existing request for the same voice.
        self.requests
            .retain(|r| r.voice_index != request.voice_index);

        // Insert in priority order.
        let insert_pos = self
            .requests
            .iter()
            .position(|r| r.priority > request.priority)
            .unwrap_or(self.requests.len());
        self.requests.insert(insert_pos, request);
    }

    /// Pop the highest-priority (most urgent) request.
    pub fn pop(&mut self) -> Option<StreamRequest> {
        if self.requests.is_empty() {
            None
        } else {
            Some(self.requests.remove(0))
        }
    }

    /// Peek at the highest-priority request without removing it.
    pub fn peek(&self) -> Option<&StreamRequest> {
        self.requests.first()
    }

    /// Remove all requests for a specific voice (e.g., when voice is freed).
    pub fn cancel_voice(&mut self, voice_index: usize) {
        self.requests.retain(|r| r.voice_index != voice_index);
    }

    /// Clear all pending requests.
    pub fn clear(&mut self) {
        self.requests.clear();
    }

    /// Number of pending requests.
    pub fn len(&self) -> usize {
        self.requests.len()
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.requests.is_empty()
    }
}

/// Configuration for the I/O thread.
#[derive(Debug, Clone)]
pub struct IoThreadConfig {
    /// Maximum number of frames to read per I/O operation.
    pub max_read_frames: usize,
    /// Number of voices to service per I/O cycle.
    pub voices_per_cycle: usize,
}

impl Default for IoThreadConfig {
    fn default() -> Self {
        Self {
            max_read_frames: 8192,
            voices_per_cycle: 4,
        }
    }
}
