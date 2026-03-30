//! Audio bridge — ring buffer for transferring audio blocks between
//! the Web Audio worklet (via main thread) and the Rust audio thread.
//!
//! Uses a lock-free SPSC ring buffer (rtrb) sized for several blocks,
//! allowing the worklet and Rust thread to run at slightly different rates
//! without dropping audio.

use rtrb::{Consumer, Producer, RingBuffer};

const BLOCK_SIZE: usize = 128;
const RING_CAPACITY: usize = 8; // 8 blocks ≈ 21ms at 48kHz

/// A stereo audio block (128 samples per channel).
pub struct AudioBlock {
    pub left: [f32; BLOCK_SIZE],
    pub right: [f32; BLOCK_SIZE],
}

impl Default for AudioBlock {
    fn default() -> Self {
        Self {
            left: [0.0; BLOCK_SIZE],
            right: [0.0; BLOCK_SIZE],
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
    /// Returns true if a block was processed.
    #[inline]
    pub fn try_process<F: FnMut(&mut [f32], &mut [f32], usize)>(
        &mut self,
        mut process_fn: F,
    ) -> bool {
        if let Ok(mut block) = self.input_rx.pop() {
            process_fn(&mut block.left, &mut block.right, BLOCK_SIZE);
            let _ = self.output_tx.push(block); // Drop if output ring is full
            true
        } else {
            false
        }
    }
}

impl PluginAudioBridgeHandle {
    /// Push an input block from the worklet (via main thread).
    pub fn push_input(&mut self, left: &[f32], right: &[f32]) -> bool {
        let mut block = AudioBlock::default();
        let len = left.len().min(BLOCK_SIZE);
        block.left[..len].copy_from_slice(&left[..len]);
        block.right[..len].copy_from_slice(&right[..len]);
        self.input_tx.push(block).is_ok()
    }

    /// Pop a processed output block for the worklet (via main thread).
    pub fn pop_output(&mut self) -> Option<AudioBlock> {
        self.output_rx.pop().ok()
    }
}
