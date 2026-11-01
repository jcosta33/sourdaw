use daw_dsp::grinder::engine::GrinderEngine;
use daw_dsp::grinder::nam::native_admission::NativeNamPlan;

/// One legacy-head layer array (`head_size`, no head bias, kernel 1, one
/// dilation, ungated, layer1x1 active, head1x1 inactive) and its weight count.
fn layer_array(input_size: usize, channels: usize, head_size: usize) -> (serde_json::Value, usize) {
    let array = serde_json::json!({
        "input_size": input_size,
        "condition_size": 1,
        "channels": channels,
        "head_size": head_size,
        "head_bias": false,
        "kernel_size": 1,
        "dilations": [1],
        "activation": "Tanh",
        "gated": false,
    });
    // Rechannel, dilated conv with bias, input mixin, layer1x1 with bias, and
    // the head rechannel fed by the bottleneck (which defaults to channels).
    let weights = input_size * channels
        + channels * channels
        + channels
        + channels
        + channels * channels
        + channels
        + channels * head_size;
    (array, weights)
}

/// A mono WaveNet capture over `(input_size, channels, head_size)` arrays,
/// with a single-conv post-stack head when the last head is not mono.
fn wavenet_capture(arrays: &[(usize, usize, usize)]) -> String {
    let mut weight_count = 1;
    let layers: Vec<_> = arrays
        .iter()
        .map(|&(input_size, channels, head_size)| {
            let (array, weights) = layer_array(input_size, channels, head_size);
            weight_count += weights;
            array
        })
        .collect();
    let last_head = arrays.last().expect("at least one array").2;
    let head = if last_head == 1 {
        serde_json::Value::Null
    } else {
        weight_count += last_head + 1;
        serde_json::json!({
            "channels": 1,
            "out_channels": 1,
            "kernel_sizes": [1],
            "activation": "Tanh",
        })
    };
    let weights: Vec<f32> = (0..weight_count)
        .map(|index| ((index + 1) as f32).sin() * 0.25)
        .collect();
    serde_json::json!({
        "version": "0.5.4",
        "architecture": "WaveNet",
        "sample_rate": 48_000,
        "config": { "layers": layers, "head": head, "head_scale": 0.02 },
        "weights": weights,
    })
    .to_string()
}

fn load(capture: &str) -> (GrinderEngine, Result<(), String>) {
    let mut engine = GrinderEngine::new(48_000.0);
    let result = engine.load_neural_model(capture);
    (engine, result)
}

const NATIVE_REFUSAL: &str = "WaveNet fixed scratch/cross-array shape";

#[test]
fn a_feeding_array_that_narrows_its_channels_is_refused_before_prewarm() {
    // #5981: array 1 feeds array 2 at one channel while the scratch carrying
    // array outputs between arrays is sized from array 0's two channels.
    let capture = wavenet_capture(&[(1, 2, 1), (2, 1, 1), (1, 1, 1)]);

    let (engine, result) = load(&capture);
    let error = result.expect_err("a narrowing feeding array must be refused before prewarm");
    assert!(
        error.contains("layer array 1: channels must equal the first array's channels"),
        "{error}"
    );
    assert!(!engine.has_loaded_neural_model());
    assert!(NativeNamPlan::inspect(&capture, 48_000.0)
        .unwrap_err()
        .contains(NATIVE_REFUSAL));
}

#[test]
fn an_array_head_narrower_than_the_widest_head_is_refused_before_prewarm() {
    // The head scratch carried between arrays is sized from the widest head.
    // A later head wider than the one that seeds the next array, and a final
    // array seeded by a head wider than its own accumulation, both misfit it.
    for arrays in [
        vec![(1, 2, 2), (2, 2, 3)],
        vec![(1, 2, 2), (2, 2, 1), (2, 1, 1)],
    ] {
        let capture = wavenet_capture(&arrays);

        let (engine, result) = load(&capture);
        let error =
            result.expect_err("a head scratch width mismatch must be refused before prewarm");
        assert!(
            error.contains("head input size")
                && error.contains("must equal the widest array head_size"),
            "{arrays:?}: {error}"
        );
        assert!(!engine.has_loaded_neural_model());
        assert!(NativeNamPlan::inspect(&capture, 48_000.0)
            .unwrap_err()
            .contains(NATIVE_REFUSAL));
    }
}

#[test]
fn shapes_native_admission_accepts_still_load_and_render() {
    let captures = [
        include_str!("../src/grinder/nam/fixtures/wavenet.nam").to_owned(),
        include_str!("../src/grinder/nam/fixtures/gated_wavenet_synthetic.nam").to_owned(),
        // Equal widths throughout, mono final head.
        wavenet_capture(&[(1, 2, 2), (2, 2, 2), (2, 2, 1)]),
        // The final array may narrow: nothing reads its channels afterwards.
        wavenet_capture(&[(1, 2, 1), (2, 1, 1)]),
        // A final head narrower than the heads before it.
        wavenet_capture(&[(1, 2, 2), (2, 2, 1)]),
    ];
    for capture in &captures {
        NativeNamPlan::inspect(capture, 48_000.0).expect("native admission accepts this shape");

        let (mut engine, result) = load(capture);
        result.expect("a shape native admission accepts must load");
        assert!(engine.has_loaded_neural_model());
        engine.set_param("engineMode", 1.0);
        let mut left = [0.1_f32; 128];
        let mut right = left;
        engine.process_block(&mut left, &mut right);
        assert!(left.iter().all(|sample| sample.is_finite()));
    }
}
