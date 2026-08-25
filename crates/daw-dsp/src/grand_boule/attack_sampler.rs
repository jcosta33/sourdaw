//! Hybrid sampled-attack pathway.
//!
//! Blends a short sample-based attack transient with the modelled modal
//! output. The blend window is typically 10–50 ms — long enough to capture
//! the hammer-strike noise and the initial excitation of the string, short
//! enough that the modelled sustain carries the rest.
//!
//! The sample set is held by the engine (one allocation at load time) and
//! voices track a playhead + key. When rendering, the engine reads samples
//! out of the set and cross-fades them out against the modelled voice
//! output over the clip's duration.

/// Maximum attack clip: 2400 samples, or 50 ms at 48 kHz.
pub const MAX_ATTACK_SAMPLES: usize = 2_400;

/// Number of piano keys.
const NUM_KEYS: usize = 88;

/// Immutable set of attack-transient clips, one per key.
#[derive(Clone, Debug)]
pub struct AttackSampleSet {
    /// Flat sample storage. Size is fixed at `NUM_KEYS * MAX_ATTACK_SAMPLES`.
    samples: Vec<f32>,
    /// Actual clip length per key (0 = disabled).
    lengths: [u16; NUM_KEYS],
}

impl AttackSampleSet {
    /// Create an empty set (all clips disabled). The caller can populate
    /// individual keys with [`Self::set_clip`]. Allocation happens once here.
    pub fn new() -> Self {
        Self {
            samples: vec![0.0; NUM_KEYS * MAX_ATTACK_SAMPLES],
            lengths: [0; NUM_KEYS],
        }
    }

    /// Load an attack clip for a single key. Clips longer than
    /// [`MAX_ATTACK_SAMPLES`] are truncated; keys outside `1..=88` are
    /// ignored silently. This is the only write API — callers fully
    /// populate the set before the audio thread starts.
    pub fn set_clip(&mut self, key: u32, clip: &[f32]) {
        if key == 0 || key as usize > NUM_KEYS {
            return;
        }
        let index = (key - 1) as usize;
        let length = clip.len().min(MAX_ATTACK_SAMPLES);
        let offset = index * MAX_ATTACK_SAMPLES;
        self.samples[offset..offset + length].copy_from_slice(&clip[..length]);
        // Zero the remainder so the clip cannot bleed into the next one.
        for s in self.samples[offset + length..offset + MAX_ATTACK_SAMPLES].iter_mut() {
            *s = 0.0;
        }
        self.lengths[index] = length as u16;
    }

    /// Read one sample of the attack clip for `key` at `position`.
    /// Returns `0.0` past the end of the clip or for unloaded keys.
    #[inline]
    pub fn sample(&self, key: u32, position: usize) -> f32 {
        if key == 0 || key as usize > NUM_KEYS {
            return 0.0;
        }
        let index = (key - 1) as usize;
        let length = self.lengths[index] as usize;
        if position >= length {
            return 0.0;
        }
        self.samples[index * MAX_ATTACK_SAMPLES + position]
    }

    /// Length of the loaded clip for `key`, or 0 if none loaded.
    pub fn length_for_key(&self, key: u32) -> usize {
        if key == 0 || key as usize > NUM_KEYS {
            return 0;
        }
        self.lengths[(key - 1) as usize] as usize
    }

    /// Cross-fade gain for the *sample* contribution at a given position.
    /// Starts at 1.0 and smoothly ramps to 0.0 at `position == length`.
    /// The modelled signal receives the complement (`1.0 - this`).
    #[inline]
    pub fn sample_gain(position: usize, length: usize) -> f32 {
        if length == 0 || position >= length {
            return 0.0;
        }
        let t = position as f32 / length as f32;
        // Equal-power crossfade feels natural for attack blending.
        (1.0 - t).sqrt()
    }

    /// Complementary gain applied to the modelled signal.
    #[inline]
    pub fn model_gain(position: usize, length: usize) -> f32 {
        if length == 0 {
            return 1.0;
        }
        if position >= length {
            return 1.0;
        }
        let t = position as f32 / length as f32;
        t.sqrt()
    }
}

impl Default for AttackSampleSet {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_set_returns_zero_samples() {
        let set = AttackSampleSet::new();
        assert_eq!(set.sample(40, 0), 0.0);
        assert_eq!(set.length_for_key(40), 0);
    }

    #[test]
    fn loaded_clip_round_trips() {
        let mut set = AttackSampleSet::new();
        let clip = [0.1_f32, 0.2, 0.3, -0.4];
        set.set_clip(10, &clip);
        assert_eq!(set.length_for_key(10), 4);
        assert_eq!(set.sample(10, 0), 0.1);
        assert_eq!(set.sample(10, 3), -0.4);
        assert_eq!(set.sample(10, 4), 0.0);
    }

    #[test]
    fn long_clips_are_truncated() {
        let mut set = AttackSampleSet::new();
        let clip = vec![1.0; MAX_ATTACK_SAMPLES + 500];
        set.set_clip(1, &clip);
        assert_eq!(set.length_for_key(1), MAX_ATTACK_SAMPLES);
    }

    #[test]
    fn crossfade_gains_are_complementary_in_power() {
        let length = 100;
        for pos in [0, 25, 50, 75, 99].iter() {
            let s = AttackSampleSet::sample_gain(*pos, length);
            let m = AttackSampleSet::model_gain(*pos, length);
            // Equal-power: s² + m² should be ~1.
            let total = s * s + m * m;
            assert!((total - 1.0).abs() < 1.0e-4, "pos={pos} total={total}");
        }
    }
}
