//! Proof — Sourdaw's mastering suite.
//!
//! Reorderable signal chain: EQ → Multiband Dynamics → Stereo Imager →
//! Harmonic Exciter → Limiter, with inline metering taps, LUFS measurement,
//! true peak detection, and dithering.
//!
//! Compiles to WASM for AudioWorklet processing.

pub mod biquad;
pub mod chain;
pub mod crossover;
pub mod dither;
pub mod dynamic_eq;
pub mod eq;
pub mod exciter;
pub mod imager;
pub mod limiter;
pub mod linear_phase_eq;
pub mod match_eq;
pub mod metering;
pub mod multiband;
pub mod true_peak;

use crate::primitives::sanitize_block;
use chain::ProofChain;
use wasm_bindgen::prelude::*;

const NUM_MODULES: usize = 5;
const NUM_TAPS: usize = 6;

/// Bring a wire parameter value into `[min, max]`, answering `fallback` when it
/// is not finite.
///
/// The fallback branch is the whole point. `f32::clamp` returns NaN for a NaN
/// input — it only panics on a NaN *bound* — so clamping alone hands the
/// arithmetic downstream a NaN, and every Proof parameter is stored rather than
/// recomputed per block. One NaN therefore poisons the device for its whole
/// life, with no recovery short of another message, and each setter poisons it
/// differently: a NaN release coefficient drives `current_gain` to NaN and
/// silences the output while the gain-reduction meter still reads zero, a NaN
/// ceiling makes `future_peak > ceiling` false forever so the limiter quietly
/// stops limiting, and a NaN trim silences the chain through `powf`.
///
/// `±inf` needs no special case: it is ordered, so `clamp` maps it to the
/// nearer bound, which is the answer the caller wants.
///
/// Every Proof setter that owns a range routes through here, so the NaN
/// handling cannot be right in one of them and forgotten in the next.
#[inline]
pub(crate) fn clamped_param(value: f32, min: f32, max: f32, fallback: f32) -> f32 {
    if value.is_nan() {
        fallback
    } else {
        value.clamp(min, max)
    }
}

