use daw_dsp::grinder::engine::GrinderEngine;

fn lstm_capture(num_layers: usize, hidden_size: usize) -> String {
    // Each cell carries its (4h, input + h) matrix, four gate biases,
    // initial hidden and cell state; the mono head adds h weights and a bias.
    let weight_count = (0..num_layers)
        .map(|layer| {
            let input_size = if layer == 0 { 1 } else { hidden_size };
            4 * hidden_size * (input_size + hidden_size) + 6 * hidden_size
        })
        .sum::<usize>()
        + hidden_size
        + 1;
    serde_json::json!({
        "version": "0.5.4",
        "architecture": "LSTM",
        "sample_rate": 48_000,
        "config": {
            "num_layers": num_layers,
            "input_size": 1,
            "hidden_size": hidden_size,
            "out_channels": 1,
        },
        "weights": vec![0.0_f32; weight_count],
    })
    .to_string()
}

#[test]
fn stacked_wide_lstm_is_rejected_without_loading_or_panicking() {
    let mut engine = GrinderEngine::new(48_000.0);

    let error = engine
        .load_neural_model(&lstm_capture(2, 2))
        .expect_err("a stacked hidden-size-2 LSTM must be rejected before prewarm");

    assert!(error.contains("stacked wide LSTM unsupported by current runtime"));
    assert!(!engine.has_loaded_neural_model());
}

#[test]
fn one_layer_and_stacked_single_hidden_unit_lstm_still_load() {
    let mut one_layer = GrinderEngine::new(48_000.0);
    one_layer
        .load_neural_model(include_str!("../src/grinder/nam/fixtures/lstm.nam"))
        .expect("the existing one-layer NAM capture must remain loadable");
    assert!(one_layer.has_loaded_neural_model());

    let mut stacked_single_hidden_unit = GrinderEngine::new(48_000.0);
    stacked_single_hidden_unit
        .load_neural_model(&lstm_capture(2, 1))
        .expect("a two-layer, single-hidden-unit LSTM must remain loadable");
    assert!(stacked_single_hidden_unit.has_loaded_neural_model());
}

#[test]
fn rejected_replacement_keeps_the_previously_loaded_capture_available() {
    let mut engine = GrinderEngine::new(48_000.0);
    let mut reference = GrinderEngine::new(48_000.0);
    let mut unloaded = GrinderEngine::new(48_000.0);
    for capture in [&mut engine, &mut reference, &mut unloaded] {
        capture.set_param("engineMode", 1.0);
        capture.set_param("neuralPlacement", 1.0);
        capture.set_param("gateEnabled", 0.0);
    }
    for capture in [&mut engine, &mut reference] {
        capture
            .load_neural_model(include_str!("../src/grinder/nam/fixtures/lstm.nam"))
            .expect("the existing one-layer NAM capture must load first");
    }

    // Advance both models before attempting replacement: rejection must retain
    // the sounding model and its recurrent state, not restart its playback.
    for _ in 0..32 {
        for capture in [&mut engine, &mut reference, &mut unloaded] {
            let mut left = [0.1_f32; 128];
            let mut right = left;
            capture.process_block(&mut left, &mut right);
        }
    }

    let error = engine
        .load_neural_model(&lstm_capture(2, 2))
        .expect_err("a replacement with unsupported topology must be rejected");

    assert!(error.contains("stacked wide LSTM unsupported by current runtime"));
    assert!(engine.has_loaded_neural_model());
    let input = std::array::from_fn::<_, 128, _>(|index| (index as f32 * 0.07).sin() * 0.1);
    let mut actual_left = input;
    let mut actual_right = input;
    let mut expected_left = input;
    let mut expected_right = input;
    let mut unloaded_left = input;
    let mut unloaded_right = input;
    engine.process_block(&mut actual_left, &mut actual_right);
    reference.process_block(&mut expected_left, &mut expected_right);
    unloaded.process_block(&mut unloaded_left, &mut unloaded_right);

    assert_eq!(actual_left, expected_left);
    assert_eq!(actual_right, expected_right);
    assert!(actual_left.iter().all(|sample| sample.is_finite()));
    assert!(actual_left.iter().any(|sample| sample.abs() > 0.0001));
    assert!(actual_left
        .iter()
        .zip(unloaded_left)
        .any(|(actual, dry)| (actual - dry).abs() > 0.001));
}
