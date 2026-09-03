//! Proves the harness tone through the real scanner and CLAP host, not
//! against its own source: locates the cdylib `cargo test` just built,
//! copies it into a fresh `.clap` bundle file, and drives it exactly the way
//! the packaged-app latency harness (#3070) will.

use std::env;
use std::fs;
use std::path::PathBuf;

use daw_plugin_host::scanner::{category_from_clap_features, extract_clap_metadata};
use daw_plugin_host::{AudioPlugin, ClapWrapper, HostParameterUpdate};

const PLUGIN_ID: &str = "com.sourdaw.harness-tone";
const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_FRAMES: usize = 256;
const TONE_FREQUENCY_HZ: f64 = 440.0;
const DEFAULT_LEVEL: f32 = 0.25;

/// The cdylib this crate's own build just produced, found relative to the
/// test binary: `target/<profile>/deps/<test>` -> its `deps` directory ->
/// the platform's cdylib file name.
///
/// A dependency artifact built only to satisfy the integration test's own
/// implicit link (never as a `cargo build` top-level target) is left in
/// `deps/` and not uplifted to the profile directory above it, so `deps/` is
/// checked first; the profile directory is still checked as a fallback for
/// whichever invocation did uplift it (e.g. a prior plain `cargo build`).
fn built_cdylib_path() -> PathBuf {
    let test_binary = env::current_exe().expect("the test binary path should resolve");
    let deps_dir = test_binary
        .parent()
        .expect("the test binary should live in a deps directory");
    let profile_dir = deps_dir
        .parent()
        .expect("the deps directory should live in a profile directory");

    let in_deps = deps_dir.join(cdylib_file_name());
    if in_deps.exists() {
        return in_deps;
    }
    profile_dir.join(cdylib_file_name())
}

fn cdylib_file_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libsourdaw_harness_tone.dylib"
    } else if cfg!(target_os = "windows") {
        "sourdaw_harness_tone.dll"
    } else {
        "libsourdaw_harness_tone.so"
    }
}

/// A fresh, canonical temp directory holding the built cdylib copied to
/// `Sourdaw Harness Tone.clap`, torn down on drop.
///
/// Canonicalized because `daw-plugin-host`'s scan policy refuses a symlinked
/// temp root on macOS (`/tmp` -> `/private/tmp`), and joining a fully unique
/// suffix onto the canonical root keeps every test's bundle write-disjoint.
struct InstalledPlugin {
    bundle_path: PathBuf,
    root: PathBuf,
}

impl InstalledPlugin {
    fn create(test_name: &str) -> Self {
        let root = fs::canonicalize(env::temp_dir())
            .expect("the temp directory should resolve")
            .join(unique_root_name(test_name));
        fs::create_dir_all(&root).expect("the temp scan root should be created");

        let source = built_cdylib_path();
        assert!(
            source.exists(),
            "the harness-tone cdylib must be built before this test runs: {source:?}"
        );
        let bundle_path = root.join("Sourdaw Harness Tone.clap");
        fs::copy(&source, &bundle_path).expect("the cdylib should copy into the bundle path");

        Self { bundle_path, root }
    }
}

