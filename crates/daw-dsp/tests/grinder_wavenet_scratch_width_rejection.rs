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

/// The same capture with every array's head given only through the nested
/// `head` object (kernel 1, no bias), so the weight count is unchanged.
fn with_nested_heads(capture: &str) -> String {
    let mut capture: serde_json::Value = serde_json::from_str(capture).expect("capture JSON");
    for array in capture["config"]["layers"]
        .as_array_mut()
        .expect("layer arrays")
    {
        let array = array.as_object_mut().expect("layer array object");
        let head_size = array.remove("head_size").expect("legacy head_size");
        array.insert(
            "head".into(),
            serde_json::json!({ "out_channels": head_size, "kernel_size": 1, "bias": false }),
        );
    }
    capture.to_string()
}

#[test]
fn a_nested_head_multi_array_capture_loads_exactly_when_native_admits_it() {
    for arrays in [
        vec![(1, 2, 2), (2, 2, 1)],
        vec![(1, 2, 2), (2, 2, 2), (2, 2, 1)],
    ] {
        let capture = with_nested_heads(&wavenet_capture(&arrays));
        NativeNamPlan::inspect(&capture, 48_000.0).expect("native admission accepts this shape");

        let (mut engine, result) = load(&capture);
        result.unwrap_or_else(|error| {
            panic!("{arrays:?}: a nested-head shape native admits must load: {error}")
        });
        assert!(engine.has_loaded_neural_model());
        engine.set_param("engineMode", 1.0);
        let mut left = [0.1_f32; 128];
        let mut right = left;
        engine.process_block(&mut left, &mut right);
        assert!(left.iter().all(|sample| sample.is_finite()));
    }

    // Array 1's three channels do not match array 0's nested head width.
    let capture = with_nested_heads(&wavenet_capture(&[(1, 2, 2), (2, 3, 1)]));
    assert!(NativeNamPlan::inspect(&capture, 48_000.0)
        .unwrap_err()
        .contains(NATIVE_REFUSAL));
    let (engine, result) = load(&capture);
    let error = result.expect_err("a nested-head shape native refuses must not load");
    assert!(
        error.contains("layer array 1: channels must equal the preceding array's head_size"),
        "{error}"
    );
    assert!(!engine.has_loaded_neural_model());
}

fn edit(capture: &str, change: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut capture: serde_json::Value = serde_json::from_str(capture).expect("capture JSON");
    change(&mut capture);
    capture.to_string()
}

fn resize_weights(capture: &mut serde_json::Value, delta: isize) {
    let weights = capture["weights"].as_array_mut().expect("weights");
    let count = weights
        .len()
        .checked_add_signed(delta)
        .expect("weight count");
    weights.resize(count, serde_json::json!(0.125));
}

fn assert_admitted_everywhere(label: &str, capture: &str) {
    if let Err(error) = NativeNamPlan::inspect(capture, 48_000.0) {
        panic!("{label}: native admission must accept this shape: {error}");
    }
    let (mut engine, result) = load(capture);
    if let Err(error) = result {
        panic!("{label}: a shape native admits must load: {error}");
    }
    engine.set_param("engineMode", 1.0);
    let mut left = [0.1_f32; 128];
    let mut right = left;
    engine.process_block(&mut left, &mut right);
    assert!(left.iter().all(|sample| sample.is_finite()), "{label}");
}

fn assert_refused_everywhere(label: &str, capture: &str, wasm_reason: &str) {
    assert!(
        NativeNamPlan::inspect(capture, 48_000.0).is_err(),
        "{label}: native admission must refuse this shape"
    );
    let (engine, result) = load(capture);
    match result {
        Ok(()) => panic!("{label}: a shape native refuses must not load"),
        Err(error) => assert!(error.contains(wasm_reason), "{label}: {error}"),
    }
    assert!(!engine.has_loaded_neural_model(), "{label}");
}

#[test]
fn a_first_array_wider_than_the_mono_input_is_refused_before_prewarm() {
    let capture = wavenet_capture(&[(2, 2, 1)]);
    assert!(NativeNamPlan::inspect(&capture, 48_000.0)
        .unwrap_err()
        .contains(NATIVE_REFUSAL));
    assert_refused_everywhere(
        "array 0 input_size 2",
        &capture,
        "layer array 0: input_size must be 1",
    );
}

#[test]
fn a_capture_whose_output_is_not_mono_is_refused_before_prewarm() {
    let wide_head = wavenet_capture(&[(1, 2, 2)]);
    // No post-stack head: the last array's two-channel head is the output.
    let headless = edit(&wide_head, |capture| {
        capture["config"]["head"] = serde_json::Value::Null;
        resize_weights(capture, -3);
    });
    assert_refused_everywhere(
        "last head 2, no post-stack head",
        &headless,
        "multi-channel WaveNet output (2 channels)",
    );
    // A two-channel post-stack head output: one conv of 2 -> 2 with bias.
    let stereo_head = edit(&wide_head, |capture| {
        capture["config"]["head"]["out_channels"] = serde_json::json!(2);
        resize_weights(capture, 3);
    });
    assert_refused_everywhere(
        "post-stack head out_channels 2",
        &stereo_head,
        "multi-channel WaveNet output (2 channels)",
    );
    let stereo_root = edit(&wavenet_capture(&[(1, 2, 1)]), |capture| {
        capture["config"]["out_channels"] = serde_json::json!(2);
    });
    assert_refused_everywhere(
        "root out_channels 2",
        &stereo_root,
        "multi-channel WaveNet (1 -> 2 channels)",
    );
}

