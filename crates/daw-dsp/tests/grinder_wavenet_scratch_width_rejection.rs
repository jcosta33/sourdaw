use daw_dsp::grinder::engine::GrinderEngine;
use daw_dsp::grinder::nam::native_admission::NativeNamPlan;

/// One legacy-head layer array: no head bias unless asked, ungated, layer1x1
/// active, head1x1 inactive.
struct Array {
    input: usize,
    channels: usize,
    head: usize,
    kernel: usize,
    dilations: Vec<u64>,
    head_bias: bool,
}

/// A kernel-1, single-dilation array over `(input_size, channels, head_size)`.
fn array((input, channels, head): (usize, usize, usize)) -> Array {
    Array {
        input,
        channels,
        head,
        kernel: 1,
        dilations: vec![1],
        head_bias: false,
    }
}

impl Array {
    fn json(&self) -> (serde_json::Value, usize) {
        let json = serde_json::json!({
            "input_size": self.input,
            "condition_size": 1,
            "channels": self.channels,
            "head_size": self.head,
            "head_bias": self.head_bias,
            "kernel_size": self.kernel,
            "dilations": self.dilations,
            "activation": "Tanh",
            "gated": false,
        });
        let c = self.channels;
        // Per layer: dilated conv with bias, input mixin, layer1x1 with bias.
        let layer = c * c * self.kernel + c + c + c * c + c;
        // Rechannel, the layers, and the head rechannel fed by the bottleneck
        // (which defaults to channels).
        let weights = self.input * c
            + self.dilations.len() * layer
            + c * self.head
            + if self.head_bias { self.head } else { 0 };
        (json, weights)
    }
}

