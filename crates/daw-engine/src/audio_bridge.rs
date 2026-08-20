//! Audio bridge — ring buffer for transferring audio blocks between
//! the Web Audio worklet (via main thread) and the Rust audio thread.
//!
//! Uses a lock-free SPSC ring buffer (rtrb) sized for several blocks,
//! allowing the worklet and Rust thread to run at slightly different rates
//! without dropping audio.
//!
//! The frame count travels with the block. A block carries a fixed-capacity
//! buffer but records how many frames are actually live, so a short block is
//! never processed as a full one: the earlier design clamped on push and then
//! unconditionally processed a full quantum, feeding the plugin whatever stale
//! samples the reused block still held past the live frames.

use rtrb::{Consumer, Producer, RingBuffer};

/// Largest render quantum the bridge accepts in a single block.
///
/// Web Audio's quantum is 128 frames today, but the spec permits a larger one.
/// The capacity covers 128/256/512 so a quantum change degrades to a rejected
/// push (visible) rather than silently truncated audio.
pub const MAX_BLOCK_FRAMES: usize = 512;

/// Web Audio's render quantum. The app pushes one block per quantum.
pub const RENDER_QUANTUM_FRAMES: usize = 128;

/// Blocks the ring holds.
///
/// The app queues one block per render quantum while the audio thread drains
/// once per device period, so the ring has to span a whole device period or
/// the app's pushes are refused partway through it — audio lost for exactly
/// the reason the drain exists. Sized from the largest callback the engine
/// accepts, plus four blocks of slack for ordinary jitter.
///
/// Each block is ~4 KiB, so the pair of rings costs ~288 KiB per plugin.
pub(crate) const RING_CAPACITY: usize =
    crate::audio_thread::MAX_CALLBACK_FRAMES / RENDER_QUANTUM_FRAMES + 4;

/// A stereo audio block. `frames` is authoritative; the arrays are capacity,
/// not length, and samples past `frames` are undefined carry-over.
pub struct AudioBlock {
    pub left: [f32; MAX_BLOCK_FRAMES],
    pub right: [f32; MAX_BLOCK_FRAMES],
    /// Live frames in this block. Never exceeds `MAX_BLOCK_FRAMES`.
    pub frames: usize,
}

impl Default for AudioBlock {
    fn default() -> Self {
        Self {
            left: [0.0; MAX_BLOCK_FRAMES],
            right: [0.0; MAX_BLOCK_FRAMES],
            frames: 0,
        }
    }
}

/// One side of the audio bridge for a single plugin instance.
pub struct PluginAudioBridge {
    pub plugin_id: usize,
    /// Input: main thread pushes (from worklet), audio thread pops
    pub input_rx: Consumer<AudioBlock>,
    /// Output: audio thread pushes (processed), main thread pops (to worklet)
    pub output_tx: Producer<AudioBlock>,
}

/// The other side, held by the main thread / native command layer.
pub struct PluginAudioBridgeHandle {
    pub plugin_id: usize,
    /// Input: main thread pushes audio from the worklet
    pub input_tx: Producer<AudioBlock>,
    /// Output: main thread pops processed audio for the worklet
    pub output_rx: Consumer<AudioBlock>,
}

/// Create a matched pair of bridge endpoints.
pub fn create_audio_bridge(plugin_id: usize) -> (PluginAudioBridge, PluginAudioBridgeHandle) {
    let (input_tx, input_rx) = RingBuffer::new(RING_CAPACITY);
    let (output_tx, output_rx) = RingBuffer::new(RING_CAPACITY);

    let bridge = PluginAudioBridge {
        plugin_id,
        input_rx,
        output_tx,
    };

    let handle = PluginAudioBridgeHandle {
        plugin_id,
        input_tx,
        output_rx,
    };

    (bridge, handle)
}

/// What one drain pass moved across the bridge.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct BridgeDrain {
    /// Blocks popped from the input ring and handed to the closure.
    pub blocks_processed: usize,
    /// Live frames across those blocks — what the pass actually cost.
    pub frames_processed: usize,
    /// Processed blocks the app never receives because its return ring was
    /// full. Audio that is computed and then thrown away.
    pub output_blocks_dropped: usize,
    /// Blocks processed but withheld from the return ring to hold the round
    /// trip at its target depth. Counted in `blocks_processed` too — the
    /// plugin saw them; only the app does not.
    pub blocks_shed: usize,
}

impl PluginAudioBridge {
    /// Blocks in flight: queued for the plugin plus processed and waiting for
    /// the app. This is the bridge's latency, in blocks.
    #[inline]
    fn depth(&self) -> usize {
        let waiting_for_the_app = RING_CAPACITY.saturating_sub(self.output_tx.slots());
        self.input_rx.slots() + waiting_for_the_app
    }

