use daw_dsp::grinder::engine::GrinderEngine;

fn lstm_capture(num_layers: usize, hidden_size: usize, weight_count: usize) -> String {
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
        .load_neural_model(&lstm_capture(2, 2, 83))
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
        .load_neural_model(&lstm_capture(2, 1, 30))
        .expect("a two-layer, single-hidden-unit LSTM must remain loadable");
    assert!(stacked_single_hidden_unit.has_loaded_neural_model());
}

#[test]
fn rejected_replacement_keeps_the_previously_loaded_capture_available() {
    let mut engine = GrinderEngine::new(48_000.0);
    engine
        .load_neural_model(include_str!("../src/grinder/nam/fixtures/lstm.nam"))
        .expect("the existing one-layer NAM capture must load first");

    let error = engine
        .load_neural_model(&lstm_capture(2, 2, 83))
        .expect_err("a replacement with unsupported topology must be rejected");

    assert!(error.contains("stacked wide LSTM unsupported by current runtime"));
    assert!(engine.has_loaded_neural_model());
    engine.reset();
    let mut left = [0.1_f32; 64];
    let mut right = [0.1_f32; 64];
    engine.process_block(&mut left, &mut right);
    assert!(left
        .iter()
        .chain(right.iter())
        .all(|sample| sample.is_finite()));
}