/// A mono WaveNet capture over these arrays, with a single-conv post-stack
/// head when the last head is not mono.
fn capture_of(arrays: &[Array]) -> String {
    let mut weight_count = 1;
    let layers: Vec<_> = arrays
        .iter()
        .map(|array| {
            let (json, weights) = array.json();
            weight_count += weights;
            json
        })
        .collect();
    let last_head = arrays.last().expect("at least one array").head;
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

fn wavenet_capture(arrays: &[(usize, usize, usize)]) -> String {
    capture_of(&arrays.iter().copied().map(array).collect::<Vec<_>>())
}

/// The stock NAM trainer shape: two arrays over dilations 1..512 with kernel
/// 3, the second ending in a biased mono head.
fn stock_capture(first_channels: usize, first_head: usize, second_channels: usize) -> String {
    let dilations: Vec<u64> = (0..10).map(|power| 1 << power).collect();
    capture_of(&[
        Array {
            input: 1,
            channels: first_channels,
            head: first_head,
            kernel: 3,
            dilations: dilations.clone(),
            head_bias: false,
        },
        Array {
            input: first_channels,
            channels: second_channels,
            head: 1,
            kernel: 3,
            dilations,
            head_bias: true,
        },
    ])
}

fn load(capture: &str) -> (GrinderEngine, Result<(), String>) {
    let mut engine = GrinderEngine::new(48_000.0);
    let result = engine.load_neural_model(capture);
    (engine, result)
}

const NATIVE_REFUSAL: &str = "WaveNet fixed scratch/cross-array shape";
const MEMORY_POLICY: &str = "state/resident/prewarm/work policy";

fn render(label: &str, engine: &mut GrinderEngine) {
    engine.set_param("engineMode", 1.0);
    let mut left = [0.1_f32; 128];
    let mut right = left;
    engine.process_block(&mut left, &mut right);
    assert!(left.iter().all(|sample| sample.is_finite()), "{label}");
}

fn assert_admitted_everywhere(label: &str, capture: &str) {
    if let Err(error) = NativeNamPlan::inspect(capture, 48_000.0) {
        panic!("{label}: native admission must accept this shape: {error}");
    }
    let (mut engine, result) = load(capture);
    if let Err(error) = result {
        panic!("{label}: a shape native admits must load: {error}");
    }
    render(label, &mut engine);
}

/// Native admission and the WASM parser both refuse, each naming `reason`:
/// the parser runs native admission's shared plan before building anything.
fn assert_refused_everywhere(label: &str, capture: &str, reason: &str) {
    match NativeNamPlan::inspect(capture, 48_000.0) {
        Ok(_) => panic!("{label}: native admission must refuse this shape"),
        Err(error) => assert!(error.contains(reason), "{label}: native: {error}"),
    }
    let (engine, result) = load(capture);
    match result {
        Ok(()) => panic!("{label}: a shape native refuses must not load"),
        Err(error) => assert!(error.contains(reason), "{label}: wasm: {error}"),
    }
    assert!(!engine.has_loaded_neural_model(), "{label}");
}

/// Every case runs, so one report names each rule a door misses; a panicking
/// case counts as a miss rather than ending the sweep.
fn assert_all_refused_everywhere(cases: &[(&str, String, &str)]) {
    let misses: Vec<&str> = cases
        .iter()
        .filter(|(label, capture, reason)| {
            std::panic::catch_unwind(|| assert_refused_everywhere(label, capture, reason)).is_err()
        })
        .map(|(label, _, _)| *label)
        .collect();
    assert!(misses.is_empty(), "rules a door misses: {misses:?}");
}

#[test]
fn a_feeding_array_that_narrows_its_channels_is_refused_before_prewarm() {
    // #5981: array 1 feeds array 2 at one channel while the scratch carrying
    // array outputs between arrays is sized from array 0's two channels.
    let capture = wavenet_capture(&[(1, 2, 1), (2, 1, 1), (1, 1, 1)]);
    assert_refused_everywhere("narrowing feeding array", &capture, NATIVE_REFUSAL);
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
        assert_refused_everywhere(&format!("{arrays:?}"), &capture, NATIVE_REFUSAL);
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
    for (index, capture) in captures.iter().enumerate() {
        assert_admitted_everywhere(&format!("capture {index}"), capture);
    }
}

#[test]
fn the_stock_trainer_shapes_load_in_the_browser() {
    for (label, first_channels, first_head, second_channels) in [
        ("standard", 16, 8, 8),
        ("lite", 12, 6, 6),
        ("feather", 8, 4, 4),
        ("nano", 4, 2, 2),
    ] {
        let capture = stock_capture(first_channels, first_head, second_channels);
        let (mut engine, result) = load(&capture);
        if let Err(error) = result {
            panic!("{label}: the stock shape must load in the browser: {error}");
        }
        render(label, &mut engine);
    }
    for (label, capture) in [
        ("feather", stock_capture(8, 4, 4)),
        ("nano", stock_capture(4, 2, 2)),
    ] {
        assert_admitted_everywhere(label, &capture);
    }
}

#[test]
fn the_per_sample_work_ceilings_stay_native_only() {
    // The standard shape costs about 13k multiply-accumulates per sample,
    // over native's 4096 ceiling for the desktop instance ledger. The browser
    // has no such ledger and loads it; its memory envelope is unchanged.
    let capture = stock_capture(16, 8, 8);
    assert!(NativeNamPlan::inspect(&capture, 48_000.0)
        .unwrap_err()
        .contains(MEMORY_POLICY));
    let (engine, result) = load(&capture);
    result.expect("the standard shape must load in the browser");
    assert!(engine.has_loaded_neural_model());
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
        assert_admitted_everywhere(&format!("{arrays:?}"), &capture);
    }

    // Array 1's three channels do not match array 0's nested head width.
    let capture = with_nested_heads(&wavenet_capture(&[(1, 2, 2), (2, 3, 1)]));
    assert_refused_everywhere("nested head 2 into channels 3", &capture, NATIVE_REFUSAL);
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

#[test]
fn a_first_array_wider_than_the_mono_input_is_refused_before_prewarm() {
    let capture = wavenet_capture(&[(2, 2, 1)]);
    assert_refused_everywhere("array 0 input_size 2", &capture, NATIVE_REFUSAL);
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
        "mono WaveNet output required",
    );
    // A two-channel post-stack head output: one conv of 2 -> 2 with bias.
    let stereo_head = edit(&wide_head, |capture| {
        capture["config"]["head"]["out_channels"] = serde_json::json!(2);
        resize_weights(capture, 3);
    });
    assert_refused_everywhere(
        "post-stack head out_channels 2",
        &stereo_head,
        "out_channels",
    );
    let stereo_root = edit(&wavenet_capture(&[(1, 2, 1)]), |capture| {
        capture["config"]["out_channels"] = serde_json::json!(2);
    });
    assert_refused_everywhere("root out_channels 2", &stereo_root, "out_channels");
}

