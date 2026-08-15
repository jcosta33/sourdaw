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

const RING_CAPACITY: usize = 8; // 8 blocks ≈ 21ms at 48kHz with a 128-frame quantum

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

/// The other side, held by the main thread / Tauri command layer.
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
    /// Processed blocks the app never receives because its return ring was
    /// full. Audio that is computed and then thrown away.
    pub output_blocks_dropped: usize,
}

impl PluginAudioBridge {
    /// Process every input block queued since the last callback.
    ///
    /// The audio thread runs on the device's buffer period while the app
    /// pushes one block per render quantum, so several blocks are normally
    /// waiting: a 512-frame device buffer at 48 kHz covers four 128-frame
    /// quanta. Popping a single block per callback left the remainder to pile
    /// up until the ring was full, after which every push was refused and the
    /// app fell back to dry input — a standing partial loss of the plugin's
    /// audio, not a startup transient.
    ///
    /// The closure receives exactly the live frames of each block — never the
    /// full capacity — so a partial block cannot leak stale samples into the
    /// plugin. The pass is bounded by the ring's capacity so a producer that
    /// keeps pushing cannot hold the audio callback open.
    #[inline]
    pub fn drain_process<F: FnMut(&mut [f32], &mut [f32], usize)>(
        &mut self,
        mut process_fn: F,
    ) -> BridgeDrain {
        let mut drain = BridgeDrain::default();

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
            if self.output_tx.push(block).is_err() {
                drain.output_blocks_dropped += 1;
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
        bridge.drain_process(|left, right, frames| {
            observed_frames = frames;
            observed_left_len = left.len();
            assert_eq!(right.len(), 64);
        });

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
        bridge.drain_process(|_, _, _| {});
        let _ = handle.pop_output();

        assert!(handle.push_input(&[0.0; 8], &[0.0; 8]));
        let mut tail_leaked = false;
        bridge.drain_process(|left, _right, frames| {
            assert_eq!(frames, 8);
            tail_leaked = left.iter().any(|sample| *sample != 0.0);
        });

        assert!(!tail_leaked, "stale tail samples reached the plugin");
    }

    #[test]
    fn the_processed_block_reports_the_frame_count_it_was_pushed_with() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.75; 96], &[0.75; 96]));

        bridge.drain_process(|left, right, _| {
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
    fn one_pass_takes_every_block_the_app_queued_since_the_last_callback() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        for _ in 0..4 {
            assert!(handle.push_input(&[0.5; 128], &[0.5; 128]));
        }

        let drain = bridge.drain_process(|_, _, _| {});

        assert_eq!(drain.blocks_processed, 4);
        assert_eq!(drain.output_blocks_dropped, 0);
        let mut returned = 0;
        while handle.pop_output().is_some() {
            returned += 1;
        }
        assert_eq!(returned, 4, "a block left in the ring is lost audio");
    }

    #[test]
    fn a_pass_cannot_run_longer_than_the_ring_even_while_the_app_keeps_pushing() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        for _ in 0..RING_CAPACITY {
            assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
        }

        // Refilling from inside the pass models the main thread pushing while
        // the callback drains. The pass must still end: an unbounded loop here
        // holds the audio callback open and underruns the device.
        let mut refills = 0;
        let drain = bridge.drain_process(|_, _, _| {
            if refills < 4 {
                refills += 1;
            }
        });

        assert_eq!(drain.blocks_processed, RING_CAPACITY);
    }

    #[test]
    fn a_processed_block_the_app_cannot_receive_is_counted_not_silently_dropped() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);

        // Fill the return ring by draining without ever popping — the app
        // stalling on its side of the bridge.
        for _ in 0..RING_CAPACITY {
            assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
        }
        let filled = bridge.drain_process(|_, _, _| {});
        assert_eq!(filled.output_blocks_dropped, 0);

        assert!(handle.push_input(&[0.5; 32], &[0.5; 32]));
        let overflowed = bridge.drain_process(|_, _, _| {});

        assert_eq!(overflowed.blocks_processed, 1);
        assert_eq!(
            overflowed.output_blocks_dropped, 1,
            "audio computed and then thrown away must leave a count behind"
        );
    }
}
