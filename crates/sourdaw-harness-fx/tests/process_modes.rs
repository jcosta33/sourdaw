//! The host's process modes, observed through the real wrappers driving the
//! dylib `cargo test` just built — once as a `.clap` file and once as a
//! `.vst3` bundle — and asserted against exact samples.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use clap_sys::ext::render::CLAP_RENDER_OFFLINE;
use daw_plugin_host::clap_wrapper::ClapError;
use daw_plugin_host::vst3_wrapper::{decode_state as decode_vst3_container, format_class_id};
use daw_plugin_host::{
    AudioPlugin, ClapWrapper, HostParameterUpdate, HostedPluginRuntime, ProcessMode, Vst3Wrapper,
};
use sourdaw_harness_fx::state::{decode, RecordedState, MODE_NEVER_SET};
use sourdaw_harness_fx::{
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_PLUGIN_ID, ECHO_FRAMES, GAIN_DEFAULT, GAIN_PARAM_ID,
    LATENCY_FRAMES, VST3_CLASS_ID,
};
use vst3::Steinberg::int32;
use vst3::Steinberg::Vst::ProcessModes_;

const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_FRAMES: usize = 128;
/// Enough whole blocks to carry the impulse, its echo, and silence after both.
const BLOCKS: usize = (LATENCY_FRAMES + ECHO_FRAMES) / BLOCK_FRAMES + 2;
const VST3_REALTIME: int32 = ProcessModes_::kRealtime as int32;
const VST3_OFFLINE: int32 = ProcessModes_::kOffline as int32;

/// The cdylib this crate's build produced, found the way
/// `sourdaw-harness-tone`'s acceptance test finds its own: `deps/` first, the
/// profile directory as the fallback.
fn built_cdylib_path() -> PathBuf {
    let test_binary = env::current_exe().expect("the test binary path should resolve");
    let deps_dir = test_binary
        .parent()
        .expect("the test binary should live in a deps directory");
    let in_deps = deps_dir.join(cdylib_file_name());
    if in_deps.exists() {
        return in_deps;
    }
    deps_dir
        .parent()
        .expect("the deps directory should live in a profile directory")
        .join(cdylib_file_name())
}

fn cdylib_file_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "libsourdaw_harness_fx.dylib"
    } else if cfg!(target_os = "windows") {
        "sourdaw_harness_fx.dll"
    } else {
        "libsourdaw_harness_fx.so"
    }
}

/// A fresh temp directory holding the dylib as a `.clap` file and as a `.vst3`
/// bundle, torn down on drop.
struct InstalledPlugin {
    root: PathBuf,
    clap_path: PathBuf,
    vst3_bundle: PathBuf,
}

impl InstalledPlugin {
    fn create(test_name: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the system clock should be after the unix epoch")
            .as_nanos();
        let root = fs::canonicalize(env::temp_dir())
            .expect("the temp directory should resolve")
            .join(format!(
                "sourdaw-harness-fx-{test_name}-{}-{unique}",
                std::process::id()
            ));
        fs::create_dir_all(&root).expect("the temp root should be created");

        let source = built_cdylib_path();
        assert!(source.exists(), "the cdylib must be built: {source:?}");

        let clap_path = root.join("HarnessFx.clap");
        fs::copy(&source, &clap_path).expect("the cdylib should copy into the .clap path");

        let vst3_bundle = root.join("HarnessFx.vst3");
        install_vst3_module(&source, &vst3_bundle);

        Self {
            root,
            clap_path,
            vst3_bundle,
        }
    }

    fn clap(&self, plugin_id: &str, mode: ProcessMode) -> Result<ClapWrapper, ClapError> {
        let path = self.clap_path.to_str().expect("the path should be utf8");
        ClapWrapper::new_with_mode(path, plugin_id, SAMPLE_RATE, mode)
    }

    fn vst3(&self, mode: ProcessMode) -> Vst3Wrapper {
        Vst3Wrapper::new_with_mode(
            &self.vst3_bundle,
            &format_class_id(&VST3_CLASS_ID),
            SAMPLE_RATE,
            mode,
        )
        .expect("the VST3 class should load and activate")
    }
}