#[test]
fn a_gating_mode_decides_over_the_legacy_gated_flag() {
    let capture = edit(&wavenet_capture(&[(1, 2, 1)]), |capture| {
        capture["config"]["layers"][0]["gating_mode"] = serde_json::json!("none");
        capture["config"]["layers"][0]["gated"] = serde_json::json!(true);
    });
    assert_admitted_everywhere("gating_mode none over gated true", &capture);
    // A gating_mode that is not a string is not a mode: both doors fall back
    // to the legacy flag, as NAMCore reads it.
    let capture = edit(&wavenet_capture(&[(1, 2, 1)]), |capture| {
        capture["config"]["layers"][0]["gating_mode"] = serde_json::json!(5);
    });
    assert_admitted_everywhere("non-string gating_mode", &capture);
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
    let post_head = |change: fn(&mut serde_json::Value), delta: isize| {
        edit(&wavenet_capture(&[(1, 2, 2)]), |capture| {
            change(&mut capture["config"]["head"]);
            resize_weights(capture, delta);
        })
    };
    assert_all_refused_everywhere(&[
        (
            "boolean FiLM key",
            array(|array| array["conv_pre_film"] = serde_json::json!(true)),
            "FiLM unsupported",
        ),
        (
            "null FiLM key",
            array(|array| array["conv_pre_film"] = serde_json::Value::Null),
            "FiLM unsupported",
        ),
        (
            "unlisted FiLM key",
            array(|array| array["custom_film"] = serde_json::json!({ "active": true })),
            "FiLM unsupported",
        ),
        (
            "grouped inactive head1x1",
            array(|array| array["head1x1"] = serde_json::json!({ "active": false, "groups": 2 })),
            "groups",
        ),
        (
            "grouped layer1x1",
            array(|array| array["layer1x1"] = serde_json::json!({ "active": true, "groups": 2 })),
            "groups",
        ),
        (
            "non-integer groups_input",
            array(|array| array["groups_input"] = serde_json::json!("1")),
            "groups_input",
        ),
        (
            "grouped input mixin",
            array(|array| array["groups_input_mixin"] = serde_json::json!(2)),
            "groups_input_mixin",
        ),
        (
            "non-boolean gated",
            array(|array| array["gated"] = serde_json::json!("yes")),
            "gated",
        ),
        (
            "non-boolean layer1x1 active",
            array(|array| array["layer1x1"] = serde_json::json!({ "active": "no" })),
            "active",
        ),
        (
            "active head1x1 without out_channels",
            array(|array| array["head1x1"] = serde_json::json!({ "active": true })),
            "out_channels",
        ),
        (
            "non-integer bottleneck",
            array(|array| array["bottleneck"] = serde_json::json!("x")),
            "bottleneck",
        ),
        (
            "zero dilation",
            array(|array| array["dilations"] = serde_json::json!([0])),
            "integer dimension",
        ),
        (
            "non-integer root in_channels",
            edit(&base, |capture| {
                capture["config"]["in_channels"] = serde_json::json!("1")
            }),
            "in_channels",
        ),
        (
            "zero nested head dilation",
            edit(&with_nested_heads(&base), |capture| {
                capture["config"]["layers"][0]["head"]["head_dilation"] = serde_json::json!(0)
            }),
            "head_dilation",
        ),
        (
            "zero kernel size",
            edit(&base, |capture| {
                capture["config"]["layers"][0]["kernel_sizes"] = serde_json::json!([0]);
                // The dilated conv loses its 2 x 2 taps.
                resize_weights(capture, -4);
            }),
            "integer dimension",
        ),
        (
            "zero post-stack head kernel",
            // The 2 -> 1 head conv keeps only its bias.
            post_head(|head| head["kernel_sizes"] = serde_json::json!([0]), -2),
            "integer dimension",
        ),
    ]);

    for (label, capture) in [
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
    ] {
        assert_admitted_everywhere(label, &capture);
    }
}

fn with_dilations(dilations: Vec<u64>, kernel: usize) -> Array {
    Array {
        kernel,
        dilations,
        ..array((1, 2, 1))
    }
}

