//! Retrospective audio retention: about sixty seconds, one explicit target,
//! gated on arming.
//!
//! This is not the device-input FIFO in [`crate::capture`]. That ring is
//! latency slack between the input callback and the render callback. This
//! module keeps a separate rolling buffer of recent input so a performance
//! played before record can be recovered. Storage is allocated on the control
//! thread when armed; the capture callback only copies into it.

use rtrb::{Consumer, Producer, PushError, RingBuffer};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Seconds of interleaved audio retained while the ring is armed.
pub const RETROSPECTIVE_SECONDS: u32 = 60;

/// Command slots between the control thread and the capture callback.
///
/// Arm and disarm are rare; a small SPSC is enough that a burst of replaces
/// still lands before the next input block drains them.
const COMMAND_CAPACITY: usize = 8;

/// Retired buffers waiting for the control thread to free them.
///
/// The capture callback must not free; it pushes the previous allocation here
/// and the control side drops it on the next arm, disarm, or drop.
const RETIRE_CAPACITY: usize = 8;

/// Frames of capacity for one armed retrospective window at `sample_rate`.
pub fn retrospective_capacity_frames(sample_rate: f32) -> usize {
    if !sample_rate.is_finite() || sample_rate <= 0.0 {
        return 0;
    }
    (sample_rate as u64).saturating_mul(u64::from(RETROSPECTIVE_SECONDS)) as usize
}

enum RetrospectiveCommand {
    Arm {
        track_id: usize,
        channels: usize,
        buffer: Box<[f32]>,
    },
    Disarm,
}

struct ActiveRing {
    track_id: usize,
    channels: usize,
    buffer: Box<[f32]>,
    /// Next interleaved sample index to write (wraps at `buffer.len()`).
    write_head: usize,
    /// How many interleaved samples currently hold retained audio.
    filled: usize,
}

impl ActiveRing {
    fn write_block(&mut self, block: &[f32]) {
        let capacity = self.buffer.len();
        if capacity == 0 || block.is_empty() {
            return;
        }

        // Copy in chunks that do not wrap mid-write.
        let mut src = 0;
        while src < block.len() {
            let space_to_end = capacity - self.write_head;
            let n = (block.len() - src).min(space_to_end);
            self.buffer[self.write_head..self.write_head + n].copy_from_slice(&block[src..src + n]);
            self.write_head = (self.write_head + n) % capacity;
            src += n;
        }

        self.filled = (self.filled + block.len()).min(capacity);
    }

    /// Oldest-first copy of the retained region into `out`.
    fn copy_retained(&self, out: &mut [f32]) -> usize {
        let n = self.filled.min(out.len());
        if n == 0 {
            return 0;
        }

        let capacity = self.buffer.len();
        let start = if self.filled == capacity {
            self.write_head
        } else {
            0
        };

        let first = (capacity - start).min(n);
        out[..first].copy_from_slice(&self.buffer[start..start + first]);
        if first < n {
            out[first..n].copy_from_slice(&self.buffer[..n - first]);
        }
        n
    }
}

/// Control-thread half: arms exactly one target and allocates storage.
pub struct RetrospectiveControl {
    commands: Producer<RetrospectiveCommand>,
    retired: Consumer<Box<[f32]>>,
    /// Last target handed to [`Self::arm`], or `None` after disarm.
    ///
    /// Mirrored here so a control thread can name the target without reading
    /// the capture callback's private state. The capture side is authoritative
    /// once it has drained the matching command.
    target_track_id: Option<usize>,
    /// Shared with the writer so [`Self::retained_samples`] can read what the
    /// last drained write left behind without locking.
    retained_samples: Arc<AtomicUsize>,
}

/// Capture-callback half: copies input when armed, retains nothing when not.
pub struct RetrospectiveWriter {
    commands: Consumer<RetrospectiveCommand>,
    retired: Producer<Box<[f32]>>,
    active: Option<ActiveRing>,
    /// Shared with the control half so [`RetrospectiveControl::retained_samples`]
    /// can read what the last drained write left behind without locking.
    retained_samples: Arc<AtomicUsize>,
}

/// Build the control and capture halves of a retrospective ring.
///
/// Both start disarmed. Arming on the control half allocates; the capture
/// half installs that storage the next time it writes (or when it drains
/// pending commands).
pub fn retrospective_capture() -> (RetrospectiveControl, RetrospectiveWriter) {
    let (commands_tx, commands_rx) = RingBuffer::new(COMMAND_CAPACITY);
    let (retired_tx, retired_rx) = RingBuffer::new(RETIRE_CAPACITY);
    let retained_samples = Arc::new(AtomicUsize::new(0));

    let control = RetrospectiveControl {
        commands: commands_tx,
        retired: retired_rx,
        target_track_id: None,
        retained_samples: Arc::clone(&retained_samples),
    };
    let writer = RetrospectiveWriter {
        commands: commands_rx,
        retired: retired_tx,
        active: None,
        retained_samples,
    };
    (control, writer)
}

