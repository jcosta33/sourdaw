use std::path::Path;
use std::process::Command;

use daw_dsp::fermenter::{FermenterInstance, FERMENTER_BLOCK_FRAMES};
use serde_json::Value;

const BLOCKS: usize = 40;
const FRAMES: usize = BLOCKS * FERMENTER_BLOCK_FRAMES;
const SENTINEL: &str = "FERMENTER_NATIVE_WASM_PARITY_JSON:";
const MAX_STDOUT_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const ABS_TOLERANCE: f64 = 2e-5;
const REL_TOLERANCE: f64 = 2e-4;

struct StereoRender {
    left: Vec<f64>,
    right: Vec<f64>,
}

fn native_render() -> StereoRender {
    let mut instance = FermenterInstance::new(48_000.0, 8);
    // Keep this exact patch and the block-boundary MIDI sequence in the WASM helper.
    // Sine wavetable with noise, drift and chaos off is deterministic.
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
        // SAFETY: process returns two instance-owned blocks of this size. Copy
        // both before the next process call can overwrite their buffers.
        let left_block = unsafe { std::slice::from_raw_parts(left_ptr, FERMENTER_BLOCK_FRAMES) };
        let right_block = unsafe { std::slice::from_raw_parts(right_ptr, FERMENTER_BLOCK_FRAMES) };
        left.extend(left_block.iter().map(|&sample| f64::from(sample)));
        right.extend(right_block.iter().map(|&sample| f64::from(sample)));
    }

    assert_eq!(
        instance.get_nan_flush_count(),
        0.0,
        "native Fermenter scrubbed non-finite samples"
    );
    StereoRender { left, right }
}

fn wasm_render() -> StereoRender {
    let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fermenter_native_wasm_parity.mjs");
    let output = Command::new("node")
        .arg(&helper)
        .output()
        .unwrap_or_else(|error| panic!("cannot launch Node for shipped WASM render: {error}"));

    assert!(
        output.stdout.len() <= MAX_STDOUT_BYTES,
        "WASM helper stdout exceeds payload limit"
    );
    assert!(
        output.stderr.len() <= MAX_STDERR_BYTES,
        "WASM helper stderr exceeds diagnostic limit"
    );
    let stderr = String::from_utf8(output.stderr).expect("WASM helper stderr is not UTF-8");
    assert!(
        output.status.success(),
        "WASM helper failed ({}): {stderr}",
        output.status
    );

    let stdout = String::from_utf8(output.stdout).expect("WASM helper stdout is not UTF-8");
    assert!(stdout.ends_with('\n'), "WASM helper payload is truncated");
    let lines: Vec<_> = stdout.lines().collect();
    assert_eq!(
        lines.len(),
        1,
        "WASM helper must emit exactly one parity payload"
    );
    let payload = lines[0]
        .strip_prefix(SENTINEL)
        .expect("WASM helper emitted no parity payload");
    let value: Value =
        serde_json::from_str(payload).expect("WASM helper emitted malformed parity JSON");
    let object = value
        .as_object()
        .expect("WASM helper parity payload is not an object");
    assert_eq!(
        object.len(),
        4,
        "WASM helper parity payload has unexpected fields"
    );
    assert_eq!(
        object.get("framesPerChannel").and_then(Value::as_u64),
        Some(FRAMES as u64)
    );
    assert_eq!(
        object.get("nanFlushCount").and_then(Value::as_f64),
        Some(0.0),
        "WASM Fermenter scrubbed non-finite samples"
    );

    StereoRender {
        left: checked_channel(object.get("left"), "WASM left"),
        right: checked_channel(object.get("right"), "WASM right"),
    }
}

fn checked_channel(value: Option<&Value>, label: &str) -> Vec<f64> {
    let samples = value
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{label} is not an array"));
    assert_eq!(samples.len(), FRAMES, "{label} has wrong frame count");
    samples
        .iter()
        .enumerate()
        .map(|(frame, sample)| {
            let number = sample
                .as_f64()
                .unwrap_or_else(|| panic!("{label}[{frame}] is not a number"));
            assert!(number.is_finite(), "{label}[{frame}] is not finite");
            number
        })
        .collect()
}

fn assert_render(target: &str, render: &StereoRender) {
    assert_eq!(
        render.left.len(),
        FRAMES,
        "{target} left has wrong frame count"
    );
    assert_eq!(
        render.right.len(),
        FRAMES,
        "{target} right has wrong frame count"
    );
    assert!(
        render
            .left
            .iter()
            .chain(&render.right)
            .all(|sample| sample.is_finite()),
        "{target} contains non-finite samples"
    );
    assert!(
        render.left.iter().any(|sample| sample.abs() > 0.01),
        "{target} left is silent"
    );
    assert!(
        render.right.iter().any(|sample| sample.abs() > 0.01),
        "{target} right is silent"
    );
    assert!(
        render
            .left
            .iter()
            .zip(&render.right)
            .any(|(left, right)| (left - right).abs() > 0.001),
        "{target} lacks stereo separation"
    );
    assert!(
        render.left[16 * FERMENTER_BLOCK_FRAMES..20 * FERMENTER_BLOCK_FRAMES]
            .iter()
            .any(|sample| sample.abs() > 0.001),
        "{target} does not render release"
    );
}

// Native and WASM may round f32 SIMD/transcendental steps differently. This
// envelope allows 20 ppm at silence plus 0.02% of signal magnitude; it is far
// below a one-percent gain or one-sample timing error. No average hides a bad sample.
fn assert_parity(native: &StereoRender, wasm: &StereoRender) -> Result<(), String> {
    for (channel, expected, actual) in [
        ("left", &native.left, &wasm.left),
        ("right", &native.right, &wasm.right),
    ] {
        for frame in 0..FRAMES {
            let difference = (actual[frame] - expected[frame]).abs();
            let tolerance =
                ABS_TOLERANCE + REL_TOLERANCE * expected[frame].abs().max(actual[frame].abs());
            if difference > tolerance {
                return Err(format!(
                    "{channel}[{frame}]: native={}, WASM={}, difference={difference}, tolerance={tolerance}",
                    expected[frame], actual[frame]
                ));
            }
        }
    }
    Ok(())
}

#[test]
fn native_fermenter_render_for_wasm_parity() {
    let native = native_render();
    let wasm = wasm_render();
    assert_render("native", &native);
    assert_render("WASM", &wasm);
    assert_parity(&native, &wasm).unwrap_or_else(|mismatch| panic!("{mismatch}"));

    let mut perturbed_left = wasm.left.clone();
    perturbed_left[FERMENTER_BLOCK_FRAMES] += 0.01;
    let perturbed = StereoRender {
        left: perturbed_left,
        right: wasm.right.clone(),
    };
    let mismatch = assert_parity(&native, &perturbed)
        .expect_err("single-sample perturbation must break parity");
    assert!(
        mismatch.starts_with("left[128]:"),
        "wrong perturbation failure: {mismatch}"
    );
    println!("compared {FRAMES} native and shipped WASM frames in both channels; left[128] perturbation detected");
}