#[test]
fn every_size_cap_refuses_both_doors_just_over_its_ceiling() {
    let base = wavenet_capture(&[(1, 2, 1)]);
    let array = |change: fn(&mut serde_json::Value), delta: isize| {
        edit(&base, |capture| {
            change(&mut capture["config"]["layers"][0]);
            resize_weights(capture, delta);
        })
    };
    let post_head = |change: fn(&mut serde_json::Value), delta: isize| {
        edit(&wavenet_capture(&[(1, 2, 2)]), |capture| {
            change(&mut capture["config"]["head"]);
            resize_weights(capture, delta);
        })
    };
    let five_arrays = [(1, 2, 2), (2, 2, 2), (2, 2, 2), (2, 2, 2), (2, 2, 1)];
    let spread = |first: usize, second: usize| {
        capture_of(&[
            Array {
                head: 2,
                ..with_dilations(vec![1; first], 1)
            },
            Array {
                input: 2,
                ..with_dilations(vec![1; second], 1)
            },
        ])
    };
    assert_all_refused_everywhere(&[
        (
            "dilation 32769",
            capture_of(&[with_dilations(vec![32_769], 1)]),
            "integer dimension",
        ),
        (
            "head_dilation 32769",
            edit(&with_nested_heads(&base), |capture| {
                capture["config"]["layers"][0]["head"]["head_dilation"] = serde_json::json!(32_769)
            }),
            "head_dilation",
        ),
        ("five layer arrays", wavenet_capture(&five_arrays), "layers"),
        (
            "33 dilations in one array",
            capture_of(&[with_dilations(vec![1; 33], 1)]),
            "dilations",
        ),
        (
            "33 layers across arrays",
            spread(17, 16),
            "WaveNet layer count",
        ),
        (
            "input_size 65",
            wavenet_capture(&[(65, 2, 1)]),
            "input_size",
        ),
        ("channels 65", wavenet_capture(&[(1, 65, 1)]), "channels"),
        (
            "bottleneck 65",
            // Conv 2 -> 65, mixin 65, layer1x1 65 -> 2 and head 65 -> 1.
            array(|array| array["bottleneck"] = serde_json::json!(65), 441),
            "bottleneck",
        ),
        (
            "gated width 66",
            // Conv 2 -> 66, mixin 66, layer1x1 33 -> 2 and head 33 -> 1.
            array(
                |array| {
                    array["gated"] = serde_json::json!(true);
                    array["bottleneck"] = serde_json::json!(33);
                },
                349,
            ),
            "gated width",
        ),
        ("head_size 65", wavenet_capture(&[(1, 2, 65)]), "head_size"),
        (
            "nested head out_channels 65",
            with_nested_heads(&wavenet_capture(&[(1, 2, 65)])),
            "out_channels",
        ),
        (
            "head1x1 out_channels 65",
            // head1x1 2 -> 65 with bias, and the head reads 65 not 2.
            array(
                |array| {
                    array["head1x1"] = serde_json::json!({ "active": true, "out_channels": 65 })
                },
                258,
            ),
            "out_channels",
        ),
        (
            "condition_size 2",
            array(|array| array["condition_size"] = serde_json::json!(2), 2),
            "condition_size",
        ),
        (
            "kernel_size 10",
            capture_of(&[with_dilations(vec![1], 10)]),
            "kernel_size",
        ),
        (
            "kernel_sizes entry 10",
            array(|array| array["kernel_sizes"] = serde_json::json!([10]), 36),
            "integer dimension",
        ),
        (
            "post-stack head kernel 10",
            post_head(|head| head["kernel_sizes"] = serde_json::json!([10]), 18),
            "integer dimension",
        ),
        (
            "post-stack head with 9 kernels",
            // Eight more 1 -> 1 convs with bias after the 2 -> 1.
            post_head(
                |head| head["kernel_sizes"] = serde_json::json!(vec![1; 9]),
                16,
            ),
            "kernel_sizes",
        ),
        (
            "post-stack head channels 65",
            // One kernel: the only conv is 2 -> 1, so channels shape nothing.
            post_head(|head| head["channels"] = serde_json::json!(65), 0),
            "channels",
        ),
        (
            "PReLU with 65 slopes",
            array(
                |array| {
                    array["activation"] =
                        serde_json::json!({ "type": "PReLU", "negative_slopes": vec![0.25; 65] })
                },
                0,
            ),
            "negative_slopes",
        ),
    ]);

    for (label, capture) in [
        (
            "four layer arrays",
            wavenet_capture(&[(1, 2, 2), (2, 2, 2), (2, 2, 2), (2, 2, 1)]),
        ),
        ("32 layers across arrays", spread(16, 16)),
        (
            "dilation 32768",
            capture_of(&[with_dilations(vec![32_768], 1)]),
        ),
        ("kernel_size 9", capture_of(&[with_dilations(vec![1], 9)])),
    ] {
        assert_admitted_everywhere(label, &capture);
    }
}