impl RetrospectiveControl {
    /// Arm retention for exactly one track.
    ///
    /// Allocates sixty seconds at `sample_rate` × `channels` on this thread.
    /// A later arm replaces the previous target; it does not fan out.
    pub fn arm(&mut self, track_id: usize, sample_rate: f32, channels: usize) {
        self.drain_retired();

        if channels == 0 {
            self.disarm();
            return;
        }

        let frames = retrospective_capacity_frames(sample_rate);
        let samples = frames.saturating_mul(channels);
        if samples == 0 {
            self.disarm();
            return;
        }

        let buffer = vec![0.0f32; samples].into_boxed_slice();
        self.target_track_id = Some(track_id);
        if self
            .commands
            .push(RetrospectiveCommand::Arm {
                track_id,
                channels,
                buffer,
            })
            .is_err()
        {
            // The capture side has not drained; drop the allocation rather
            // than blocking the control thread on the audio callback.
            self.target_track_id = None;
        }
    }

    /// Stop retention. Later writes keep nothing.
    pub fn disarm(&mut self) {
        self.drain_retired();
        self.target_track_id = None;
        let _ = self.commands.push(RetrospectiveCommand::Disarm);
    }

    /// The track id last passed to [`Self::arm`], if still armed from this side.
    pub fn target_track_id(&self) -> Option<usize> {
        self.target_track_id
    }

    /// Interleaved samples the writer currently retains, published after each
    /// drained write. Zero while disarmed.
    pub fn retained_samples(&self) -> usize {
        self.retained_samples.load(Ordering::Relaxed)
    }

    fn drain_retired(&mut self) {
        while let Ok(buffer) = self.retired.pop() {
            drop(buffer);
        }
    }
}

impl Drop for RetrospectiveControl {
    fn drop(&mut self) {
        let _ = self.commands.push(RetrospectiveCommand::Disarm);
        self.drain_retired();
    }
}

impl RetrospectiveWriter {
    /// A writer nothing can arm — for seams that only exercise the device FIFO.
    pub fn inert() -> Self {
        retrospective_capture().1
    }

    /// Install pending arm/disarm commands, then copy `block` when armed.
    ///
    /// No heap allocation and no lock. A disarmed writer returns immediately.
    /// Channel mismatch refuses the block without retaining any of it.
    #[inline]
    pub fn write_block(&mut self, block: &[f32], channels: usize) {
        self.drain_commands();

        let Some(active) = self.active.as_mut() else {
            return;
        };

        if channels != active.channels || block.len() % active.channels != 0 {
            return;
        }

        active.write_block(block);
        self.retained_samples
            .store(active.filled, Ordering::Relaxed);
    }

    /// Whether the writer currently holds an armed ring.
    pub fn is_armed(&self) -> bool {
        self.active.is_some()
    }

    /// Track id of the armed ring, if any.
    pub fn target_track_id(&self) -> Option<usize> {
        self.active.as_ref().map(|ring| ring.track_id)
    }

    /// Interleaved samples currently retained.
    pub fn retained_samples(&self) -> usize {
        self.active.as_ref().map(|ring| ring.filled).unwrap_or(0)
    }

    /// Capacity in interleaved samples, or zero when disarmed.
    pub fn capacity_samples(&self) -> usize {
        self.active
            .as_ref()
            .map(|ring| ring.buffer.len())
            .unwrap_or(0)
    }

    /// Oldest-first copy of retained audio into `out`. Returns samples written.
    pub fn copy_retained(&self, out: &mut [f32]) -> usize {
        self.active
            .as_ref()
            .map(|ring| ring.copy_retained(out))
            .unwrap_or(0)
    }

    #[inline]
    fn drain_commands(&mut self) {
        while let Ok(command) = self.commands.pop() {
            match command {
                RetrospectiveCommand::Arm {
                    track_id,
                    channels,
                    buffer,
                } => {
                    if let Some(previous) = self.active.take() {
                        self.retire(previous.buffer);
                    }
                    self.active = Some(ActiveRing {
                        track_id,
                        channels,
                        buffer,
                        write_head: 0,
                        filled: 0,
                    });
                    self.retained_samples.store(0, Ordering::Relaxed);
                }
                RetrospectiveCommand::Disarm => {
                    if let Some(previous) = self.active.take() {
                        self.retire(previous.buffer);
                    }
                    self.retained_samples.store(0, Ordering::Relaxed);
                }
            }
        }
    }

    #[inline]
    fn retire(&mut self, buffer: Box<[f32]>) {
        if let Err(PushError::Full(buffer)) = self.retired.push(buffer) {
            // Retire ring full: the control thread is not draining. Dropping
            // here frees on the capture thread, which is the one failure the
            // ring capacity is sized to avoid in ordinary use.
            drop(buffer);
        }
    }
}

