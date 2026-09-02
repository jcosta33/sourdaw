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
//! A block the writer cannot interpret is refused whole rather than written
//! in part: one whose channel count is not the ring's, and one whose length is
//! not a whole number of frames. Writing a partial frame would rotate which
//! channel every later sample belongs to for the rest of the session, which is
//! silent corruption rather than counted loss. A block merely longer or
//! shorter than the nominal period is *not* refused — the ring is a sample
//! FIFO, and absorbing a device that jitters its block size is what it is for.
//!
//! **The settle law.** Mirrored from [`crate::audio_bridge`], because the
//! shape of the problem is the same: a producer and a consumer on cadences
//! nothing locks together, and a depth that only ever grows if left alone. The
//! depth the ring settles at covers the output period twice over plus a period
//! of slack either side. The reader fills to that depth before it hands
//! anything out, then takes exactly one output period per callback. A depth
//! above the target after a take is drift the reader shortens by one input
//! period per pass — processed nowhere, counted here — so capture latency
//! settles at the target instead of ratcheting up to the ring's capacity and
//! staying there.
//!
//! **Why capacity follows the target.** The ring holds the settled depth, a
//! whole output period on top of it, and slack besides. Both terms are load
//! bearing. The reader takes an output period whole or not at all, so a ring
//! that cannot hold the depth it settles at *plus* one of those reads can
//! never serve one and underruns for the life of the stream. Sizing from the
//! largest callback the engine accepts is not enough on its own, because an
//! output period above that limit is a shape the engine really runs: a device
//! whose whole advertised buffer range sits above the limit is opened on its
//! own default period
//! (see [`crate::audio_thread::negotiated_buffer_size`]). Capacity is
//! therefore derived from the target rather than clamping the target to fit
//! capacity — a target clamped to what the ring holds is a target the shed can
//! never act on, which is the ratchet the shed exists to stop.
//!
//! **After a stall.** An underrun drops the reader back to unsettled, so it
//! refills to the target before serving again. A reader that kept taking
//! whatever happened to be there would run at the ring's floor for the rest of
//! the session while still publishing the settled latency figure below.
//!
//! **What the latency figure means.** [`CaptureShape::latency_frames`] is the
//! input period plus the settled depth: the frames between a sample arriving
//! at the device and the same sample leaving [`CaptureRingReader::read_into`].
//! It is the *settled* figure, and it is fixed at open — the depth depends on
//! the two periods and nothing the callback measures — so a control thread
//! reads it once and it stays true for the life of the stream.
//!
//! **What is counted.** Input blocks the writer refused, whether because the
//! ring was full or because the block's layout was not the ring's; reads that
//! could not fill a whole output period after the ring had settled; and
//! samples the reader discarded to hold the settled depth. Every sample this
//! path loses is one of those three, and each is an atomic the control side
//! reads.

use rtrb::{Consumer, Producer, RingBuffer};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::audio_thread::MAX_CALLBACK_FRAMES;