    /// Whether this pass should shed a block to shorten the round trip.
    ///
    /// Depth only ever grows on its own. The app pushes one block and pops one
    /// block per render quantum, so a pop that finds the return ring empty —
    /// an IPC call landing between the ring emptying and the next callback,
    /// which happens on any phase slip — pushes without taking anything back
    /// and leaves the round trip one block deeper for good. Nothing shortens
    /// it again. Left alone the bridge drifts later and later against the rest
    /// of the graph until it reaches the ring's capacity, and stays there:
    /// ~99 ms of plugin latency that no amount of idle time recovers, wrecking
    /// phase against every parallel path.
    ///
    /// A shed block is still processed — only its return trip is skipped. The
    /// input side is the plugin's only feed: the native sampler records from
    /// exactly these buffers, so dropping a block before the plugin sees it
    /// would splice a hole into an armed take rather than shorten a queue.
    /// Processing it and then withholding it costs the app one quantum of
    /// return audio and shortens the round trip by the same one block.
    #[inline]
    fn should_shed(&self, target_depth_blocks: usize) -> bool {
        self.depth() > target_depth_blocks
    }
    /// Process the blocks queued for this callback, up to `frame_budget`.
    ///
    /// The audio thread runs on the device's buffer period while the app
    /// pushes one block per render quantum, so several blocks are normally
    /// waiting: a 512-frame device buffer at 48 kHz covers four 128-frame
    /// quanta. Popping a single block per callback left the remainder to pile
    /// up until the ring was full, after which every push was refused and the
    /// app fell back to dry input — a standing partial loss of the plugin's
    /// audio, not a startup transient.
    ///
    /// The budget is what keeps that fix from becoming a different fault. A
    /// pass that drained the whole ring would, after a main-thread stall,
    /// render a ring's worth of audio inside one callback period — many times
    /// real time, on the thread with the hard deadline. The caller budgets the
    /// frames the device asked for plus one quantum of catch-up, so a backlog
    /// is worked off over successive callbacks instead of in one spike, and
    /// the pass never costs much more than the period it runs in.
    ///
    /// At least one block is always taken when one is queued, so a budget
    /// smaller than a block still makes progress rather than wedging the ring.
    /// The closure receives exactly the live frames of each block — never the
    /// full capacity — so a partial block cannot leak stale samples into the
    /// plugin. The ring's capacity is a second, absolute bound: a producer
    /// pushing throughout the pass cannot hold the audio callback open.
    ///
    /// `target_depth_blocks` is how deep the round trip needs to run to cover
    /// the device period. One block per pass is shed above it — processed as
    /// usual, then withheld from the return ring — so the bridge's latency
    /// settles at that depth instead of ratcheting up to the ring's capacity
    /// over a session.
    #[inline]
    pub fn drain_process<F: FnMut(&mut [f32], &mut [f32], usize)>(
        &mut self,
        frame_budget: usize,
        target_depth_blocks: usize,
        mut process_fn: F,
    ) -> BridgeDrain {
        let mut drain = BridgeDrain::default();
        let mut shed_remaining = usize::from(self.should_shed(target_depth_blocks));

        for _ in 0..RING_CAPACITY {
            let Ok(mut block) = self.input_rx.pop() else {
                break;
            };
            let frames = block.frames.min(MAX_BLOCK_FRAMES);
            process_fn(
                &mut block.left[..frames],
                &mut block.right[..frames],
                frames,
            );
            drain.blocks_processed += 1;
            drain.frames_processed += frames;
            if shed_remaining > 0 {
                shed_remaining -= 1;
                drain.blocks_shed += 1;
            } else if self.output_tx.push(block).is_err() {
                drain.output_blocks_dropped += 1;
            }
            if drain.frames_processed >= frame_budget {
                break;
            }
        }

        drain
    }
}

impl PluginAudioBridgeHandle {
    /// Push an input block from the worklet (via main thread).
    ///
    /// Returns false when the ring is full, when the channels disagree on
    /// length, or when the block is larger than `MAX_BLOCK_FRAMES` — the
    /// oversized case is rejected rather than truncated so a render-quantum
    /// change surfaces instead of quietly halving the audio.
    pub fn push_input(&mut self, left: &[f32], right: &[f32]) -> bool {
        if left.len() != right.len() || left.len() > MAX_BLOCK_FRAMES {
            return false;
        }
        let frames = left.len();
        let mut block = AudioBlock::default();
        block.left[..frames].copy_from_slice(left);
        block.right[..frames].copy_from_slice(right);
        block.frames = frames;
        self.input_tx.push(block).is_ok()
    }