impl Drop for RetrospectiveWriter {
    fn drop(&mut self) {
        self.drain_commands();
        if let Some(active) = self.active.take() {
            drop(active.buffer);
        }
        while let Ok(command) = self.commands.pop() {
            match command {
                RetrospectiveCommand::Arm { buffer, .. } => drop(buffer),
                RetrospectiveCommand::Disarm => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        retrospective_capacity_frames, retrospective_capture, RetrospectiveWriter,
        RETROSPECTIVE_SECONDS,
    };

    const RATE: f32 = 100.0;
    const CHANNELS: usize = 2;

    fn arm_and_drain(
        control: &mut super::RetrospectiveControl,
        writer: &mut RetrospectiveWriter,
        track_id: usize,
    ) {
        control.arm(track_id, RATE, CHANNELS);
        // An empty write drains pending commands without retaining audio.
        writer.write_block(&[], CHANNELS);
    }

    #[test]
    fn armed_retrospective_capture_retains_input() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 7);

        assert!(writer.is_armed());
        assert_eq!(writer.target_track_id(), Some(7));

        let block = [0.25f32, -0.5, 0.75, -1.0];
        writer.write_block(&block, CHANNELS);

        assert_eq!(writer.retained_samples(), block.len());
        let mut out = [0.0f32; 4];
        assert_eq!(writer.copy_retained(&mut out), 4);
        assert_eq!(out, block);
    }

    #[test]
    fn armed_retrospective_capture_longer_than_sixty_seconds_stays_bounded_and_drops_oldest() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 1);

        let capacity = writer.capacity_samples();
        assert_eq!(
            capacity,
            retrospective_capacity_frames(RATE) * CHANNELS,
            "capacity must be exactly sixty seconds at the armed rate"
        );
        assert_eq!(
            capacity,
            (RATE as usize) * RETROSPECTIVE_SECONDS as usize * CHANNELS
        );

        // Distinct ramp so the oldest samples are identifiable once wrapped.
        let mut next = 1.0f32;
        let mut block = vec![0.0f32; CHANNELS];
        let frames_to_write = capacity / CHANNELS + 8;
        for _ in 0..frames_to_write {
            for sample in &mut block {
                *sample = next;
                next += 1.0;
            }
            writer.write_block(&block, CHANNELS);
        }

        assert_eq!(writer.retained_samples(), capacity);

        let mut retained = vec![0.0f32; capacity];
        assert_eq!(writer.copy_retained(&mut retained), capacity);

        // Eight frames past capacity overwrote the first sixteen samples
        // (1.0 … 16.0). The oldest retained sample is therefore 17.0.
        assert!(
            !retained.contains(&1.0) && !retained.contains(&2.0),
            "oldest frames must have been overwritten"
        );
        assert_eq!(retained[0], 17.0);
        // The newest frame is the last one written.
        let last = &retained[retained.len() - CHANNELS..];
        let expected_last = next - CHANNELS as f32;
        assert_eq!(last[0], expected_last);
        assert_eq!(last[1], expected_last + 1.0);
    }

    #[test]
    fn disarmed_retrospective_capture_write_retains_nothing() {
        let (_control, mut writer) = retrospective_capture();
        assert!(!writer.is_armed());

        writer.write_block(&[0.5, -0.5, 0.25, -0.25], CHANNELS);

        assert_eq!(writer.retained_samples(), 0);
        assert_eq!(writer.capacity_samples(), 0);
        let mut out = [1.0f32; 4];
        assert_eq!(writer.copy_retained(&mut out), 0);
    }

    #[test]
    fn later_arm_replaces_previous_retrospective_capture_target() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 3);
        writer.write_block(&[1.0, 1.0], CHANNELS);
        assert_eq!(writer.retained_samples(), 2);

        arm_and_drain(&mut control, &mut writer, 9);
        assert_eq!(writer.target_track_id(), Some(9));
        assert_eq!(writer.retained_samples(), 0);
        assert_eq!(control.target_track_id(), Some(9));
    }

    #[cfg(debug_assertions)]
    mod capture_alloc_guards {
        use super::*;
        use assert_no_alloc::assert_no_alloc;

        #[test]
        fn the_retrospective_capture_write_path_allocates_nothing() {
            let (mut control, mut writer) = retrospective_capture();
            arm_and_drain(&mut control, &mut writer, 1);

            let block = vec![0.125f32; CHANNELS * 16];
            let oversized_channels = CHANNELS + 1;
            let misaligned = vec![0.5f32; CHANNELS * 8 + 1];

            assert_no_alloc(|| {
                writer.write_block(&block, CHANNELS);
                writer.write_block(&block, oversized_channels);
                writer.write_block(&misaligned, CHANNELS);
                for _ in 0..64 {
                    writer.write_block(&block, CHANNELS);
                }
            });

            assert!(writer.retained_samples() > 0);
            assert!(writer.retained_samples() <= writer.capacity_samples());
        }
    }
}