impl Drop for InstalledPlugin {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Place the module where `Vst3Instance::open` looks for it on this platform:
/// a CFBundle executable on macOS, `Contents/<machine>-linux/<name>.so` on
/// Linux, `Contents/<arch>-win/<name>.vst3` on Windows. The VST3 cases run on
/// all three, the platforms that loader supports.
fn install_vst3_module(source: &Path, bundle: &Path) {
    let module = vst3_module_path(bundle);
    fs::create_dir_all(module.parent().expect("the module path has a parent"))
        .expect("the bundle directories should be created");
    fs::copy(source, &module).expect("the cdylib should copy into the bundle");
    if cfg!(target_os = "macos") {
        fs::write(bundle.join("Contents").join("Info.plist"), INFO_PLIST)
            .expect("the bundle's Info.plist should be written");
    }
}

#[cfg(target_os = "macos")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::macos_executable_path(bundle).unwrap()
}

#[cfg(target_os = "windows")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::windows_module_paths(bundle, env::consts::ARCH)
        .unwrap()
        .remove(0)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::linux_module_path(bundle, env::consts::ARCH)
        .unwrap()
        .expect("the VST3 layout names this architecture")
}

/// The keys CoreFoundation needs to load the bundle's executable.
const INFO_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>HarnessFx</string>
    <key>CFBundleIdentifier</key>
    <string>com.sourdaw.harness-fx</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
</dict>
</plist>
"#;

/// Render a unit impulse at frame zero through `BLOCKS` blocks, with
/// `updates` delivered in the first block, and return both output channels.
fn render_impulse(
    plugin: &mut impl HostedPluginRuntime,
    updates: &[HostParameterUpdate],
) -> (Vec<f32>, Vec<f32>) {
    let mut left_out = Vec::new();
    let mut right_out = Vec::new();
    for block in 0..BLOCKS {
        let mut input = [0.0f32; BLOCK_FRAMES];
        if block == 0 {
            input[0] = 1.0;
        }
        let inputs: [&[f32]; 2] = [&input, &input];
        let (mut left, mut right) = ([0.0f32; BLOCK_FRAMES], [0.0f32; BLOCK_FRAMES]);
        {
            let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
            let block_updates = if block == 0 { updates } else { &[] };
            plugin.process_with_parameter_updates(
                &inputs,
                &mut outputs,
                BLOCK_FRAMES,
                block_updates,
            );
        }
        left_out.extend_from_slice(&left);
        right_out.extend_from_slice(&right);
    }
    (left_out, right_out)
}

/// `g` at frame `L`, `0.5 g` at frame `L + E`, and exact zero everywhere else.
fn assert_impulse_response(channel: &[f32], gain: f32) {
    for (frame, sample) in channel.iter().enumerate() {
        let expected = if frame == LATENCY_FRAMES {
            gain
        } else if frame == LATENCY_FRAMES + ECHO_FRAMES {
            0.5 * gain
        } else {
            0.0
        };
        assert_eq!(*sample, expected, "frame {frame}");
    }
}

fn clap_recorded_state(wrapper: &ClapWrapper) -> RecordedState {
    decode(&wrapper.get_state().unwrap()).expect("the chunk is the fixture's own")
}

fn vst3_recorded_state(wrapper: &Vst3Wrapper) -> RecordedState {
    let (component, _controller) = decode_vst3_container(&wrapper.get_state().unwrap()).unwrap();
    decode(&component).expect("the chunk is the fixture's own")
}

fn gain_update(value: f64) -> HostParameterUpdate {
    HostParameterUpdate {
        param_id: GAIN_PARAM_ID,
        value,
    }
}

// ── Offline ─────────────────────────────────────────────────────────────

#[test]
fn an_offline_clap_instance_renders_the_exact_impulse_response_and_reports_offline() {
    let plugin = InstalledPlugin::create("clap-offline");
    let mut wrapper = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Offline).unwrap();

    let (left, right) = render_impulse(&mut wrapper, &[]);

    assert_impulse_response(&left, GAIN_DEFAULT as f32);
    assert_eq!(left, right);
    assert_eq!(wrapper.latency_samples(), LATENCY_FRAMES as u32);
    assert_eq!(wrapper.tail_samples(), ECHO_FRAMES as u32);
    assert_eq!(
        clap_recorded_state(&wrapper).configured_mode,
        CLAP_RENDER_OFFLINE
    );
}