    /// Pop a processed output block for the worklet (via main thread).
    pub fn pop_output(&mut self) -> Option<AudioBlock> {
        self.output_rx.pop().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_block_is_processed_at_its_own_length_not_the_full_capacity() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.25; 64], &[0.5; 64]));

        let mut observed_frames = 0;
        let mut observed_left_len = 0;
        bridge.drain_process(
            RENDER_QUANTUM_FRAMES,
            RING_CAPACITY,
            |left, right, frames| {
                observed_frames = frames;
                observed_left_len = left.len();
                assert_eq!(right.len(), 64);
            },
        );

        assert_eq!(observed_frames, 64);
        assert_eq!(observed_left_len, 64);
    }

    #[test]
    fn a_short_block_never_exposes_stale_samples_past_its_live_frames() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);

        // Run a full-length block through first, then follow it with a short
        // one. A design that processed the full capacity would hand the plugin
        // the previous block's tail; the closure must only ever see live frames.
        assert!(handle.push_input(&[1.0; 128], &[1.0; 128]));
        bridge.drain_process(RENDER_QUANTUM_FRAMES, RING_CAPACITY, |_, _, _| {});
        let _ = handle.pop_output();

        assert!(handle.push_input(&[0.0; 8], &[0.0; 8]));
        let mut tail_leaked = false;
        bridge.drain_process(
            RENDER_QUANTUM_FRAMES,
            RING_CAPACITY,
            |left, _right, frames| {
                assert_eq!(frames, 8);
                tail_leaked = left.iter().any(|sample| *sample != 0.0);
            },
        );

        assert!(!tail_leaked, "stale tail samples reached the plugin");
    }

    #[test]
    fn the_processed_block_reports_the_frame_count_it_was_pushed_with() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.75; 96], &[0.75; 96]));

        bridge.drain_process(RENDER_QUANTUM_FRAMES, RING_CAPACITY, |left, right, _| {
            for sample in left.iter_mut().chain(right.iter_mut()) {
                *sample *= 2.0;
            }
        });

        let block = handle.pop_output().expect("a processed block");
        assert_eq!(block.frames, 96);
        assert_eq!(block.left[95], 1.5);
    }

    #[test]
    fn an_oversized_block_is_rejected_rather_than_truncated() {
        let (_bridge, mut handle) = create_audio_bridge(1000);

        let oversized = vec![0.5; MAX_BLOCK_FRAMES + 1];
        assert!(!handle.push_input(&oversized, &oversized));
    }

    #[test]
    fn channels_of_differing_length_are_rejected() {
        let (_bridge, mut handle) = create_audio_bridge(1000);

        assert!(!handle.push_input(&[0.5; 64], &[0.5; 32]));
    }

    #[test]
    fn one_pass_takes_every_block_the_device_period_covers() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        for _ in 0..4 {
            assert!(handle.push_input(&[0.5; RENDER_QUANTUM_FRAMES], &[0.5; RENDER_QUANTUM_FRAMES]));
        }

        // A 512-frame device buffer at 48 kHz covers four render quanta, so
        // four blocks are waiting and all four belong to this callback. Taking
        // one leaves the rest to fill the ring, after which the app's pushes
        // are refused for good.
        let drain = bridge.drain_process(4 * RENDER_QUANTUM_FRAMES, RING_CAPACITY, |_, _, _| {});

        assert_eq!(drain.blocks_processed, 4);
        assert_eq!(drain.frames_processed, 4 * RENDER_QUANTUM_FRAMES);
        assert_eq!(drain.output_blocks_dropped, 0);
        let mut returned = 0;
        while handle.pop_output().is_some() {
            returned += 1;
        }
        assert_eq!(returned, 4, "a block left in the ring is lost audio");
    }

    #[test]
    fn a_pass_spends_its_budget_and_leaves_the_backlog_for_later_callbacks() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        for _ in 0..8 {
            assert!(handle.push_input(&[0.5; RENDER_QUANTUM_FRAMES], &[0.5; RENDER_QUANTUM_FRAMES]));
        }

        // A backlog left by a main-thread stall. Rendering all of it inside
        // one callback is eight times the audio the device asked for, on the
        // thread with the deadline — an underrun in place of the loss this
        // drain removes. It is worked off a quantum at a time instead.
        let drain = bridge.drain_process(2 * RENDER_QUANTUM_FRAMES, RING_CAPACITY, |_, _, _| {});

        assert_eq!(drain.blocks_processed, 2);
        let mut remaining = 0;
        while handle.pop_output().is_some() {
            remaining += 1;
        }
        assert_eq!(remaining, 2, "only the budgeted blocks were returned");
    }

    #[test]
    fn a_pass_takes_one_block_even_when_the_budget_is_smaller_than_it() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.5; 256], &[0.5; 256]));

        // A quantum larger than the device period must still make progress:
        // a pass that took nothing would leave the block in the ring forever.
        let drain = bridge.drain_process(64, RING_CAPACITY, |_, _, _| {});

        assert_eq!(drain.blocks_processed, 1);
        assert_eq!(drain.frames_processed, 256);
    }

    #[test]
    fn a_pass_cannot_outrun_the_ring_while_the_app_keeps_pushing() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));

        // The app pushes from inside the pass, the way the main thread does
        // while the callback drains. With no ceiling this loop never ends and
        // the audio callback never returns; the budget alone does not stop it,
        // because the budget is generous here.
        let mut refills = RING_CAPACITY * 4;
        let drain = bridge.drain_process(usize::MAX, RING_CAPACITY, |_, _, _| {
            if refills > 0 {
                refills -= 1;
                assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
            }
        });

        assert_eq!(drain.blocks_processed, RING_CAPACITY);
    }

    #[test]
    fn the_round_trip_settles_at_its_target_depth_instead_of_ratcheting_up() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        // A 512-frame device period: four quanta, plus two blocks of slack.
        let target_depth = 4 + 2;
        let budget = 512 + RENDER_QUANTUM_FRAMES;

        // The app pushes one block and pops one block per quantum. A pop that
        // finds the return ring empty — any phase slip between the IPC call
        // and the callback — pushes without taking anything back, so the round
        // trip runs one block deeper from then on. Nothing shortens it again,
        // and the depth is the plugin's latency against the rest of the graph.
        for callback in 0..40 {
            for _ in 0..4 {
                assert!(
                    handle.push_input(&[0.5; RENDER_QUANTUM_FRAMES], &[0.5; RENDER_QUANTUM_FRAMES])
                );
                // Every fourth callback the app pops nothing back.
                if callback % 4 != 0 {
                    let _ = handle.pop_output();
                }
            }
            bridge.drain_process(budget, target_depth, |_, _, _| {});
        }

        let depth = bridge.depth();
        assert!(
            depth <= target_depth + 1,
            "round trip settled at {depth} blocks against a target of {target_depth}"
        );
    }

    #[test]
    fn a_round_trip_already_at_its_target_sheds_nothing() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        for _ in 0..3 {
            assert!(handle.push_input(&[0.5; RENDER_QUANTUM_FRAMES], &[0.5; RENDER_QUANTUM_FRAMES]));
        }

        // Shedding audio that is merely in flight, rather than piled up, would
        // put a dropout into a bridge that is keeping up perfectly.
        let drain = bridge.drain_process(4 * RENDER_QUANTUM_FRAMES, 6, |_, _, _| {});

        assert_eq!(drain.blocks_shed, 0);
        assert_eq!(drain.blocks_processed, 3);
    }

    #[test]
    fn a_shed_block_still_reaches_the_plugin_and_only_its_return_trip_is_skipped() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        // Eight blocks in flight against a target of two: this pass sheds.
        for block in 0..8u8 {
            let sample = f32::from(block);
            assert!(handle.push_input(
                &[sample; RENDER_QUANTUM_FRAMES],
                &[sample; RENDER_QUANTUM_FRAMES]
            ));
        }

        let mut seen = Vec::new();
        let drain = bridge.drain_process(usize::MAX, 2, |left, _, _| {
            seen.push(left[0]);
        });

        assert_eq!(drain.blocks_shed, 1);
        // The input ring is the plugin's only feed — the native sampler records
        // from exactly these buffers. A shed that dropped the block before the
        // closure would splice a hole into an armed take.
        assert_eq!(seen, vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
        assert_eq!(drain.blocks_processed, 8);

        // Seven come back; the shed one is the cost of shortening the round trip.
        let mut returned = 0;
        while handle.pop_output().is_some() {
            returned += 1;
        }
        assert_eq!(returned, 7);
    }

    #[test]
    fn a_processed_block_the_app_cannot_receive_is_counted_not_silently_dropped() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);

        // Fill the return ring by draining without ever popping — the app
        // stalling on its side of the bridge.
        for _ in 0..RING_CAPACITY {
            assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
        }
        let filled = bridge.drain_process(usize::MAX, usize::MAX, |_, _, _| {});
        assert_eq!(filled.blocks_processed, RING_CAPACITY);
        assert_eq!(filled.output_blocks_dropped, 0);

        assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
        let overflowed = bridge.drain_process(usize::MAX, usize::MAX, |_, _, _| {});

        assert_eq!(overflowed.blocks_processed, 1);
        assert_eq!(
            overflowed.output_blocks_dropped, 1,
            "audio computed and then thrown away must leave a count behind"
        );
    }
}