#[test]
fn the_memory_envelope_refuses_both_doors_just_over_its_ceiling() {
    let wide = |dilation: u64| {
        capture_of(&[Array {
            channels: 32,
            ..with_dilations(vec![dilation], 3)
        }])
    };
    let narrow = |dilation: u64| {
        capture_of(&[Array {
            channels: 1,
            ..with_dilations(vec![dilation], 3)
        }])
    };
    assert_all_refused_everywhere(&[
        // One 32-channel tap history of 32769 frames plus the head's 32.
        ("state 1_048_640", wide(16_384), MEMORY_POLICY),
        // State sits exactly at its ceiling; its floats alone fill 8 MiB.
        ("resident over 8 MiB", wide(16_383), MEMORY_POLICY),
        // A lookback of 65536 frames rounds the prewarm up to 65600.
        ("prewarm 65600", narrow(32_768), MEMORY_POLICY),
    ]);
    // A lookback of 65534 frames rounds the prewarm up to exactly 65536.
    assert_admitted_everywhere("prewarm 65536", &narrow(32_767));
    // The transient preparation envelope has no case of its own: with every
    // other cap held it peaks near 21 MiB of its 32 MiB ceiling.
}

#[test]
fn the_text_scan_limits_refuse_both_doors_just_over_their_ceiling() {
    let base = wavenet_capture(&[(1, 2, 1)]);
    let config =
        |change: fn(&mut serde_json::Value)| edit(&base, |capture| change(&mut capture["config"]));
    let padded = |bytes: usize| format!("{base}{}", " ".repeat(bytes - base.len()));
    let nested = |levels: usize| {
        (0..levels).fold(serde_json::json!(0), |inner, _| serde_json::json!([inner]))
    };
    let deep = |levels: usize| edit(&base, |capture| capture["config"]["pad"] = nested(levels));
    let replaced = |from: &str, to: &str| {
        assert!(base.contains(from), "{from}");
        base.replacen(from, to, 1)
    };
    // 0.02 followed by 61 zeros: a 65-character token for the same value.
    let long_number = format!("\"head_scale\":0.02{}", "0".repeat(61));
    assert_all_refused_everywhere(&[
        ("model text over 1 MiB", padded(1_048_577), "model byte"),
        (
            "root metadata over 64 KiB",
            edit(&base, |capture| {
                for index in 0..17 {
                    capture[format!("metadata{index}")] =
                        serde_json::Value::String("x".repeat(4096));
                }
            }),
            "JSON/metadata limit",
        ),
        (
            "config over 16 KiB",
            config(|config| {
                for index in 0..4 {
                    config[format!("notes{index}")] = serde_json::Value::String("x".repeat(4096));
                }
            }),
            "config byte limit",
        ),
        (
            "65537 weights",
            edit(&base, |capture| resize_weights(capture, 65_537 - 19)),
            "weight limit",
        ),
        (
            "over 4096 JSON values",
            config(|config| config["pad"] = serde_json::json!(vec![0; 4096])),
            "JSON depth/node limit",
        ),
        // The config sits at depth 1, `pad` at 2, so 31 wrappers put the
        // innermost value at depth 33.
        ("nesting depth 33", deep(31), "JSON depth/node limit"),
        (
            "a 4097-byte string",
            config(|config| config["note"] = serde_json::Value::String("x".repeat(4097))),
            "string limit",
        ),
        (
            "an escaped key",
            config(|config| config["a\"b"] = serde_json::json!(1)),
            "escaped JSON keys",
        ),
        (
            "a duplicate key",
            replaced(
                "\"head_scale\":0.02",
                "\"head_scale\":0.02,\"head_scale\":0.02",
            ),
            "duplicate key",
        ),
        (
            "a number past f32",
            config(|config| config["pad"] = serde_json::json!(1.0e39)),
            "non-finite number",
        ),
        (
            "a 65-character number",
            replaced("\"head_scale\":0.02", &long_number),
            "numeric token limit",
        ),
    ]);
    for (label, capture) in [
        ("model text of exactly 1 MiB", padded(1_048_576)),
        ("nesting depth 32", deep(30)),
        (
            "a 4096-byte string",
            config(|config| config["note"] = serde_json::Value::String("x".repeat(4096))),
        ),
    ] {
        assert_admitted_everywhere(label, &capture);
    }
}
