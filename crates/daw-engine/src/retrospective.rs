//! Retrospective audio retention: about sixty seconds, one explicit target,
//! gated on arming.
//!
//! This is not the device-input FIFO in [`crate::capture`]. That ring is
//! latency slack between the input callback and the render callback. This
//! module keeps a separate rolling buffer of recent input so a performance
//! played before record can be recovered. Storage is allocated on the control
//! thread when armed; the capture callback only copies into it.

use rtrb::{Consumer, Producer, PushError, RingBuffer};
use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// Seconds of interleaved audio retained while the ring is armed.
pub const RETROSPECTIVE_SECONDS: u32 = 60;

/// Channel counts a retrospective ring may be armed with.
///
/// The ring is stereo by convention: punch arms two channels, and a device
/// delivering more is narrowed to the armed width on the capture callback
/// ([`RetrospectiveWriter::write_block`]). The upper bound also bounds the
/// allocation an arm makes, so a caller-supplied count can never size sixty
/// seconds of storage past what the host can hold.
pub const RETROSPECTIVE_CHANNEL_RANGE: RangeInclusive<usize> = 1..=2;

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

    /// Copy the first `self.channels` samples of every `in_channels`-wide
    /// frame, dropping the rest. Writes only inside `buffer` (wrapping at
    /// capacity), so a wider device never grows the armed allocation.
    fn write_leading_channels(&mut self, block: &[f32], in_channels: usize) {
        let out_channels = self.channels;
        if out_channels == 0 || in_channels < out_channels {
            return;
        }

        for frame in block.chunks_exact(in_channels) {
            self.write_block(&frame[..out_channels]);
        }
    }

    /// Copy a mono block into this wider ring by repeating each sample across
    /// every armed channel. Writes only inside `buffer` (wrapping at capacity).
    fn write_mono_upmix(&mut self, mono: &[f32]) {
        let capacity = self.buffer.len();
        let out_channels = self.channels;
        if capacity == 0 || mono.is_empty() || out_channels == 0 {
            return;
        }

        for &sample in mono {
            for _ in 0..out_channels {
                self.buffer[self.write_head] = sample;
                self.write_head = (self.write_head + 1) % capacity;
                self.filled = (self.filled + 1).min(capacity);
            }
        }
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
    ///
    /// A `channels` outside [`RETROSPECTIVE_CHANNEL_RANGE`], or a window whose
    /// sample count does not fit `usize`, disarms rather than declining: the
    /// caller asked to stop retaining under whatever it armed before, and a
    /// previous target left in place would keep recording for a request that
    /// was refused.
    pub fn arm(&mut self, track_id: usize, sample_rate: f32, channels: usize) {
        self.drain_retired();

        if !RETROSPECTIVE_CHANNEL_RANGE.contains(&channels) {
            self.disarm();
            return;
        }

        let frames = retrospective_capacity_frames(sample_rate);
        let Some(samples) = frames.checked_mul(channels).filter(|&samples| samples > 0) else {
            self.disarm();
            return;
        };

        // Keep one command slot free so [`Self::disarm`] can always deliver.
        // Filling the ring with Arms used to drop Disarm while this side still
        // claimed stopped.
        if self.commands.slots() < 2 {
            return;
        }

        let buffer = vec![0.0f32; samples].into_boxed_slice();
        match self.commands.push(RetrospectiveCommand::Arm {
            track_id,
            channels,
            buffer,
        }) {
            Ok(()) => self.target_track_id = Some(track_id),
            // Capture side has not drained; drop the allocation rather than
            // blocking the control thread. Leave any prior target in place —
            // those Arms are still queued.
            Err(PushError::Full(_)) => {}
        }
    }

    /// Stop retention. Later writes keep nothing.
    ///
    /// Clears [`Self::target_track_id`] only when Disarm is queued. A full
    /// command ring must not claim stopped while the writer may still retain.
    pub fn disarm(&mut self) {
        self.drain_retired();
        if self.commands.push(RetrospectiveCommand::Disarm).is_ok() {
            self.target_track_id = None;
        }
    }

    /// Push a disarm without draining the retire ring — test-only, so a full
    /// retire ring can be observed on the capture callback without the control
    /// side emptying it first.
    #[cfg(test)]
    fn push_disarm_leaving_retired(&mut self) {
        if self.commands.push(RetrospectiveCommand::Disarm).is_ok() {
            self.target_track_id = None;
        }
    }

    /// Push an Arm without the disarm-slot reserve or retire drain — test-only,
    /// so a writer drain can fill the retire ring exactly.
    #[cfg(test)]
    fn push_arm_leaving_retired(&mut self, track_id: usize, channels: usize, samples: usize) {
        let buffer = vec![0.0f32; samples.max(1)].into_boxed_slice();
        if self
            .commands
            .push(RetrospectiveCommand::Arm {
                track_id,
                channels,
                buffer,
            })
            .is_ok()
        {
            self.target_track_id = Some(track_id);
        }
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
    /// Matching channel counts copy as-is. A block wider than the armed ring
    /// (a four- or eight-input interface into the stereo punch ring) keeps the
    /// first armed-width channels of each frame, in place. A mono block into a
    /// wider armed ring is retained by repeating each sample across the armed
    /// channels. A block whose length is not a whole number of frames, and any
    /// other channel mismatch, is refused rather than written past capacity.
    #[inline]
    pub fn write_block(&mut self, block: &[f32], channels: usize) {
        self.drain_commands();

        let Some(active) = self.active.as_mut() else {
            return;
        };

        if channels == 0 || block.len() % channels != 0 {
            return;
        }

        if channels == active.channels {
            active.write_block(block);
            self.retained_samples
                .store(active.filled, Ordering::Relaxed);
            return;
        }

        if channels > active.channels {
            active.write_leading_channels(block, channels);
            self.retained_samples
                .store(active.filled, Ordering::Relaxed);
            return;
        }

        // Punch arms stereo by convention while the device may deliver mono.
        // Upmix in-place; never grow the armed allocation.
        if channels == 1 && active.channels > 1 {
            active.write_mono_upmix(block);
            self.retained_samples
                .store(active.filled, Ordering::Relaxed);
            return;
        }
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
            // Retire ring full: the control thread is not draining. Freeing
            // here would run the allocator on the capture callback (ADR 0020).
            // Forget instead — a leak under a full ring is the degradation the
            // capacity is sized to make unreachable in ordinary use.
            std::mem::forget(buffer);
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
        COMMAND_CAPACITY, RETROSPECTIVE_SECONDS,
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
    fn mono_input_is_retained_in_a_stereo_armed_retrospective_ring() {
        let (mut control, mut writer) = retrospective_capture();
        // Punch arms stereo (`DEFAULT_RETROSPECTIVE_CHANNELS = 2`) while the
        // capture callback may deliver mono (`negotiated.channels == 1`).
        control.arm(1, RATE, 2);
        writer.write_block(&[], 2);
        assert!(writer.is_armed());
        assert_eq!(writer.retained_samples(), 0);

        let mono = [0.5f32, -0.25, 0.125];
        writer.write_block(&mono, 1);

        assert_eq!(
            writer.retained_samples(),
            mono.len() * 2,
            "mono frames must be retained as stereo-upmixed interleaved samples"
        );
        let mut out = [0.0f32; 6];
        assert_eq!(writer.copy_retained(&mut out), 6);
        assert_eq!(out, [0.5, 0.5, -0.25, -0.25, 0.125, 0.125]);
    }

    /// Three frames of a four-input interface: channel `c` of frame `f` is
    /// `f * 10 + c`, so the retained order names exactly which samples were kept.
    const FOUR_CHANNEL_FRAMES: [f32; 12] = [
        0.0, 1.0, 2.0, 3.0, //
        10.0, 11.0, 12.0, 13.0, //
        20.0, 21.0, 22.0, 23.0,
    ];

    /// What a stereo ring keeps of [`FOUR_CHANNEL_FRAMES`]: channels 0 and 1
    /// of every frame, in frame order.
    const LEADING_STEREO_OF_FOUR: [f32; 6] = [0.0, 1.0, 10.0, 11.0, 20.0, 21.0];

    #[test]
    fn wider_input_than_armed_channels_keeps_the_leading_armed_channels() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 1);
        let capacity = writer.capacity_samples();

        writer.write_block(&FOUR_CHANNEL_FRAMES, 4);

        assert_eq!(writer.retained_samples(), LEADING_STEREO_OF_FOUR.len());
        let mut out = [0.0f32; 6];
        assert_eq!(writer.copy_retained(&mut out), 6);
        assert_eq!(out, LEADING_STEREO_OF_FOUR);
        assert_eq!(
            writer.capacity_samples(),
            capacity,
            "a wider device must never grow the armed allocation"
        );
    }

    #[test]
    fn wider_input_whose_length_is_not_whole_frames_is_refused() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 1);

        writer.write_block(&FOUR_CHANNEL_FRAMES[..11], 4);

        assert_eq!(writer.retained_samples(), 0);
    }

    #[test]
    fn an_arm_outside_the_supported_channel_range_retains_nothing() {
        for channels in [0, 3, usize::MAX] {
            let (mut control, mut writer) = retrospective_capture();
            control.arm(1, RATE, channels);
            writer.write_block(&[], channels.min(4));

            assert!(
                !writer.is_armed(),
                "{channels} channels is outside the supported range and must not arm"
            );
            assert_eq!(control.target_track_id(), None);

            writer.write_block(&[0.5; 12], 3);
            assert_eq!(writer.retained_samples(), 0);
            assert_eq!(writer.capacity_samples(), 0);
        }
    }

    #[test]
    fn an_out_of_range_arm_disarms_the_previous_target() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 1);
        assert!(writer.is_armed());

        control.arm(2, RATE, 3);
        writer.write_block(&[], CHANNELS);

        assert!(!writer.is_armed());
        assert_eq!(control.target_track_id(), None);
    }

    #[test]
    fn full_command_ring_then_disarm_leaves_writer_not_retaining() {
        let (mut control, mut writer) = retrospective_capture();

        // Eight undrained Arms used to fill every command slot so Disarm was
        // dropped while control still cleared its target.
        for track_id in 0..COMMAND_CAPACITY {
            control.arm(track_id, RATE, CHANNELS);
        }
        control.disarm();
        writer.write_block(&[], CHANNELS);

        assert!(
            !writer.is_armed(),
            "disarm must reach the writer even after a burst of undrained arms"
        );
        assert_eq!(writer.retained_samples(), 0);
        assert_eq!(control.target_track_id(), None);
    }

    #[test]
    fn disarm_that_cannot_be_queued_does_not_claim_stopped() {
        let (mut control, mut writer) = retrospective_capture();
        arm_and_drain(&mut control, &mut writer, 1);

        // Saturate the command ring, bypassing the disarm-slot reserve.
        for track_id in 0..COMMAND_CAPACITY {
            control.push_arm_leaving_retired(10 + track_id, CHANNELS, CHANNELS * 4);
        }
        assert_eq!(control.target_track_id(), Some(10 + COMMAND_CAPACITY - 1));

        control.disarm();

        assert_eq!(
            control.target_track_id(),
            Some(10 + COMMAND_CAPACITY - 1),
            "control must not claim stopped when Disarm could not be queued"
        );
        writer.write_block(&[], CHANNELS);
        assert!(
            writer.is_armed(),
            "without a delivered Disarm the writer stays armed on the last queued track"
        );
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
            let mono = vec![0.25f32; 16];
            let oversized_channels = CHANNELS + 1;
            let misaligned = vec![0.5f32; CHANNELS * 8 + 1];

            // Re-arm on the control side (may allocate) so the next write
            // drains an Arm and enters `retire` — a free there must fail this
            // guard. Without that drain the previous write-only loop never
            // retired anything and stayed green over a capture-callback free.
            control.arm(2, RATE, CHANNELS);

            assert_no_alloc(|| {
                writer.write_block(&block, CHANNELS);
                writer.write_block(&mono, 1);
                writer.write_block(&block, oversized_channels);
                writer.write_block(&misaligned, CHANNELS);
                for _ in 0..64 {
                    writer.write_block(&block, CHANNELS);
                }
            });

            assert!(writer.retained_samples() > 0);
            assert!(writer.retained_samples() <= writer.capacity_samples());
            assert_eq!(writer.target_track_id(), Some(2));
        }

        #[test]
        fn the_wide_input_write_path_keeps_the_leading_channels_and_allocates_nothing() {
            let (mut control, mut writer) = retrospective_capture();
            arm_and_drain(&mut control, &mut writer, 1);

            assert_no_alloc(|| {
                writer.write_block(&FOUR_CHANNEL_FRAMES, 4);
            });

            let mut out = [0.0f32; 6];
            assert_eq!(writer.copy_retained(&mut out), 6);
            assert_eq!(out, LEADING_STEREO_OF_FOUR);
        }

        #[test]
        fn an_out_of_range_arm_allocates_nothing() {
            let (mut control, mut writer) = retrospective_capture();

            assert_no_alloc(|| {
                control.arm(1, RATE, 3);
                control.arm(1, RATE, usize::MAX);
            });

            writer.write_block(&[], CHANNELS);
            assert!(!writer.is_armed());
        }

        #[test]
        fn a_full_retire_ring_does_not_free_on_the_capture_callback() {
            let (mut control, mut writer) = retrospective_capture();
            arm_and_drain(&mut control, &mut writer, 1);

            // Queue replaces up to the disarm-slot reserve, then one more Arm
            // that skips the reserve so one writer drain fills retire exactly.
            for track_id in 2..=COMMAND_CAPACITY {
                control.arm(track_id, RATE, CHANNELS);
            }
            control.push_arm_leaving_retired(
                1 + COMMAND_CAPACITY,
                CHANNELS,
                retrospective_capacity_frames(RATE) * CHANNELS,
            );
            writer.write_block(&[], CHANNELS);
            assert_eq!(writer.target_track_id(), Some(1 + COMMAND_CAPACITY));

            // Disarm without the control side draining retired first: the
            // capture callback's retire finds a full ring. Freeing that Box
            // here fails the guard; forgetting keeps it green.
            control.push_disarm_leaving_retired();
            assert_no_alloc(|| {
                writer.write_block(&[], CHANNELS);
            });
            assert!(!writer.is_armed());
        }
    }
}
