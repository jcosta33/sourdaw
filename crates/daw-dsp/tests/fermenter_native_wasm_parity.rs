use daw_dsp::fermenter::{FermenterInstance, FERMENTER_BLOCK_FRAMES};
use serde_json::json;

const BLOCKS: usize = 40;
const FRAMES: usize = BLOCKS * FERMENTER_BLOCK_FRAMES;
const SENTINEL: &str = "FERMENTER_NATIVE_WASM_PARITY_JSON:";

#[test]
fn native_fermenter_render_for_wasm_parity() {
    let mut instance = FermenterInstance::new(48_000.0, 8);
    // Keep this exact patch and the block-boundary MIDI sequence in the WASM
    // spec. Sine wavetable with noise, drift and chaos off is deterministic.
    for (name, value) in [
        ("engine", 0.0),
        ("osc_waveform", 0.0),
        ("osc_level", 0.75),
        ("layer_pan", -0.5),
        ("amp_attack", 0.001),
        ("amp_decay", 0.125),
        ("amp_sustain", 0.5),
        ("amp_release", 0.02),
        ("master_gain", 0.5),
        ("noise_level", 0.0),
        ("drift", 0.0),
        ("chaos_amount", 0.0),
    ] {
        instance.set_param(name, value);
    }

    let mut left = Vec::with_capacity(FRAMES);
    let mut right = Vec::with_capacity(FRAMES);
    for block in 0..BLOCKS {
        match block {
            0 => instance.note_on(60, 100),
            16 => instance.note_off(60),
            20 => instance.note_on(67, 80),
            28 => instance.note_off(67),
            _ => {}
        }

        let left_ptr = instance.process(FERMENTER_BLOCK_FRAMES as u32);
        let right_ptr = instance.get_right_ptr();
        assert!(!left_ptr.is_null() && !right_ptr.is_null());
        // SAFETY: process returns the two instance-owned buffers, each sized to
        // FERMENTER_BLOCK_FRAMES. Copy before the next process call.
        let left_block = unsafe { std::slice::from_raw_parts(left_ptr, FERMENTER_BLOCK_FRAMES) };
        let right_block = unsafe { std::slice::from_raw_parts(right_ptr, FERMENTER_BLOCK_FRAMES) };
        left.extend_from_slice(left_block);
        right.extend_from_slice(right_block);
    }

    assert_eq!(left.len(), FRAMES);
    assert_eq!(right.len(), FRAMES);
    assert!(left.iter().chain(&right).all(|sample| sample.is_finite()));
    assert!(left.iter().any(|sample| sample.abs() > 0.01));
    assert!(right.iter().any(|sample| sample.abs() > 0.01));
    assert!(left.iter().zip(&right).any(|(l, r)| (l - r).abs() > 0.001));
    assert!(
        left[16 * FERMENTER_BLOCK_FRAMES..20 * FERMENTER_BLOCK_FRAMES]
            .iter()
            .any(|sample| sample.abs() > 0.001)
    );
    assert_eq!(instance.get_nan_flush_count(), 0.0);

    // Exactly one complete, machine-readable payload for the browser-side
    // test. This is the native render itself, never a checked-in PCM oracle.
    println!(
        "\n{SENTINEL}{}",
        json!({
            "framesPerChannel": FRAMES,
            "left": left,
            "right": right,
        })
    );
}
