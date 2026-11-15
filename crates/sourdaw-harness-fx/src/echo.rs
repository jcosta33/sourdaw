//! The effect itself, free of either format's vocabulary: per channel,
//! `y[n] = g * (x[n - L] + 0.5 * x[n - L - E])`.

use crate::state::{self, RecordedState, MODE_NEVER_SET};
use std::cell::Cell;
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};

/// `L`: the delay every output sample carries, reported as the plugin latency.
pub const LATENCY_FRAMES: usize = 64;
/// `E`: the distance from the delayed sample to its echo, declared as the tail.
pub const ECHO_FRAMES: usize = 480;
pub const GAIN_MIN: f64 = 0.0;
pub const GAIN_MAX: f64 = 1.0;
pub const GAIN_DEFAULT: f64 = 0.5;
pub(crate) const CHANNELS: usize = 2;

const ECHO_LEVEL: f32 = 0.5;
/// One frame more than the oldest one read, so the frame written this sample
/// never overwrites `x[n - L - E]` before it is read.
const HISTORY_FRAMES: usize = LATENCY_FRAMES + ECHO_FRAMES + 1;

/// Per-instance state, shared by `&Echo` alone.
///
/// The history and its write position are touched only by activation, while
/// the instance is inactive, and by processing, while it is active — the same
/// lifecycle exclusion `sourdaw-harness-tone`'s `Tone` relies on, carried
/// across threads by the host's own publication of the activated instance.
/// Everything the main thread may read or write while the audio thread runs
/// (the gain, the recorded modes) is atomic.
pub(crate) struct Echo {
    gain: AtomicU64,
    history: [Box<[Cell<f32>]>; CHANNELS],
    write_position: Cell<usize>,
    configured_mode: AtomicI32,
    last_block_mode: AtomicI32,
}

impl Echo {
    pub(crate) fn new() -> Self {
        Self {
            gain: AtomicU64::new(GAIN_DEFAULT.to_bits()),
            history: [silent_history(), silent_history()],
            write_position: Cell::new(0),
            configured_mode: AtomicI32::new(MODE_NEVER_SET),
            last_block_mode: AtomicI32::new(MODE_NEVER_SET),
        }
    }

    pub(crate) fn gain(&self) -> f64 {
        f64::from_bits(self.gain.load(Ordering::Relaxed))
    }

    pub(crate) fn set_gain(&self, gain: f64) {
        let clamped = gain.clamp(GAIN_MIN, GAIN_MAX);
        self.gain.store(clamped.to_bits(), Ordering::Relaxed);
    }

    /// Forget every past input, as activation and a host reset require.
    pub(crate) fn reset(&self) {
        for channel in &self.history {
            for sample in channel.iter() {
                sample.set(0.0);
            }
        }
        self.write_position.set(0);
    }

    /// One output frame for one input frame. Allocation- and lock-free.
    pub(crate) fn next_frame(&self, input: [f32; CHANNELS]) -> [f32; CHANNELS] {
        let gain = self.gain() as f32;
        let position = self.write_position.get();
        let delayed = (position + HISTORY_FRAMES - LATENCY_FRAMES) % HISTORY_FRAMES;
        let echoed = (position + HISTORY_FRAMES - LATENCY_FRAMES - ECHO_FRAMES) % HISTORY_FRAMES;
        let mut output = [0.0; CHANNELS];
        for (channel, history) in self.history.iter().enumerate() {
            history[position].set(input[channel]);
            output[channel] = gain * (history[delayed].get() + ECHO_LEVEL * history[echoed].get());
        }
        self.write_position.set((position + 1) % HISTORY_FRAMES);
        output
    }

    pub(crate) fn record_configured_mode(&self, mode: i32) {
        self.configured_mode.store(mode, Ordering::Relaxed);
    }

    pub(crate) fn record_block_mode(&self, mode: i32) {
        self.last_block_mode.store(mode, Ordering::Relaxed);
    }

    pub(crate) fn save(&self) -> Vec<u8> {
        state::encode(RecordedState {
            gain: self.gain(),
            configured_mode: self.configured_mode.load(Ordering::Relaxed),
            last_block_mode: self.last_block_mode.load(Ordering::Relaxed),
        })
    }

    /// Restore `Gain` from a chunk, refusing one this plugin did not write or
    /// whose gain is outside the parameter's range.
    pub(crate) fn load(&self, chunk: &[u8]) -> bool {
        let Some(recorded) = state::decode(chunk) else {
            return false;
        };
        if !(GAIN_MIN..=GAIN_MAX).contains(&recorded.gain) {
            return false;
        }
        self.set_gain(recorded.gain);
        true
    }
}

fn silent_history() -> Box<[Cell<f32>]> {
    (0..HISTORY_FRAMES).map(|_| Cell::new(0.0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_impulse_returns_at_the_latency_and_echoes_after_it() {
        let echo = Echo::new();
        let frames = LATENCY_FRAMES + ECHO_FRAMES + 8;
        let outputs: Vec<f32> = (0..frames)
            .map(|frame| {
                let sample = if frame == 0 { 1.0 } else { 0.0 };
                echo.next_frame([sample, sample])[0]
            })
            .collect();

        for (frame, sample) in outputs.iter().enumerate() {
            let expected = match frame {
                LATENCY_FRAMES => 0.5,
                frame if frame == LATENCY_FRAMES + ECHO_FRAMES => 0.25,
                _ => 0.0,
            };
            assert_eq!(*sample, expected, "frame {frame}");
        }
    }

    #[test]
    fn loading_restores_the_gain_but_not_the_recorded_modes() {
        let source = Echo::new();
        source.set_gain(0.25);
        source.record_configured_mode(2);
        let target = Echo::new();

        assert!(target.load(&source.save()));

        let restored = state::decode(&target.save()).unwrap();
        assert_eq!(restored.gain, 0.25);
        assert_eq!(restored.configured_mode, MODE_NEVER_SET);
    }
}
