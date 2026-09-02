//! The capture ring: what the input device's callback writes and the audio
//! owner thread's callback reads.
//!
//! # Buffer and latency contract
//!
//! **What the ring holds.** Interleaved `f32` exactly as the input device
//! delivers it — no deinterleave, no format conversion, no rate conversion.
//! Capacity is decided when the input stream opens and never changes: the
//! writer runs on the capture thread and the reader on the audio thread, and
//! neither may allocate.
//!
//! **What refuses.** Input and output are opened at one rate. A device whose
//! rate is not the engine's is refused at open
//! ([`crate::device::InputOpenRefusal::SampleRateMismatch`]) and reported
//! through the engine's existing stream-error route. The engine never
//! resamples capture: a resampler on the record path is a pitch and phase
//! decision the musician did not make. Past the open, input and output are
//! independent clocks that drift against each other; the ring's slack absorbs
//! the drift and the counters below record what it cost, because the
//! alternative — resampling to hold them together — is the thing this crate
//! refuses to do.
//!
//! **The settle law.** Mirrored from [`crate::audio_bridge`], because the
//! shape of the problem is the same: a producer and a consumer on cadences
//! nothing locks together, and a depth that only ever grows if left alone.
//! Capacity spans the largest callback the engine accepts plus four input
//! periods of slack; the depth the ring settles at covers the output period
//! twice over plus a period of slack either side, clamped to what the ring
//! holds. The reader fills to that depth before it hands anything out, then
//! takes exactly one output period per callback. A depth above the target
//! after a take is drift the reader shortens by one input period per pass —
//! processed nowhere, counted here — so capture latency settles at the target
//! instead of ratcheting up to the ring's capacity and staying there.
//!
//! **What the latency figure means.** [`CaptureShape::latency_frames`] is the
//! input period plus the settled depth: the frames between a sample arriving
//! at the device and the same sample leaving [`CaptureRingReader::read_into`].
//! It is the *settled* figure, and it is fixed at open — the depth depends on
//! the two periods and nothing the callback measures — so a control thread
//! reads it once and it stays true for the life of the stream.
//!
//! **What is counted.** Input blocks the writer refused because the ring was
//! full, reads that could not fill a whole output period after the ring had
//! settled, and samples the reader discarded to hold the settled depth. Every
//! sample this path loses is one of those three, and each is an atomic the
//! control side reads.

use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::audio_thread::MAX_CALLBACK_FRAMES;

/// Input periods of slack the ring carries above the largest callback the
/// engine accepts. Mirrors the four blocks [`crate::audio_bridge`] carries,
/// for the same reason: ordinary jitter must not reach the refusal path.
const RING_SLACK_PERIODS: usize = 4;

/// The facts an input open settled, in the units the ring works in.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CaptureShape {
    /// Frames the input device delivers per capture callback.
    pub input_period_frames: usize,
    /// Frames the output device asks the render callback for per period.
    pub output_period_frames: usize,
    /// Interleaved channels each captured frame carries.
    pub channels: usize,
}

impl CaptureShape {
    /// Input periods the ring holds.
    ///
    /// Sized from the largest callback the engine accepts rather than from
    /// the negotiated output period, so a device that hands back a longer
    /// block than the engine asked for still fits.
    pub const fn ring_periods(self) -> usize {
        MAX_CALLBACK_FRAMES.div_ceil(self.period()) + RING_SLACK_PERIODS
    }

    /// Input periods the ring settles at — the law of
    /// [`crate::audio_bridge::target_depth_blocks`], in input periods.
    ///
    /// The clamp keeps the target meaningful: a target above what the ring
    /// holds could never be crossed, and a depth that never crosses its
    /// target is the ratchet the shed exists to stop.
    pub const fn target_depth_periods(self) -> usize {
        let periods_per_output = self.output_period_frames.div_ceil(self.period());
        let target = periods_per_output * 2 + 2;
        let capacity = self.ring_periods();
        if target > capacity {
            capacity
        } else {
            target
        }
    }