#[test]
fn an_offline_vst3_instance_renders_the_exact_impulse_response_and_reports_offline() {
    let plugin = InstalledPlugin::create("vst3-offline");
    let mut wrapper = plugin.vst3(ProcessMode::Offline);

    let (left, right) = render_impulse(&mut wrapper, &[]);

    assert_impulse_response(&left, GAIN_DEFAULT as f32);
    assert_eq!(left, right);
    assert_eq!(wrapper.latency_samples(), LATENCY_FRAMES as u32);
    assert_eq!(wrapper.tail_samples(), ECHO_FRAMES as u32);
    let recorded = vst3_recorded_state(&wrapper);
    assert_eq!(
        (recorded.configured_mode, recorded.last_block_mode),
        (VST3_OFFLINE, VST3_OFFLINE),
        "setupProcessing and every ProcessData must both state offline"
    );
}

// ── Realtime stays the default ──────────────────────────────────────────

#[test]
fn the_realtime_clap_constructor_never_moves_the_plugin_off_its_realtime_default() {
    let plugin = InstalledPlugin::create("clap-realtime");
    let path = plugin.clap_path.to_str().unwrap();
    let mut wrapper = ClapWrapper::new(path, CLAP_PLUGIN_ID, SAMPLE_RATE).unwrap();

    render_impulse(&mut wrapper, &[]);

    assert_eq!(
        clap_recorded_state(&wrapper).configured_mode,
        MODE_NEVER_SET,
        "a realtime instance is left on CLAP's realtime default, never told a mode"
    );
}

#[test]
fn the_realtime_vst3_constructor_states_realtime_to_setup_and_every_block() {
    let plugin = InstalledPlugin::create("vst3-realtime");
    let mut wrapper = Vst3Wrapper::new(
        &plugin.vst3_bundle,
        &format_class_id(&VST3_CLASS_ID),
        SAMPLE_RATE,
    )
    .unwrap();

    render_impulse(&mut wrapper, &[]);

    let recorded = vst3_recorded_state(&wrapper);
    assert_eq!(
        (recorded.configured_mode, recorded.last_block_mode),
        (VST3_REALTIME, VST3_REALTIME)
    );
}

// ── State round trip into an offline instance ───────────────────────────

#[test]
fn a_clap_gain_saved_from_one_instance_drives_a_fresh_offline_instance() {
    let plugin = InstalledPlugin::create("clap-state");
    let mut source = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Realtime).unwrap();
    render_impulse(&mut source, &[gain_update(0.25)]);
    let saved = source.get_state().unwrap();

    let mut target = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Offline).unwrap();
    target.set_state(&saved).unwrap();
    let (left, _) = render_impulse(&mut target, &[]);

    assert_impulse_response(&left, 0.25);
}

#[test]
fn a_vst3_gain_saved_from_one_instance_drives_a_fresh_offline_instance() {
    let plugin = InstalledPlugin::create("vst3-state");
    let mut source = plugin.vst3(ProcessMode::Realtime);
    render_impulse(&mut source, &[gain_update(0.25)]);
    let saved = source.get_state().unwrap();

    let mut target = plugin.vst3(ProcessMode::Offline);
    target.set_state(&saved).unwrap();
    let (left, _) = render_impulse(&mut target, &[]);

    assert_impulse_response(&left, 0.25);
}

// ── A plugin that cannot render offline ─────────────────────────────────

#[test]
fn a_clap_plugin_with_a_hard_realtime_requirement_is_refused_offline_by_name() {
    let plugin = InstalledPlugin::create("clap-hard-realtime");

    let error = plugin
        .clap(CLAP_HARD_REALTIME_PLUGIN_ID, ProcessMode::Offline)
        .err()
        .expect("an offline instance of a hard-realtime plugin must be refused");

    assert!(
        matches!(&error, ClapError::RequiresRealtime { name } if name == "Sourdaw Harness Fx Hard Realtime"),
        "{error}"
    );
    assert_eq!(
        error.to_string(),
        "[CLAP] 'Sourdaw Harness Fx Hard Realtime' requires real-time rendering and cannot \
         render offline"
    );
    assert!(plugin
        .clap(CLAP_HARD_REALTIME_PLUGIN_ID, ProcessMode::Realtime)
        .is_ok());
}
