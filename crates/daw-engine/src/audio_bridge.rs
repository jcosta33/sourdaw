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

impl PluginAudioBridge {
    /// Try to read an input block and process it through the plugin.
    ///
    /// The closure receives exactly the live frames — never the full capacity —
    /// so a partial block cannot leak stale samples into the plugin.
    ///
    /// Returns true if a block was processed.
    #[inline]
    pub fn try_process<F: FnMut(&mut [f32], &mut [f32], usize)>(
        &mut self,
        mut process_fn: F,
    ) -> bool {
        if let Ok(mut block) = self.input_rx.pop() {
            let frames = block.frames.min(MAX_BLOCK_FRAMES);
            process_fn(
                &mut block.left[..frames],
                &mut block.right[..frames],
                frames,
            );
            let _ = self.output_tx.push(block); // Drop if output ring is full
            true
        } else {
            false
        }
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
        bridge.try_process(|left, right, frames| {
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
        bridge.try_process(|_, _, _| {});
        let _ = handle.pop_output();

        assert!(handle.push_input(&[0.0; 8], &[0.0; 8]));
        let mut tail_leaked = false;
        bridge.try_process(|left, _right, frames| {
            assert_eq!(frames, 8);
            tail_leaked = left.iter().any(|sample| *sample != 0.0);
        });

        assert!(!tail_leaked, "stale tail samples reached the plugin");
    }

    #[test]
    fn the_processed_block_reports_the_frame_count_it_was_pushed_with() {
        let (mut bridge, mut handle) = create_audio_bridge(1000);
        assert!(handle.push_input(&[0.75; 96], &[0.75; 96]));

        bridge.try_process(|left, right, _| {
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
}
