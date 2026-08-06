//! The `daw-dsp` half of the legal-value weld.
//!
//! `src/modules/Arrangement/models/DeviceLegalParameterValues.json` states, for
//! every value a host-declared legal set can be asked about, which setting the
//! engine resolves it to. The host asserts that its delivery law and its
//! declared set agree with that column
//! (`src/modules/Arrangement/models/__tests__/DeviceLegalParameterValues.spec.ts`);
//! this file asserts that the engines here do.
//!
//! The point is that neither side can move alone. A host descriptor that
//! declares `crust/oversampling` legal at `{1,2,4,8,16,32}` is a claim about
//! `normalize_factor`, and until this existed nothing checked it: the 1..32
//! range shipped for as long as it did precisely because the two sides were
//! only ever read one at a time.
//!
//! The fixture lives under `src/` rather than in this crate, following
//! `grinderAudioParamContract.json` — the host is the side that ships it, and a
//! copy here would be a fourth place to forget.

use daw_dsp::crust::oversample::normalize_factor;
use daw_dsp::gluten::oversample::ConfigurableOversample;
use serde::Deserialize;

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

/// One raw value and the setting the engine resolves it to.
#[derive(Deserialize)]
struct ResolvedValue {
    raw: i64,
    setting: i64,
}

fn resolved_for(device_type: &str, param_id: &str) -> Vec<ResolvedValue> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../src/modules/Arrangement/models/DeviceLegalParameterValues.json"
    ))
    .expect("the shared legal-value fixture must remain valid JSON");

    fixture
        .parameters
        .into_iter()
        .find(|entry| entry.device_type == device_type && entry.param_id == param_id)
        .unwrap_or_else(|| panic!("the shared fixture no longer covers {device_type}/{param_id}"))
        .resolved
}

/// Crust's cascade builds powers of two and floors anything between them.
#[test]
fn crust_oversampling_resolves_every_declared_value_as_the_host_says() {
    for ResolvedValue { raw, setting } in resolved_for("crust", "oversampling") {
        let actual = normalize_factor(raw as usize) as i64;
        assert_eq!(
            actual, setting,
            "crust/oversampling: `normalize_factor({raw})` is {actual}, but the host declaration \
             delivers {setting}. One of the two moved; a knob or an automation lane now shows a \
             factor the cascade does not run."
        );
    }
}

/// Gluten's oversampler builds 1x, 2x and 4x, and floors onto them.
///
/// The arm this pins used to send a requested 3 *up* to 4x while the host's own
/// `clampOversampling` sent it down to 2 — the same 3 meant two different
/// things depending on which surface wrote it. It floors now, and this is what
/// stops it drifting back.
#[test]
fn gluten_oversampling_resolves_every_declared_value_as_the_host_says() {
    for ResolvedValue { raw, setting } in resolved_for("gluten", "oversampling") {
        let mut oversampler = ConfigurableOversample::new(1);
        oversampler.set_rate(raw as u8);
        let actual = oversampler.rate as i64;
        assert_eq!(
            actual, setting,
            "gluten/oversampling: `set_rate({raw})` selected {actual}x, but the host declaration \
             delivers {setting}x."
        );
    }
}

/// The resolved column is not a free list: it has to be the *fixed points* of
/// the engine's own resolution, or the host is offering a setting the engine
/// resolves away from.
#[test]
fn every_resolved_setting_is_one_the_engines_leave_alone() {
    for ResolvedValue { raw, setting } in resolved_for("crust", "oversampling") {
        assert_eq!(
            normalize_factor(setting as usize) as i64,
            setting,
            "crust/oversampling: the fixture resolves {raw} to {setting}, but the cascade does \
             not keep {setting} either, so it is not a setting at all"
        );
    }

    for ResolvedValue { raw, setting } in resolved_for("gluten", "oversampling") {
        let mut oversampler = ConfigurableOversample::new(1);
        oversampler.set_rate(setting as u8);
        assert_eq!(
            oversampler.rate as i64, setting,
            "gluten/oversampling: the fixture resolves {raw} to {setting}, but `set_rate` does \
             not keep {setting} either"
        );
    }
}