/// Input periods of slack the ring carries above what the settle law needs.
/// Mirrors the four blocks [`crate::audio_bridge`] carries, for the same
/// reason: ordinary jitter must not reach the refusal path.
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
    /// Input periods one read takes.
    pub const fn read_periods(self) -> usize {
        self.output_period_frames.div_ceil(self.period())
    }

    /// Input periods the ring settles at — the law of
    /// [`crate::audio_bridge::target_depth_blocks`], in input periods.
    pub const fn target_depth_periods(self) -> usize {
        self.read_periods() * 2 + 2
    }

    /// Input periods the ring holds.
    pub const fn ring_periods(self) -> usize {
        let holding = self.target_depth_periods() + self.read_periods() + RING_SLACK_PERIODS;
        let spanning = MAX_CALLBACK_FRAMES.div_ceil(self.period()) + RING_SLACK_PERIODS;
        if holding > spanning {
            holding
        } else {
            spanning
        }
    }

    /// Frames of latency the capture path adds: the period the device is
    /// filling, plus the depth the ring settles at.
    pub const fn latency_frames(self) -> usize {
        self.period() + self.target_depth_periods() * self.period()
    }

    /// The input period every calculation here works in.
    ///
    /// A zero period is refused at the seam. Standing it up as one frame keeps
    /// the arithmetic total, so a defensive caller gets a small usable ring
    /// rather than a zero-capacity one on the thread that owns the stream.
    const fn period(self) -> usize {
        if self.input_period_frames == 0 {
            1
        } else {
            self.input_period_frames
        }
    }

    /// The interleaved channel count every calculation here works in, on the
    /// same footing as [`Self::period`].
    const fn lanes(self) -> usize {
        if self.channels == 0 {
            1
        } else {
            self.channels
        }
    }

    const fn interleaved(self, frames: usize) -> usize {
        frames * self.lanes()
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
    /// Input blocks the writer refused: the ring could not hold them, or their
    /// layout was not the ring's.
    pub fn blocks_refused(&self) -> u64 {
        self.blocks_refused.load(Ordering::Relaxed)
    }

    /// Reads that could not fill a whole output period once the ring had
    /// settled. Startup fill, and the refill after a stall, are not counted
    /// here: filling is not a shortfall.
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
    /// one. A length that is not a whole number of frames is refused for the
    /// stronger reason: writing it would rotate every later sample's channel.
    #[inline]
    pub fn write_block(&mut self, block: &[f32], channels: usize) {
        if channels != self.channels
            || block.len() % self.channels != 0
            || self.producer.push_entire_slice(block).is_err()
        {
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
            // Rebuild the slack before serving again. Carrying on from
            // whatever survived the stall would leave the reader running at
            // the ring's floor while still publishing the settled latency.
            self.settled = false;
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
    let capacity = shape.interleaved(shape.ring_periods() * shape.period());
    let (producer, consumer) = RingBuffer::new(capacity);

    let writer = CaptureRingWriter {
        producer,
        counters: Arc::clone(&counters),
        channels: shape.lanes(),
    };
    let reader = CaptureRingReader {
        consumer,
        counters,
        shape,
        target_depth_samples: shape.interleaved(shape.target_depth_periods() * shape.period()),
        input_period_samples: shape.interleaved(shape.period()),
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

    /// Output periods the engine really runs that sit above the largest
    /// callback it accepts: a device whose whole advertised range is above the
    /// limit keeps its own default period.
    const LONG_OUTPUT_SHAPES: [CaptureShape; 2] = [
        CaptureShape {
            input_period_frames: 128,
            output_period_frames: 4096,
            channels: 2,
        },
        CaptureShape {
            input_period_frames: 128,
            output_period_frames: 6144,
            channels: 2,
        },
    ];

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
    fn the_ring_holds_its_settled_depth_and_a_whole_read() {
        // The reader takes an output period whole or not at all, so a ring
        // that cannot hold the settled depth and one of those reads at the
        // same time can never serve one.
        for shape in [SHAPE, LONG_OUTPUT_SHAPES[0], LONG_OUTPUT_SHAPES[1]] {
            let capacity = shape.ring_periods() * shape.input_period_frames;
            let needed = shape.target_depth_periods() * shape.input_period_frames
                + shape.output_period_frames;
            assert!(
                capacity >= needed,
                "an output period of {} frames needs {needed} frames of ring, sized at {capacity}",
                shape.output_period_frames
            );
        }
    }

    #[test]
    fn an_output_period_above_the_callback_limit_still_settles_and_sheds() {
        for shape in LONG_OUTPUT_SHAPES {
            let (mut writer, mut reader) = capture_ring(shape);
            let input = vec![0.5f32; shape.input_period_frames * shape.channels];
            let mut out = vec![0.0; shape.output_period_frames * shape.channels];
            let writes_per_read = shape.output_period_frames / shape.input_period_frames + 1;

            let mut served = 0;
            for _ in 0..400 {
                for _ in 0..writes_per_read {
                    writer.write_block(&input, shape.channels);
                }
                if reader.read_into(&mut out) {
                    served += 1;
                }
            }

            assert!(
                served > 0,
                "a ring too small for its own target never settles at {} frames out",
                shape.output_period_frames
            );
            assert!(
                reader.counters().samples_shed() > 0,
                "the shed has to reach a target the ring can actually exceed"
            );
        }
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
    fn a_block_carrying_a_partial_frame_is_refused_and_leaves_the_ring_untouched() {
        let (mut writer, reader) = capture_ring(SHAPE);

        // Half a frame at the end. Written, it would swap which channel every
        // later sample belongs to for the rest of the session.
        let misaligned = vec![0.5f32; SHAPE.input_period_frames * SHAPE.channels + 1];
        writer.write_block(&misaligned, SHAPE.channels);

        assert_eq!(reader.counters().blocks_refused(), 1);
        assert_eq!(
            reader.consumer.slots(),
            0,
            "a refused block writes no part of itself"
        );

        // A device that jitters its block size is absorbed, not refused: the
        // ring is a sample FIFO, not a queue of fixed-size blocks.
        writer.write_block(&block(SHAPE.input_period_frames / 2), SHAPE.channels);
        assert_eq!(reader.counters().blocks_refused(), 1);
        assert_eq!(
            reader.consumer.slots(),
            SHAPE.input_period_frames / 2 * SHAPE.channels
        );
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
    fn the_shed_takes_at_most_one_input_period_per_read() {
        let (mut writer, mut reader) = capture_ring(SHAPE);
        let input = block(SHAPE.input_period_frames);
        let mut out = vec![0.0; SHAPE.output_period_frames * SHAPE.channels];

        // Far enough above the target that one read leaves several periods of
        // excess: a shed that took all of it would drop a whole burst of
        // captured audio in one callback instead of easing the depth down.
        for _ in 0..SHAPE.target_depth_periods() + SHAPE.read_periods() + 4 {
            writer.write_block(&input, SHAPE.channels);
        }
        assert!(reader.read_into(&mut out));

        assert_eq!(
            reader.counters().samples_shed() as usize,
            SHAPE.input_period_frames * SHAPE.channels,
            "one pass sheds one input period, however far above target the ring sits"
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

        // The stall drops the reader back to filling. One period back is not
        // the settled depth, so this read is refill rather than a second
        // shortfall — a reader that stayed settled would count it as one.
        writer.write_block(&input, SHAPE.channels);
        assert!(!reader.read_into(&mut out));
        assert_eq!(
            reader.counters().underruns(),
            1,
            "refilling after a stall is not a shortfall"
        );

        // Once the slack is back, the reader serves again.
        for _ in 0..SHAPE.target_depth_periods() {
            writer.write_block(&input, SHAPE.channels);
        }
        assert!(reader.read_into(&mut out));
        assert_eq!(reader.counters().underruns(), 1);
    }

    #[test]
    fn a_zero_input_period_still_builds_a_ring_the_reader_can_use() {
        // The seam refuses a zero period; the arithmetic here stays total so
        // a defensive caller gets a small usable ring rather than one of zero
        // capacity that can never hand out a sample.
        let shape = CaptureShape {
            input_period_frames: 0,
            output_period_frames: 4,
            channels: 2,
        };
        let (mut writer, mut reader) = capture_ring(shape);
        let mut out = [0.0f32; 8];

        for _ in 0..shape.target_depth_periods() {
            writer.write_block(&[0.25, 0.75], shape.channels);
        }

        assert!(
            reader.read_into(&mut out),
            "a zero-capacity ring can never serve a read"
        );
        assert_eq!(reader.counters().blocks_refused(), 0);
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
            let misaligned = vec![0.5f32; SHAPE.input_period_frames * SHAPE.channels + 1];
            let mut out = vec![0.0; SHAPE.output_period_frames * SHAPE.channels];

            assert_no_alloc(|| {
                // Every arm of both callbacks: the write that fits, the write
                // the full ring refuses, the write refused for its layout and
                // the one refused for a partial frame, the read below the
                // settle depth, the read that fills, the read that underruns,
                // and the shed that holds the depth.
                for _ in 0..SHAPE.ring_periods() + 2 {
                    writer.write_block(&input, SHAPE.channels);
                }
                writer.write_block(&input, SHAPE.channels + 1);
                writer.write_block(&misaligned, SHAPE.channels);
                for _ in 0..16 {
                    reader.read_into(&mut out);
                }
            });

            assert!(reader.counters().blocks_refused() > 0);
            assert!(reader.counters().samples_shed() > 0);
            assert!(reader.counters().underruns() > 0);
        }
    }
}