impl Drop for InstalledPlugin {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn unique_root_name(test_name: &str) -> String {
    let unique_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("the system clock should be after the unix epoch")
        .as_nanos();
    format!(
        "sourdaw-harness-tone-{test_name}-{}-{unique_suffix}",
        std::process::id()
    )
}

fn silent_stereo_block() -> ([f32; BLOCK_FRAMES], [f32; BLOCK_FRAMES]) {
    ([0.0; BLOCK_FRAMES], [0.0; BLOCK_FRAMES])
}

fn peak_abs(channel: &[f32]) -> f32 {
    channel
        .iter()
        .fold(0.0f32, |max, &sample| max.max(sample.abs()))
}

#[test]
fn the_scanner_lists_one_effect_descriptor() {
    let plugin = InstalledPlugin::create("scanner-lists-one-effect");

    let rows = extract_clap_metadata(&plugin.bundle_path).expect("metadata should extract");
    assert_eq!(rows.len(), 1, "the bundle declares exactly one plugin");

    let row = &rows[0];
    assert_eq!(row.id, PLUGIN_ID);
    assert_eq!(category_from_clap_features(&row.features), "effect");
}

#[test]
fn the_tone_is_a_phase_continuous_stereo_sine() {
    let plugin = InstalledPlugin::create("phase-continuous-sine");
    let path = plugin
        .bundle_path
        .to_str()
        .expect("the path should be utf8");
    let mut wrapper = ClapWrapper::new(path, PLUGIN_ID, SAMPLE_RATE)
        .expect("the plugin should load and activate");

    let (silent_left, silent_right) = silent_stereo_block();
    let inputs: [&[f32]; 2] = [&silent_left, &silent_right];

    let (mut left_one, mut right_one) = silent_stereo_block();
    {
        let mut outputs: [&mut [f32]; 2] = [&mut left_one, &mut right_one];
        wrapper.process(&inputs, &mut outputs, BLOCK_FRAMES);
    }

    let (mut left_two, mut right_two) = silent_stereo_block();
    {
        let mut outputs: [&mut [f32]; 2] = [&mut left_two, &mut right_two];
        wrapper.process(&inputs, &mut outputs, BLOCK_FRAMES);
    }

    let peak_left = peak_abs(&left_one);
    let peak_right = peak_abs(&right_one);
    assert!(
        (peak_left - DEFAULT_LEVEL).abs() < 1e-3,
        "left peak was {peak_left}, expected {DEFAULT_LEVEL}"
    );
    assert!(
        (peak_right - DEFAULT_LEVEL).abs() < 1e-3,
        "right peak was {peak_right}, expected {DEFAULT_LEVEL}"
    );

    assert_eq!(
        left_one, right_one,
        "block one: left must equal right sample-for-sample"
    );
    assert_eq!(
        left_two, right_two,
        "block two: left must equal right sample-for-sample"
    );

    let expected_first_sample_of_block_two = (f64::from(DEFAULT_LEVEL)
        * (std::f64::consts::TAU * TONE_FREQUENCY_HZ * BLOCK_FRAMES as f64 / SAMPLE_RATE).sin())
        as f32;
    assert!(
        (left_two[0] - expected_first_sample_of_block_two).abs() < 1e-4,
        "block two's first sample was {}, expected {} (phase continuity)",
        left_two[0],
        expected_first_sample_of_block_two
    );
}

#[test]
fn level_scales_the_tone() {
    let plugin = InstalledPlugin::create("level-scales-the-tone");
    let path = plugin
        .bundle_path
        .to_str()
        .expect("the path should be utf8");
    let mut wrapper = ClapWrapper::new(path, PLUGIN_ID, SAMPLE_RATE)
        .expect("the plugin should load and activate");

    let (silent_left, silent_right) = silent_stereo_block();
    let inputs: [&[f32]; 2] = [&silent_left, &silent_right];

    // One block at the default level, so the parameter update below is a
    // real change rather than a no-op against a plugin still on its default.
    let (mut warm_left, mut warm_right) = silent_stereo_block();
    {
        let mut outputs: [&mut [f32]; 2] = [&mut warm_left, &mut warm_right];
        wrapper.process(&inputs, &mut outputs, BLOCK_FRAMES);
    }
    assert!((peak_abs(&warm_left) - DEFAULT_LEVEL).abs() < 1e-3);

    let updates = [HostParameterUpdate {
        param_id: 0,
        value: 0.5,
    }];
    let (mut left, mut right) = silent_stereo_block();
    {
        let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
        wrapper.process_with_parameter_updates(&inputs, &mut outputs, BLOCK_FRAMES, &updates);
    }

    let peak = peak_abs(&left);
    assert!((peak - 0.5).abs() < 1e-3, "peak was {peak}, expected 0.5");
}