/// WASM-exported Proof mastering suite instance for AudioWorklet.
#[wasm_bindgen]
pub struct ProofInstance {
    chain: ProofChain,
    input_left: Vec<f32>,
    input_right: Vec<f32>,
    output_left: Vec<f32>,
    output_right: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl ProofInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        let block_size = 4096;
        Self {
            chain: ProofChain::new(sample_rate as f64),
            input_left: vec![0.0; block_size],
            input_right: vec![0.0; block_size],
            output_left: vec![0.0; block_size],
            output_right: vec![0.0; block_size],
            nan_flush_count: 0,
        }
    }

    pub fn get_input_left_ptr(&mut self) -> *mut f32 {
        self.input_left.as_mut_ptr()
    }
    pub fn get_input_right_ptr(&mut self) -> *mut f32 {
        self.input_right.as_mut_ptr()
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.chain.set_param(name, value);
    }

    /// Reorder the processing chain. Pass 5 module IDs (0=EQ, 1=Dyn, 2=Img, 3=Exc, 4=Lim).
    pub fn reorder(&mut self, m0: u8, m1: u8, m2: u8, m3: u8, m4: u8) {
        self.chain.reorder([m0, m1, m2, m3, m4]);
    }

    /// Process a block. Input must already be written to input buffers.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(4096);

        self.output_left[..size].copy_from_slice(&self.input_left[..size]);
        self.output_right[..size].copy_from_slice(&self.input_right[..size]);

        self.chain.process(
            &mut self.output_left[..size],
            &mut self.output_right[..size],
        );

        self.nan_flush_count += sanitize_block(&mut self.output_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.output_right[..size]) as u64;

        self.output_left.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.output_right.as_ptr()
    }

    // ── Metering ──────────────────────────────────────────────────────────

    pub fn get_input_lufs(&self) -> f32 {
        self.chain.input_lufs.get_lufs()
    }
    pub fn get_output_lufs(&self) -> f32 {
        self.chain.output_lufs.get_lufs()
    }
    pub fn get_output_st_lufs(&self) -> f32 {
        self.chain.output_st_lufs.get_lufs()
    }
    pub fn get_integrated_lufs(&self) -> f32 {
        self.chain.integrated_lufs.get_lufs()
    }
    pub fn get_true_peak_db(&self) -> f32 {
        self.chain.true_peak.get_true_peak_db()
    }
    pub fn get_lra(&self) -> f32 {
        self.chain.lra.get_lra()
    }
    pub fn get_ab_gain_offset(&self) -> f32 {
        self.chain.ab_gain_offset_db()
    }
    pub fn get_correlation(&self) -> f32 {
        self.chain.imager.get_correlation()
    }
    pub fn get_limiter_gr_db(&self) -> f32 {
        self.chain.limiter.get_gr_db()
    }

    /// Get per-band dynamics gain reduction. Returns 4 values.
    pub fn get_dynamics_gr(&self, band: u32) -> f32 {
        self.chain
            .dynamics
            .get_band_gr()
            .get(band as usize)
            .copied()
            .unwrap_or(0.0)
    }

    /// Get inline meter tap data. tap_idx 0 = input, 1-5 = after each module.
    pub fn get_tap_peak_l(&self, tap_idx: u32) -> f32 {
        self.chain
            .get_tap(tap_idx as usize)
            .map(|t| t.peak_db_l())
            .unwrap_or(-100.0)
    }
    pub fn get_tap_peak_r(&self, tap_idx: u32) -> f32 {
        self.chain
            .get_tap(tap_idx as usize)
            .map(|t| t.peak_db_r())
            .unwrap_or(-100.0)
    }

    pub fn get_module_order(&self) -> Vec<u8> {
        self.chain.get_module_order().to_vec()
    }

    pub fn get_latency_samples(&self) -> u32 {
        self.chain.latency_samples() as u32
    }

    /// Reset the panel's integrated-loudness measures together. Loudness range
    /// shares the same "since when" question as integrated loudness — both are
    /// figures about one programme — so a reset that touched integrated LUFS
    /// and true peak but left `chain.lra` accumulating from device
    /// instantiation would make the two readings on the same panel describe
    /// different programmes.
    pub fn reset_integrated(&mut self) {
        self.chain.integrated_lufs.reset();
        self.chain.true_peak.reset();
        self.chain.lra.reset();
    }
}

#[cfg(test)]
mod tests {
    //! `reset_integrated` is the "Reset Integrated" action on the mastering
    //! panel. It used to clear `integrated_lufs` and `true_peak` but leave
    //! `chain.lra` (loudness range) accumulating from device instantiation, so
    //! the two figures on the same panel described different programmes after
    //! every reset.

    use super::ProofInstance;

    const SR: f32 = 48_000.0;

    /// Feed a loud stretch then a quiet stretch straight into the loudness
    /// range meter, so it accumulates a genuine non-zero range — proof that
    /// this test can actually distinguish "reset" from "never touched".
    fn build_up_a_nonzero_loudness_range(proof: &mut ProofInstance) {
        let sr = SR as f64;
        for block in 0..40_i32 {
            let amplitude = if block % 2 == 0 { 0.8 } else { 0.03 };
            for n in 0..4_800_i32 {
                let phase = block * 4_800 + n;
                let s =
                    amplitude * (2.0 * core::f64::consts::PI * 1_000.0 * phase as f64 / sr).sin();
                proof.chain.lra.process_sample(s as f32, s as f32);
            }
        }
    }

    #[test]
    fn reset_integrated_also_resets_loudness_range() {
        let mut proof = ProofInstance::new(SR);
        build_up_a_nonzero_loudness_range(&mut proof);

        let before_reset = proof.get_lra();
        assert_ne!(
            before_reset, 0.0,
            "the loudness range meter must have accumulated a non-zero reading before \
             reset for this test to prove anything — a freshly constructed LoudnessRange \
             reads 0.0"
        );

        proof.reset_integrated();

        assert_eq!(
            proof.get_lra(),
            0.0,
            "reset_integrated must return the loudness range reading to a freshly \
             constructed meter's value (0.0) — if it stops calling chain.lra.reset() the \
             LRA figure keeps accumulating from device instantiation while integrated \
             loudness restarts, and the two figures on the same panel describe different \
             programmes"
        );
    }
}