    /// Frames of latency the capture path adds: the period the device is
    /// filling, plus the depth the ring settles at.
    pub const fn latency_frames(self) -> usize {
        self.period() + self.target_depth_periods() * self.period()
    }

    const fn period(self) -> usize {
        // A zero period is refused at the seam; keeping the arithmetic total
        // means a defensive caller gets a small ring rather than a panic on
        // the thread that owns the stream.
        if self.input_period_frames == 0 {
            1
        } else {
            self.input_period_frames
        }
    }

    const fn interleaved(self, frames: usize) -> usize {
        frames * if self.channels == 0 { 1 } else { self.channels }
    }
}

/// What the capture path lost, and where.
///
/// Written from the capture thread and the audio thread with relaxed
/// read-modify-writes — wait-free, allocation-free, and ordered against
/// nothing, because a count is only ever read for what it says about the
/// session as a whole.
#[derive(Debug, Default)]
pub struct CaptureCounters {
    blocks_refused: AtomicU64,
    underruns: AtomicU64,
    samples_shed: AtomicU64,
}

impl CaptureCounters {
    /// Input blocks the device delivered and the ring could not hold.
    pub fn blocks_refused(&self) -> u64 {
        self.blocks_refused.load(Ordering::Relaxed)
    }

    /// Reads that could not fill a whole output period once the ring had
    /// settled. Startup fill is not counted here: it is the settle, not a
    /// shortfall.
    pub fn underruns(&self) -> u64 {
        self.underruns.load(Ordering::Relaxed)
    }

    /// Samples discarded to hold the ring at its settled depth — the price of
    /// two independent clocks that the engine will not pay with a resampler.
    pub fn samples_shed(&self) -> u64 {
        self.samples_shed.load(Ordering::Relaxed)
    }
}

/// The capture thread's end of the ring.
pub struct CaptureRingWriter {
    producer: Producer<f32>,
    counters: Arc<CaptureCounters>,
    channels: usize,
}

