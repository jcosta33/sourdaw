//! The `proof-chamber` half of the legal-value weld, for `dutch-oven/algorithm`.
//!
//! `src/modules/Arrangement/models/DeviceLegalParameterValues.json` states which
//! engine each wire value selects. The host asserts its delivery law and its
//! declared set against that column
//! (`src/modules/Arrangement/models/__tests__/DeviceLegalParameterValues.spec.ts`);
//! this asserts the dispatch does.
//!
//! `algorithm_wire_contract.rs` already pins *which* engine each selectable
//! value builds, and that the reserved 4 and 5 fall back. What it does not pin
//! is that the host agrees — the descriptor declared `0..6` with no way to say
//! that two of those seven select nothing, and nothing compared the two files.
//! This is that comparison.
//!
//! The observable is the rendered signal, not a name. Two wire values agree
//! when they render identically, which is the claim a listener can check.

use proof_chamber::ProofChamberInstance;
use serde::Deserialize;
use std::collections::BTreeMap;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const FRAMES: usize = 8_192;

#[derive(Deserialize)]
struct Fixture {
    parameters: Vec<FixtureParameter>,
}

#[derive(Deserialize)]
struct FixtureParameter {
    #[serde(rename = "deviceType")]
    device_type: String,
    #[serde(rename = "paramId")]
    param_id: String,
    resolved: Vec<ResolvedValue>,
}

/// One wire value and the setting the host declaration delivers for it.
#[derive(Deserialize)]
struct ResolvedValue {
    raw: i64,
    setting: i64,
}

fn resolved_algorithms() -> Vec<ResolvedValue> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../src/modules/Arrangement/models/DeviceLegalParameterValues.json"
    ))
    .expect("the shared legal-value fixture must remain valid JSON");

    fixture
        .parameters
        .into_iter()
        .find(|entry| entry.device_type == "dutch-oven" && entry.param_id == "algorithm")
        .expect("the shared fixture no longer covers dutch-oven/algorithm")
        .resolved
}

/// Render a burst through one wire value at the engine's own default mix.
fn render_wire_value(algorithm: f32) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);

    let mut output = Vec::with_capacity(FRAMES);
    let mut index = 0;
    while index < FRAMES {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| if index + i < 256 { 0.8 } else { 0.0 })
            .collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            output.push(unsafe { *ptr.add(i) });
        }
        index += BLOCK;
    }

    output
}

/// Every declared wire value renders as the setting the host delivers for it.
///
/// The reserved 4 and 5 are the cases that matter: the host now delivers 0 for
/// both, and both must render exactly what 0 renders — otherwise the Inspector
/// would say Plate while something else played.
#[test]
fn every_declared_wire_value_renders_as_the_setting_the_host_delivers() {
    let resolved = resolved_algorithms();

    let mut rendered_by_setting: BTreeMap<i64, Vec<f32>> = BTreeMap::new();
    for entry in &resolved {
        rendered_by_setting
            .entry(entry.setting)
            .or_insert_with(|| render_wire_value(entry.setting as f32));
    }

    for ResolvedValue { raw, setting } in &resolved {
        let rendered = render_wire_value(*raw as f32);
        let target = rendered_by_setting
            .get(setting)
            .expect("every resolved setting was rendered above");
        assert_eq!(
            &rendered, target,
            "algorithm {raw} did not render what {setting} renders. The host declaration \
             delivers {setting} for {raw}, so the Inspector would name one engine while the \
             dispatch ran another."
        );
    }
}

/// The declared settings have to sound *different from each other*, or the
/// comparison above would pass on a fixture that resolved everything onto one
/// engine.
#[test]
fn the_declared_settings_are_audibly_distinct_from_one_another() {
    let settings: Vec<i64> = {
        let mut values: Vec<i64> = resolved_algorithms()
            .into_iter()
            .map(|entry| entry.setting)
            .collect();
        values.sort_unstable();
        values.dedup();
        values
    };
    assert!(
        settings.len() > 1,
        "the fixture resolves every wire value onto one setting, so it cannot detect a \
         mis-declared one"
    );

    let rendered: Vec<(i64, Vec<f32>)> = settings
        .iter()
        .map(|setting| (*setting, render_wire_value(*setting as f32)))
        .collect();

    for (index, (setting, signal)) in rendered.iter().enumerate() {
        for (other_setting, other_signal) in rendered.iter().skip(index + 1) {
            assert_ne!(
                signal, other_signal,
                "algorithms {setting} and {other_setting} render identically, so one of them is \
                 a declared setting the product cannot actually distinguish"
            );
        }
    }
}