#[test]
fn a_gating_mode_decides_over_the_legacy_gated_flag() {
    let capture = edit(&wavenet_capture(&[(1, 2, 1)]), |capture| {
        capture["config"]["layers"][0]["gating_mode"] = serde_json::json!("none");
        capture["config"]["layers"][0]["gated"] = serde_json::json!(true);
    });
    assert_admitted_everywhere("gating_mode none over gated true", &capture);
}

#[test]
fn the_channel_chain_reads_head_size_before_a_nested_head() {
    // Array 1's three channels match array 0's head_size; its head1x1
    // narrows the accumulation to array 0's nested head width of two.
    let weights: Vec<f32> = (0..64)
        .map(|index| ((index + 1) as f32).sin() * 0.25)
        .collect();
    let capture = serde_json::json!({
        "version": "0.5.4",
        "architecture": "WaveNet",
        "sample_rate": 48_000,
        "config": { "head": null, "head_scale": 0.02, "layers": [
            { "input_size": 1, "condition_size": 1, "channels": 2, "head_size": 3,
              "head": { "out_channels": 2, "kernel_size": 1, "bias": false },
              "head_bias": false, "kernel_size": 1, "dilations": [1],
              "activation": "Tanh", "gated": false },
            { "input_size": 2, "condition_size": 1, "channels": 3, "head_size": 1,
              "head1x1": { "active": true, "out_channels": 2 },
              "head_bias": false, "kernel_size": 1, "dilations": [1],
              "activation": "Tanh", "gated": false }
        ]},
        "weights": weights,
    })
    .to_string();
    assert_admitted_everywhere("head_size 3 beside a nested head of 2", &capture);
}

#[test]
fn every_wavenet_rule_native_admission_enforces_refuses_the_wasm_parser_too() {
    let base = wavenet_capture(&[(1, 2, 1)]);
    let array = |change: fn(&mut serde_json::Value)| {
        edit(&base, |capture| change(&mut capture["config"]["layers"][0]))
    };
    let refused = [
        (
            "boolean FiLM key",
            array(|array| array["conv_pre_film"] = serde_json::json!(true)),
            "FiLM modulation (\"conv_pre_film\")",
        ),
        (
            "null FiLM key",
            array(|array| array["conv_pre_film"] = serde_json::Value::Null),
            "FiLM modulation (\"conv_pre_film\")",
        ),
        (
            "unlisted FiLM key",
            array(|array| array["custom_film"] = serde_json::json!({ "active": true })),
            "FiLM modulation (\"custom_film\")",
        ),
        (
            "grouped inactive head1x1",
            array(|array| array["head1x1"] = serde_json::json!({ "active": false, "groups": 2 })),
            "grouped head1x1 convolutions",
        ),
        (
            "non-integer groups_input",
            array(|array| array["groups_input"] = serde_json::json!("1")),
            "grouped WaveNet convolutions (groups_input",
        ),
        (
            "non-boolean gated",
            array(|array| array["gated"] = serde_json::json!("yes")),
            "WaveNet gated must be a boolean",
        ),
        (
            "non-boolean layer1x1 active",
            array(|array| array["layer1x1"] = serde_json::json!({ "active": "no" })),
            "WaveNet active must be a boolean",
        ),
        (
            "active head1x1 without out_channels",
            array(|array| array["head1x1"] = serde_json::json!({ "active": true })),
            "WaveNet layer array requires out_channels",
        ),
        (
            "non-integer bottleneck",
            array(|array| array["bottleneck"] = serde_json::json!("x")),
            "WaveNet layer array requires bottleneck",
        ),
        (
            "zero dilation",
            array(|array| array["dilations"] = serde_json::json!([0])),
            "WaveNet dilations must be positive integers",
        ),
        (
            "non-integer root in_channels",
            edit(&base, |capture| {
                capture["config"]["in_channels"] = serde_json::json!("1")
            }),
            "WaveNet layer array requires in_channels",
        ),
        (
            "zero nested head dilation",
            edit(&with_nested_heads(&base), |capture| {
                capture["config"]["layers"][0]["head"]["head_dilation"] = serde_json::json!(0)
            }),
            "WaveNet head_dilation must be a positive integer",
        ),
        (
            "zero kernel size",
            edit(&base, |capture| {
                capture["config"]["layers"][0]["kernel_sizes"] = serde_json::json!([0]);
                // The dilated conv loses its 2 x 2 taps.
                resize_weights(capture, -4);
            }),
            "WaveNet kernel_sizes must be positive integers",
        ),
    ];
    // Every case runs, so one report names each rule the parser misses; a
    // panicking load counts as a miss rather than ending the sweep.
    let misses: Vec<&str> = refused
        .iter()
        .filter(|(label, capture, wasm_reason)| {
            std::panic::catch_unwind(|| assert_refused_everywhere(label, capture, wasm_reason))
                .is_err()
        })
        .map(|(label, _, _)| *label)
        .collect();
    assert!(
        misses.is_empty(),
        "rules the WASM parser misses: {misses:?}"
    );

    let admitted = [
        (
            "inactive FiLM keys",
            array(|array| {
                array["conv_pre_film"] = serde_json::json!(false);
                array["conv_post_film"] = serde_json::json!({ "active": false });
            }),
        ),
        (
            "ungrouped inactive head1x1",
            array(|array| array["head1x1"] = serde_json::json!({ "active": false, "groups": 1 })),
        ),
    ];
    for (label, capture) in &admitted {
        assert_admitted_everywhere(label, capture);
    }
}