impl CaptureRingWriter {
    /// Write one input block, or refuse it whole.
    ///
    /// Whole blocks, never partial ones: a half-written block splices the
    /// remainder of a device period into the next one, which reads downstream
    /// as audio that arrived rather than as audio that was lost.
    ///
    /// `channels` travels with the block, as it does on the render side, so a
    /// device-invalidation recovery that resumes this callback on a different
    /// layout is refused rather than written into a ring shaped for the old
    /// one.
    #[inline]
    pub fn write_block(&mut self, block: &[f32], channels: usize) {
        if channels != self.channels || self.producer.push_entire_slice(block).is_err() {
            self.counters.blocks_refused.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// The audio thread's end of the ring.
pub struct CaptureRingReader {
    consumer: Consumer<f32>,
    counters: Arc<CaptureCounters>,
    shape: CaptureShape,
    target_depth_samples: usize,
    input_period_samples: usize,
    settled: bool,
}

impl CaptureRingReader {
    /// Fill `out` with the next output period of captured audio, or report
    /// that this callback has none.
    ///
    /// Nothing is handed out until the ring has first reached its settled
    /// depth, so the very first blocks a device delivers become the slack the
    /// rest of the session runs on rather than audio that immediately
    /// underruns.
    #[inline]
    pub fn read_into(&mut self, out: &mut [f32]) -> bool {
        if !self.settled {
            if self.consumer.slots() < self.target_depth_samples {
                return false;
            }
            self.settled = true;
        }

        if self.consumer.pop_entire_slice(out).is_err() {
            self.counters.underruns.fetch_add(1, Ordering::Relaxed);
            return false;
        }

        self.shed_above_target();
        true
    }

    /// Frames of latency this reader's ring adds — the published figure.
    pub const fn latency_frames(&self) -> usize {
        self.shape.latency_frames()
    }

    /// The counters this ring publishes, for a control thread to read.
    pub fn counters(&self) -> &Arc<CaptureCounters> {
        &self.counters
    }

    /// Shorten a ring that has drifted above its settled depth by one input
    /// period, the way the bridge sheds one block per pass: a drift correction
    /// spread over successive callbacks, never a jump that takes a whole
    /// device period of audio out at once.
    #[inline]
    fn shed_above_target(&mut self) {
        let depth = self.consumer.slots();
        if depth <= self.target_depth_samples {
            return;
        }

        let excess = (depth - self.target_depth_samples).min(self.input_period_samples);
        let Ok(chunk) = self.consumer.read_chunk(excess) else {
            return;
        };
        chunk.commit_all();
        self.counters
            .samples_shed
            .fetch_add(excess as u64, Ordering::Relaxed);
    }
}

/// Build the ring an input stream writes and the render callback reads.
///
/// Every allocation the capture path will ever make happens here, on the
/// thread that opens the stream.
pub fn capture_ring(shape: CaptureShape) -> (CaptureRingWriter, CaptureRingReader) {
    let counters = Arc::new(CaptureCounters::default());
    let capacity = shape.interleaved(shape.ring_periods() * shape.input_period_frames);
    let (producer, consumer) = RingBuffer::new(capacity);

    let writer = CaptureRingWriter {
        producer,
        counters: Arc::clone(&counters),
        channels: shape.channels,
    };
    let reader = CaptureRingReader {
        consumer,
        counters,
        shape,
        target_depth_samples: shape
            .interleaved(shape.target_depth_periods() * shape.input_period_frames),
        input_period_samples: shape.interleaved(shape.input_period_frames),
        settled: false,
    };

    (writer, reader)
}

#[cfg(test)]
mod tests {
    use super::{capture_ring, CaptureShape};
    use crate::audio_bridge::target_depth_blocks;

    const SHAPE: CaptureShape = CaptureShape {
        input_period_frames: 128,
        output_period_frames: 512,
        channels: 2,
    };

    fn block(frames: usize) -> Vec<f32> {
        vec![0.5; frames * SHAPE.channels]
    }

    #[test]
    fn the_settled_depth_follows_the_bridge_law_in_input_periods() {
        // Same arithmetic as the round trip the plugin bridge settles at,
        // with the input period standing where the render quantum stands.
        assert_eq!(SHAPE.target_depth_periods(), target_depth_blocks(512));
        assert_eq!(
            SHAPE.latency_frames(),
            SHAPE.input_period_frames * (SHAPE.target_depth_periods() + 1)
        );
    }

    #[test]
    fn capture_ring_refuses_when_full_and_counts_the_refusal() {
        let (mut writer, reader) = capture_ring(SHAPE);
        let input = block(SHAPE.input_period_frames);

        // Nothing reads, so the ring fills and then has to say so.
        for _ in 0..SHAPE.ring_periods() {
            writer.write_block(&input, SHAPE.channels);
        }
        assert_eq!(reader.counters().blocks_refused(), 0);

        writer.write_block(&input, SHAPE.channels);
        assert_eq!(reader.counters().blocks_refused(), 1);
    }

    #[test]
    fn a_block_whose_layout_is_not_the_ring_s_is_refused_whole() {
        let (mut writer, reader) = capture_ring(SHAPE);

        writer.write_block(&block(SHAPE.input_period_frames), SHAPE.channels + 1);

        assert_eq!(reader.counters().blocks_refused(), 1);
    }

    #[test]
    fn capture_ring_settles_at_its_target_depth_rather_than_ratcheting() {
        let (mut writer, mut reader) = capture_ring(SHAPE);
        let input = block(SHAPE.input_period_frames);
        let mut out = vec![0.0; SHAPE.output_period_frames * SHAPE.channels];
        let target_samples =
            SHAPE.target_depth_periods() * SHAPE.input_period_frames * SHAPE.channels;

        // A writer running faster than the reader is the drift no resampler
        // absorbs here: five input periods pushed for every four the reader
        // takes. Left alone the ring climbs to capacity and stays there, and
        // every captured sample arrives a full ring later than it was played.
        for _ in 0..200 {
            for _ in 0..5 {
                writer.write_block(&input, SHAPE.channels);
            }
            reader.read_into(&mut out);
        }

        let depth = reader.consumer.slots();
        assert!(
            depth <= target_samples,
            "capture ring settled at {depth} samples against a target of {target_samples}"
        );
        assert!(
            reader.counters().samples_shed() > 0,
            "holding the depth against a fast writer has to be counted"
        );
        assert_eq!(
            reader.counters().blocks_refused(),
            0,
            "a ring held at its target never reaches the refusal path"
        );
    }

    #[test]
    fn a_read_short_of_a_period_underruns_only_once_the_ring_has_settled() {
        let (mut writer, mut reader) = capture_ring(SHAPE);
        let input = block(SHAPE.input_period_frames);
        let mut out = vec![0.0; SHAPE.output_period_frames * SHAPE.channels];

        // Below the settle depth the reader hands nothing out and counts
        // nothing: filling is not a shortfall.
        assert!(!reader.read_into(&mut out));
        assert_eq!(reader.counters().underruns(), 0);

        for _ in 0..SHAPE.target_depth_periods() {
            writer.write_block(&input, SHAPE.channels);
        }
        assert!(reader.read_into(&mut out));
        assert_eq!(reader.counters().underruns(), 0);

        // Settled and starved: now a short ring is a shortfall, counted once
        // for the read that could not be served.
        while reader.read_into(&mut out) {}
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn what_the_device_wrote_is_what_the_reader_hands_out() {
        let shape = CaptureShape {
            input_period_frames: 4,
            output_period_frames: 4,
            channels: 2,
        };
        let (mut writer, mut reader) = capture_ring(shape);
        let mut out = [0.0f32; 8];

        let mut written = 0.0;
        for _ in 0..shape.target_depth_periods() {
            let period: Vec<f32> = (0..8)
                .map(|_| {
                    written += 1.0;
                    written
                })
                .collect();
            writer.write_block(&period, shape.channels);
        }

        assert!(reader.read_into(&mut out));
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    }

    /// The allocation guard for the two callbacks on the capture path.
    ///
    /// Both run on real-time threads — the device's capture thread writes and
    /// the audio thread reads — so ADR 0020 forbids either to allocate or
    /// free. The interceptor is installed as the test binary's global
    /// allocator by the scheduler's own guards and exists only in debug
    /// builds (`assert_no_alloc`'s `disable_release` feature is on by
    /// default, so in release `assert_no_alloc(f)` is literally `f()`), which
    /// is why this module is `#[cfg(debug_assertions)]`.
    #[cfg(debug_assertions)]
    mod capture_alloc_guards {
        use super::*;
        use assert_no_alloc::assert_no_alloc;

        #[test]
        fn the_capture_callback_allocates_nothing() {
            let (mut writer, mut reader) = capture_ring(SHAPE);
            let input = block(SHAPE.input_period_frames);
            let mut out = vec![0.0; SHAPE.output_period_frames * SHAPE.channels];

            assert_no_alloc(|| {
                // Every arm of both callbacks: the write that fits, the write
                // the full ring refuses, the read below the settle depth, the
                // read that fills, the read that underruns, and the shed that
                // holds the depth.
                for _ in 0..SHAPE.ring_periods() + 2 {
                    writer.write_block(&input, SHAPE.channels);
                }
                writer.write_block(&input, SHAPE.channels + 1);
                for _ in 0..8 {
                    reader.read_into(&mut out);
                }
            });

            assert!(reader.counters().blocks_refused() > 0);
            assert!(reader.counters().samples_shed() > 0);
            assert!(reader.counters().underruns() > 0);
        }
    }
}
