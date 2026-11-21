//! The offline render's own plugin instances, end to end: the real
//! `render_graph_offline` body over an `AppState` whose engine holds a live
//! instance of `sourdaw-harness-fx`, loaded from the dylib `cargo test` built —
//! once as a `.clap` file and once as a `.vst3` bundle — and asserted against
//! exact samples.
//!
//! The cases live here rather than in the fixture crate's own `tests/`: an
//! offline instance is vetted against a scan policy, and a policy over a test's
//! own folder is test-gated to this crate (`PluginScanPolicy::with_allowed_roots`)
//! so that production has exactly one way to obtain one. The live instance is
//! recorded straight into `engine_plugins` the way a load records it; no audio
//! device is involved anywhere.

use super::*;
use crate::block_on_test;
use crate::commands::graph::render_graph_offline_with;
use crate::commands::plugins::{
    create_hosted_runtime, read_plugin_state_chunk, VettedRegistryEntry,
};
use crate::host::plugin_folder_grants::grant_at;
use crate::host::plugin_folder_grants::test_support::TempTree;
use crate::host::plugin_registry_store::plugin_file_fingerprint;
use crate::host::ui_thread::UiThreadTask;
use crate::state::{EnginePluginInstanceData, PluginRegistryEntry, TimelineSample};
use daw_engine::timeline::DeviceKind;
use daw_plugin_host::vst3_wrapper::{decode_state as decode_vst3_container, format_class_id};
use daw_plugin_host::{ClapWrapper, HostParameterUpdate, ProcessingGate, Vst3Wrapper};
use serde_json::{json, Value};
use sourdaw_harness_fx::state::{decode, RecordedState, MODE_NEVER_SET};
use sourdaw_harness_fx::{
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_PLUGIN_ID, CLAP_PROCESS_ERROR_PLUGIN_ID,
    CLAP_START_REFUSED_PLUGIN_ID, ECHO_FRAMES, FAILING_PROCESS_CALL, GAIN_PARAM_ID, LATENCY_FRAMES,
    VST3_CLASS_ID, VST3_PROCESS_ERROR_CLASS_ID, VST3_START_REFUSED_CLASS_ID,
};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread::{self, ThreadId};

const LIVE_RATE: f64 = 48_000.0;
const EXPORT_RATE: f64 = 44_100.0;
const CLAP_RENDER_OFFLINE: i32 = 1;
const VST3_REALTIME: i32 = 0;
const VST3_OFFLINE: i32 = 2;
/// Late enough that nothing ahead of it in the graph is still settling.
const IMPULSE_FRAME: usize = 16_384;
const DRY_IMPULSE_FRAME: usize = 12_000;
const FRAMES: usize = IMPULSE_FRAME + LATENCY_FRAMES + ECHO_FRAMES + 2_048;
const LIVE_GAIN: f64 = 0.25;
/// A minute at the export rate: long enough that a cancel lands mid-render.
const LONG_RENDER_FRAMES: u32 = 44_100 * 60;
const INSTANCE: &str = "fx-live";
const ENGINE_PLUGIN_ID: usize = 1_042;

#[derive(Clone, Copy, Debug)]
enum Format {
    Clap,
    Vst3,
}

// ── The fixture plugin on disk ──────────────────────────────────────────

/// The cdylib this test binary's build produced as a dev-dependency, found
/// the way `sourdaw-harness-fx`'s own tests find it.
fn built_cdylib_path() -> PathBuf {
    let test_binary = std::env::current_exe().expect("the test binary path should resolve");
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

/// A fresh temp directory holding the dylib as a `.clap` file and a `.vst3`
/// bundle, torn down on drop.
struct InstalledFx {
    root: PathBuf,
    clap_path: PathBuf,
    vst3_bundle: PathBuf,
}

impl InstalledFx {
    fn create(test_name: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the clock is after the epoch")
            .as_nanos();
        let root = std::fs::canonicalize(std::env::temp_dir())
            .expect("the temp directory resolves")
            .join(format!(
                "sourdaw-offline-fx-{test_name}-{}-{unique}",
                std::process::id()
            ));
        std::fs::create_dir_all(&root).expect("the temp root is created");
        let source = built_cdylib_path();
        assert!(
            source.exists(),
            "the fixture cdylib must be built: {source:?}"
        );
        let clap_path = root.join("HarnessFx.clap");
        std::fs::copy(&source, &clap_path).expect("the cdylib copies into the .clap path");
        let vst3_bundle = root.join("HarnessFx.vst3");
        install_vst3_module(&source, &vst3_bundle);
        Self {
            root,
            clap_path,
            vst3_bundle,
        }
    }

    fn path(&self, format: Format) -> &Path {
        match format {
            Format::Clap => &self.clap_path,
            Format::Vst3 => &self.vst3_bundle,
        }
    }

    /// What a load records about the file it opened.
    fn load_resolution(&self, format: Format, descriptor_id: &str) -> VettedRegistryEntry {
        let path = self.path(format);
        let format_name = match format {
            Format::Clap => "clap",
            Format::Vst3 => "vst3",
        };
        VettedRegistryEntry {
            entry: PluginRegistryEntry {
                path: path.to_str().expect("utf8 path").to_string(),
                stable_id: format!("harness-fx-{format_name}"),
                descriptor_id: descriptor_id.to_string(),
                format: format_name.to_string(),
                name: "Sourdaw Harness Fx".to_string(),
                num_inputs: 2,
                num_outputs: 2,
                has_custom_ui: false,
                capability_metadata_reason: None,
                chain_kind: DeviceKind::Effect,
                scanned_fingerprint: None,
            },
            fingerprint: plugin_file_fingerprint(path, format_name)
                .expect("the installed plugin fingerprints"),
        }
    }

    fn seams(&self) -> OfflinePluginSeams {
        OfflinePluginSeams {
            scan_policy: PluginScanPolicy::with_allowed_roots(vec![self.root.clone()]),
            capture_state: read_live_state,
            construct: create_hosted_runtime,
            after_build: None,
            after_mapping: None,
            before_restore: None,
        }
    }
}

impl Drop for InstalledFx {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn install_vst3_module(source: &Path, bundle: &Path) {
    let module = vst3_module_path(bundle);
    std::fs::create_dir_all(module.parent().expect("the module path has a parent"))
        .expect("the bundle directories are created");
    std::fs::copy(source, &module).expect("the cdylib copies into the bundle");
    if cfg!(target_os = "macos") {
        std::fs::write(bundle.join("Contents").join("Info.plist"), INFO_PLIST)
            .expect("the bundle's Info.plist is written");
    }
}

#[cfg(target_os = "macos")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::macos_executable_path(bundle).expect("a macOS bundle layout")
}

#[cfg(target_os = "windows")]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::windows_module_paths(bundle, std::env::consts::ARCH)
        .expect("a Windows bundle layout")
        .remove(0)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn vst3_module_path(bundle: &Path) -> PathBuf {
    daw_plugin_host::vst3_module::linux_module_path(bundle, std::env::consts::ARCH)
        .expect("a Linux bundle layout")
        .expect("the VST3 layout names this architecture")
}

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

// ── A UI thread that counts what it is asked to run ─────────────────────

/// A UI thread of its own, as a shell's main loop is, counting every task it
/// runs: an offline instance's construction and its release are one each.
struct RecordingUiThread {
    work: mpsc::Sender<Arc<UiThreadTask>>,
    thread_id: ThreadId,
    tasks_run: Arc<AtomicUsize>,
    thread: Option<thread::JoinHandle<()>>,
}

impl RecordingUiThread {
    fn start() -> Self {
        let (work, queued) = mpsc::channel::<Arc<UiThreadTask>>();
        let (announce, announced) = mpsc::channel();
        let tasks_run = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&tasks_run);
        let thread = thread::spawn(move || {
            announce
                .send(thread::current().id())
                .expect("the UI thread announces itself");
            while let Ok(task) = queued.recv() {
                task.run();
                counted.fetch_add(1, Ordering::SeqCst);
            }
        });
        let thread_id = announced.recv().expect("the UI thread starts");
        Self {
            work,
            thread_id,
            tasks_run,
            thread: Some(thread),
        }
    }

    fn tasks_run(&self) -> usize {
        self.tasks_run.load(Ordering::SeqCst)
    }
}

impl Drop for RecordingUiThread {
    fn drop(&mut self) {
        let (closed, _) = mpsc::channel();
        drop(std::mem::replace(&mut self.work, closed));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl UiThread for RecordingUiThread {
    fn is_ui_thread(&self) -> bool {
        thread::current().id() == self.thread_id
    }

    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), String> {
        let (done, waited) = mpsc::sync_channel(1);
        let queued = Arc::clone(task);
        self.work
            .send(UiThreadTask::new(move || {
                queued.run();
                let _ = done.send(());
            }))
            .map_err(|_| "the UI thread is gone".to_string())?;
        waited
            .recv()
            .map_err(|_| "the UI thread never answered".to_string())
    }
}

// ── The live instance ───────────────────────────────────────────────────

/// A live, realtime instance at the live rate, whose Gain the user moved to
/// `LIVE_GAIN` after the load — delivered through its process path, the way
/// a knob reaches a running plugin.
fn live_runtime(fx: &InstalledFx, format: Format, descriptor_id: &str) -> HostedRuntime {
    let mut runtime: HostedRuntime = match format {
        Format::Clap => ClapWrapper::new(
            fx.clap_path.to_str().expect("utf8"),
            descriptor_id,
            LIVE_RATE,
        )
        .expect("the live CLAP instance loads")
        .into(),
        Format::Vst3 => Vst3Wrapper::new(&fx.vst3_bundle, descriptor_id, LIVE_RATE)
            .expect("the live VST3 instance loads")
            .into(),
    };
    let silence = [0.0f32; 64];
    let (mut left, mut right) = ([0.0f32; 64], [0.0f32; 64]);
    let inputs: [&[f32]; 2] = [&silence, &silence];
    let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
    HostedPluginRuntime::process_with_parameter_updates(
        &mut runtime,
        &inputs,
        &mut outputs,
        64,
        &[HostParameterUpdate {
            param_id: GAIN_PARAM_ID,
            value: LIVE_GAIN,
        }],
    );
    runtime
}

/// Record `runtime` as an engine-attached instance, the way a load does.
fn attach(
    state: &AppState,
    runtime: HostedRuntime,
    load_resolution: VettedRegistryEntry,
    chain_kind: DeviceKind,
) -> Arc<SharedHostedPlugin> {
    let shared = Arc::new(SharedHostedPlugin::new(runtime));
    record_engine_instance(
        state,
        Arc::clone(&shared),
        load_resolution,
        chain_kind,
        ENGINE_PLUGIN_ID,
    );
    shared
}

/// Record `shared` under the instance id, replacing any record already there.
fn record_engine_instance(
    state: &AppState,
    shared: Arc<SharedHostedPlugin>,
    load_resolution: VettedRegistryEntry,
    chain_kind: DeviceKind,
    engine_plugin_id: usize,
) {
    state.engine_plugins.lock().expect("engine plugins").insert(
        INSTANCE.to_string(),
        EnginePluginInstanceData {
            engine_plugin_id,
            runtime: shared,
            name: "Sourdaw Harness Fx".to_string(),
            parameters: Vec::new(),
            has_gui: false,
            chain_kind,
            parameter_events: None,
            load_resolution,
        },
    );
}

/// The descriptor id of the class that processes every block.
fn processing_class(format: Format) -> String {
    match format {
        Format::Clap => CLAP_PLUGIN_ID.to_string(),
        Format::Vst3 => format_class_id(&VST3_CLASS_ID),
    }
}

/// The descriptor id of the class that fails one process call.
fn failing_class(format: Format) -> String {
    match format {
        Format::Clap => CLAP_PROCESS_ERROR_PLUGIN_ID.to_string(),
        Format::Vst3 => format_class_id(&VST3_PROCESS_ERROR_CLASS_ID),
    }
}

/// The descriptor id of the class that refuses to start processing.
fn start_refusing_class(format: Format) -> String {
    match format {
        Format::Clap => CLAP_START_REFUSED_PLUGIN_ID.to_string(),
        Format::Vst3 => format_class_id(&VST3_START_REFUSED_CLASS_ID),
    }
}

fn state_with_live_fx(fx: &InstalledFx, format: Format) -> (AppState, Arc<SharedHostedPlugin>) {
    state_with_live_class(fx, format, &processing_class(format))
}

fn state_with_live_class(
    fx: &InstalledFx,
    format: Format,
    descriptor: &str,
) -> (AppState, Arc<SharedHostedPlugin>) {
    let state = AppState::default();
    let live = attach(
        &state,
        live_runtime(fx, format, descriptor),
        fx.load_resolution(format, descriptor),
        DeviceKind::Effect,
    );
    register_material(&state);
    (state, live)
}

fn recorded(chunk: &[u8], format: Format) -> RecordedState {
    let component = match format {
        Format::Clap => chunk.to_vec(),
        Format::Vst3 => decode_vst3_container(chunk).expect("a VST3 container").0,
    };
    decode(&component).expect("the chunk is the fixture's own")
}

// ── Batches ─────────────────────────────────────────────────────────────

/// Material at the export rate, so a clip plays it sample for sample.
fn register_material(state: &AppState) {
    let mut impulse = vec![0.0f32; 4];
    impulse[0] = 1.0;
    let mut samples = state.timeline_samples.lock().expect("samples");
    samples.insert(
        "impulse".to_string(),
        TimelineSample {
            left: impulse.clone().into(),
            right: impulse.into(),
            sample_rate: EXPORT_RATE as f32,
        },
    );
    samples.insert(
        "dc".to_string(),
        TimelineSample {
            left: vec![0.5f32; FRAMES].into(),
            right: vec![0.5f32; FRAMES].into(),
            sample_rate: EXPORT_RATE as f32,
        },
    );
}

fn fx_device() -> Value {
    json!({ "id": "d-fx", "name": "Harness Fx", "type": "plugin", "bypassed": false,
            "parameterValues": {}, "externalPluginId": "com.sourdaw.harness-fx",
            "externalInstanceId": INSTANCE })
}

fn strip(track_id: &str, devices: Value) -> Value {
    json!({ "kind": "create-track-strip", "trackId": track_id, "name": track_id,
            "state": { "gain": 1, "pan": 0, "muted": false, "soloGated": false, "vcaMultiplier": 1 },
            "devices": devices, "honorMuted": true, "contributesAudio": true })
}

fn clip(track_id: &str, source: &str, start_frame: usize, frames: usize) -> Value {
    json!({ "kind": "schedule-clip", "playback": {
        "trackId": track_id, "source": { "sourceId": source },
        "startTime": start_frame as f64 / EXPORT_RATE, "sourceOffsetSeconds": 0,
        "durationSeconds": frames as f64 / EXPORT_RATE, "playbackRate": 1, "gain": 1,
        "fade": { "microFadeSeconds": 0 } } })
}

fn batch(commands: Vec<Value>) -> Value {
    json!({ "schemaVersion": 1, "commands": commands })
}

fn impulse_track(devices: Value) -> Vec<Value> {
    vec![
        strip("t1", devices),
        clip("t1", "impulse", IMPULSE_FRAME, 4),
    ]
}

fn render(
    batch: Value,
    state: &AppState,
    ui: &dyn UiThread,
    seams: &OfflinePluginSeams,
    render_id: Option<&str>,
) -> Result<Vec<f32>, String> {
    block_on_test(render_graph_offline_with(
        batch,
        FRAMES as u32,
        EXPORT_RATE,
        render_id.map(str::to_string),
        ui,
        state,
        seams,
    ))
    .map(|bytes| {
        let (frames, _) = bytes.as_chunks::<8>();
        frames
            .iter()
            .map(|frame| f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]))
            .collect()
    })
}

/// `g * (D[n - L] + 0.5 * D[n - L - E])`, with `g` read per frame.
fn through_the_effect(dry: &[f32], gain_at: impl Fn(usize) -> f32) -> Vec<f32> {
    (0..dry.len())
        .map(|frame| {
            let tap = |delay: usize| frame.checked_sub(delay).map_or(0.0, |at| dry[at]);
            gain_at(frame) * (tap(LATENCY_FRAMES) + 0.5 * tap(LATENCY_FRAMES + ECHO_FRAMES))
        })
        .collect()
}

fn assert_frames_equal(actual: &[f32], expected: &[f32]) {
    assert_eq!(actual.len(), expected.len());
    for (frame, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(actual, expected, "frame {frame}");
    }
}

thread_local! {
    /// What each offline instance's state read and activation rate said just
    /// before its render.
    static OFFLINE_STATE: RefCell<Vec<(Vec<u8>, f64)>> = const { RefCell::new(Vec::new()) };
}

/// What a test watches on every offline instance its render builds.
#[derive(Clone, Default)]
struct OfflineInstanceWatch {
    gates: Arc<Mutex<Vec<Arc<ProcessingGate>>>>,
    teardown_threads: Arc<Mutex<Vec<ThreadId>>>,
}

impl OfflineInstanceWatch {
    /// The `after_build` seam that watches every built instance, then runs
    /// `then` over them.
    fn after_build(&self, then: Option<fn(&[Arc<SharedHostedPlugin>])>) -> AfterBuild {
        let gates = Arc::clone(&self.gates);
        let teardown_threads = Arc::clone(&self.teardown_threads);
        Box::new(move |runtimes: &[Arc<SharedHostedPlugin>]| {
            gates
                .lock()
                .expect("gates")
                .extend(runtimes.iter().map(|runtime| runtime.processing_gate()));
            for runtime in runtimes {
                runtime.witness_teardown(Arc::clone(&teardown_threads));
            }
            if let Some(then) = then {
                then(runtimes);
            }
        })
    }

    /// Every watched instance left its processing state on the render thread,
    /// after its last block — not forced out of it by its own teardown.
    fn assert_every_instance_left_processing(&self) {
        let gates = self.gates.lock().expect("gates");
        assert!(!gates.is_empty(), "the render built an offline instance");
        for gate in gates.iter() {
            assert!(
                gate.has_stopped(),
                "the offline instance stopped processing"
            );
            assert_eq!(
                gate.off_audio_thread_stops(),
                0,
                "the render thread left processing; teardown did not have to force it"
            );
        }
    }

    /// Every watched instance was torn down, and on the UI thread.
    fn assert_every_instance_torn_down_on(&self, ui: &RecordingUiThread) {
        let built = self.gates.lock().expect("gates").len();
        let teardown_threads = self.teardown_threads.lock().expect("teardown threads");
        assert_eq!(
            *teardown_threads,
            vec![ui.thread_id; built],
            "every offline instance is torn down, on the UI thread"
        );
    }
}

fn record_offline_state(runtimes: &[Arc<SharedHostedPlugin>]) {
    for runtime in runtimes {
        let chunk = runtime
            .get_state_after_pending_parameters_drain(Duration::from_secs(2))
            .expect("the offline instance gives its state");
        let rate = runtime
            .with_control(Duration::from_secs(2), |plugin| {
                Ok(plugin.activation_sample_rate())
            })
            .expect("the offline instance answers");
        OFFLINE_STATE.with(|states| states.borrow_mut().push((chunk, rate)));
    }
}

// ── (a) The print contains the plugin ───────────────────────────────────

fn the_print_is_the_dry_render_through_the_live_instances_settings(format: Format) {
    let fx = InstalledFx::create(&format!("print-{format:?}"));
    let (state, live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    let watch = OfflineInstanceWatch::default();
    seams.after_build = Some(watch.after_build(Some(record_offline_state)));
    OFFLINE_STATE.with(|states| states.borrow_mut().clear());

    let dry = render(batch(impulse_track(json!([]))), &state, &ui, &seams, None)
        .expect("the dry render renders");
    let print = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect("the attached effect renders offline");

    assert!(
        dry[IMPULSE_FRAME] != 0.0,
        "the dry render carries the impulse"
    );
    assert_frames_equal(&print, &through_the_effect(&dry, |_| LIVE_GAIN as f32));

    let offline_states = OFFLINE_STATE.with(|states| states.borrow().clone());
    assert_eq!(offline_states.len(), 1, "one offline instance was built");
    let expected_offline = match format {
        Format::Clap => CLAP_RENDER_OFFLINE,
        Format::Vst3 => VST3_OFFLINE,
    };
    let (offline_chunk, offline_rate) = &offline_states[0];
    let offline_recorded = recorded(offline_chunk, format);
    assert_eq!(offline_recorded.configured_mode, expected_offline);
    assert_eq!(
        offline_recorded.gain, LIVE_GAIN,
        "the live state was restored"
    );
    assert_eq!(
        *offline_rate, EXPORT_RATE,
        "the offline instance runs at the export rate"
    );

    let live_state = read_plugin_state_chunk(INSTANCE, &state).expect("the live state reads");
    let live_recorded = recorded(&live_state, format);
    let expected_live = match format {
        Format::Clap => MODE_NEVER_SET,
        Format::Vst3 => VST3_REALTIME,
    };
    assert_eq!(
        live_recorded.configured_mode, expected_live,
        "the live instance is still realtime"
    );
    assert_eq!(live_recorded.gain, LIVE_GAIN);
    let live_rate = live
        .with_control(Duration::from_secs(2), |plugin| {
            Ok(plugin.activation_sample_rate())
        })
        .expect("the live instance answers");
    assert_eq!(live_rate, LIVE_RATE, "the live instance was never re-rated");
    watch.assert_every_instance_left_processing();
    watch.assert_every_instance_torn_down_on(&ui);
    assert_eq!(
        ui.tasks_run(),
        2,
        "one construction and one release, both on the UI thread"
    );
    assert!(state
        .retired_engine_plugins
        .lock()
        .expect("retired")
        .is_empty());
}

#[test]
fn a_clap_print_is_the_dry_render_through_the_live_instances_settings() {
    the_print_is_the_dry_render_through_the_live_instances_settings(Format::Clap);
}

#[test]
fn a_vst3_print_is_the_dry_render_through_the_live_instances_settings() {
    the_print_is_the_dry_render_through_the_live_instances_settings(Format::Vst3);
}

// ── (b) Plugin delay compensation ───────────────────────────────────────

fn a_dry_track_lands_aligned_with_the_offline_instances_latency_in(format: Format) {
    let fx = InstalledFx::create(&format!("pdc-{format:?}"));
    let (state, _live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let dry_track = vec![
        strip("t2", json!([])),
        clip("t2", "impulse", DRY_IMPULSE_FRAME, 4),
    ];

    let dry_alone =
        render(batch(dry_track.clone()), &state, &ui, &seams, None).expect("the dry track renders");
    let plugin_track_dry =
        render(batch(impulse_track(json!([]))), &state, &ui, &seams, None).expect("renders");
    let mut both = impulse_track(json!([fx_device()]));
    both.extend(dry_track);
    let print = render(batch(both), &state, &ui, &seams, None).expect("both tracks render");

    let through = through_the_effect(&plugin_track_dry, |_| LIVE_GAIN as f32);
    let expected: Vec<f32> = (0..FRAMES)
        .map(|frame| {
            let held = frame
                .checked_sub(LATENCY_FRAMES)
                .map_or(0.0, |at| dry_alone[at]);
            through[frame] + held
        })
        .collect();
    assert!(dry_alone[DRY_IMPULSE_FRAME] != 0.0);
    assert_eq!(
        print[DRY_IMPULSE_FRAME], 0.0,
        "the dry track no longer leads"
    );
    assert_eq!(
        print[DRY_IMPULSE_FRAME + LATENCY_FRAMES],
        dry_alone[DRY_IMPULSE_FRAME],
        "the dry impulse lands the plugin's latency late"
    );
    assert_frames_equal(&print, &expected);
}

#[test]
fn a_dry_track_lands_aligned_with_an_offline_clap_instances_latency() {
    a_dry_track_lands_aligned_with_the_offline_instances_latency_in(Format::Clap);
}

#[test]
fn a_dry_track_lands_aligned_with_an_offline_vst3_instances_latency() {
    a_dry_track_lands_aligned_with_the_offline_instances_latency_in(Format::Vst3);
}

// ── (c) Automation reaches the offline instance ─────────────────────────

fn a_hosted_parameter_write_mid_render_moves_the_offline_instance_in(format: Format) {
    const WRITE_FRAME: usize = 8_192;
    let fx = InstalledFx::create(&format!("automation-{format:?}"));
    let (state, _live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let dc_track = |devices: Value| vec![strip("t1", devices), clip("t1", "dc", 0, FRAMES)];
    let write = json!({ "kind": "write-device-parameter",
        "target": { "kind": "device-parameter", "trackId": "t1", "deviceId": "d-fx",
                    "parameterId": GAIN_PARAM_ID.to_string() },
        "write": { "shape": "step", "value": 1.0, "time": WRITE_FRAME as f64 / EXPORT_RATE } });

    let dry = render(batch(dc_track(json!([]))), &state, &ui, &seams, None).expect("renders");
    let mut automated = dc_track(json!([fx_device()]));
    automated.push(write);
    let print = render(batch(automated), &state, &ui, &seams, None).expect("renders");

    // The write lands at the head of the block holding its frame — block
    // granular today (#6560) — and the offline block grid puts that block's
    // head on the write frame itself.
    assert_eq!(WRITE_FRAME % daw_engine::offline::OFFLINE_BLOCK_FRAMES, 0);
    let expected = through_the_effect(&dry, |frame| {
        if frame < WRITE_FRAME {
            LIVE_GAIN as f32
        } else {
            1.0
        }
    });
    assert_frames_equal(&print, &expected);
}

#[test]
fn a_hosted_parameter_write_mid_render_moves_an_offline_clap_instance_from_its_landing_block() {
    a_hosted_parameter_write_mid_render_moves_the_offline_instance_in(Format::Clap);
}

#[test]
fn a_hosted_parameter_write_mid_render_moves_an_offline_vst3_instance_from_its_landing_block() {
    a_hosted_parameter_write_mid_render_moves_the_offline_instance_in(Format::Vst3);
}

// ── (d) Refusals by name, with no output ────────────────────────────────

#[test]
fn a_clap_class_that_requires_real_time_refuses_the_render_by_name() {
    let fx = InstalledFx::create("hard-realtime");
    let state = AppState::default();
    attach(
        &state,
        live_runtime(&fx, Format::Clap, CLAP_HARD_REALTIME_PLUGIN_ID),
        fx.load_resolution(Format::Clap, CLAP_HARD_REALTIME_PLUGIN_ID),
        DeviceKind::Effect,
    );
    register_material(&state);
    let ui = RecordingUiThread::start();

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect_err("a plugin that cannot render offline refuses the render");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("requires real-time rendering and cannot render offline"),
        "{refusal}"
    );
}

// ── A reload under the same id mid-capture ──────────────────────────────

thread_local! {
    /// The live instance a capture seam swaps in under the captured id.
    static RELOAD: RefCell<Option<(HostedRuntime, VettedRegistryEntry)>> = const { RefCell::new(None) };
}

/// The files offline instances were constructed from. Construction runs on
/// the UI thread, so this is a process static, written only by the one test
/// whose construct seam records into it.
static CONSTRUCTED_FROM: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn construct_recording_its_file(
    backend: HostBackend,
    path: &str,
    descriptor_id: &str,
    sample_rate: f64,
    mode: ProcessMode,
) -> Result<HostedRuntime, PluginError> {
    CONSTRUCTED_FROM
        .lock()
        .expect("constructed")
        .push(path.to_string());
    create_hosted_runtime(backend, path, descriptor_id, sample_rate, mode)
}

/// Read the live state, then unload the instance and load another file under
/// the same id before the read returns — what a graph rebuild can do.
fn capture_then_reload_under_the_same_id(
    runtime: &SharedHostedPlugin,
    state: &AppState,
) -> Result<Vec<u8>, PluginCommandError> {
    let chunk = read_live_state(runtime, state)?;
    if let Some((reloaded, load_resolution)) = RELOAD.with(|reload| reload.borrow_mut().take()) {
        attach(state, reloaded, load_resolution, DeviceKind::Effect);
    }
    Ok(chunk)
}

/// The state an offline instance restores and the file it is built from are
/// one live load's: a reload under the instance's id between the state read
/// and the build never pairs the first load's state with the second's file.
#[test]
fn a_reload_under_the_same_id_never_pairs_one_loads_state_with_anothers_file() {
    let fx = InstalledFx::create("reload-first");
    let reloaded_fx = InstalledFx::create("reload-second");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let descriptor = processing_class(Format::Clap);
    RELOAD.with(|reload| {
        *reload.borrow_mut() = Some((
            live_runtime(&reloaded_fx, Format::Clap, &descriptor),
            reloaded_fx.load_resolution(Format::Clap, &descriptor),
        ))
    });
    CONSTRUCTED_FROM.lock().expect("constructed").clear();
    let mut seams = fx.seams();
    seams.scan_policy =
        PluginScanPolicy::with_allowed_roots(vec![fx.root.clone(), reloaded_fx.root.clone()]);
    seams.capture_state = capture_then_reload_under_the_same_id;
    seams.construct = construct_recording_its_file;

    let outcome = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    );

    assert!(
        RELOAD.with(|reload| reload.borrow().is_none()),
        "the reload landed during the state read"
    );
    // The record and its load were read together before the state read, so
    // the reload only moves the next render: this one prints the first load.
    outcome.expect("the render prints the load whose state it read");
    let constructed_from = CONSTRUCTED_FROM.lock().expect("constructed").clone();
    assert_eq!(
        constructed_from,
        vec![fx.clap_path.to_str().expect("utf8").to_string()],
        "the offline instance is built from the file whose state it restores"
    );
}

/// A live runtime reloaded away while the render reads its state is held by
/// the render alone once the read returns. That last reference is retired for
/// the sweep to tear down on the UI thread, never dropped on the render's own
/// thread.
#[test]
fn a_live_runtime_reloaded_away_during_its_state_read_is_retired_not_dropped_by_the_render() {
    let fx = InstalledFx::create("retired-first");
    let reloaded_fx = InstalledFx::create("retired-second");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let teardown_threads = Arc::new(Mutex::new(Vec::new()));
    live.witness_teardown(Arc::clone(&teardown_threads));
    let reloaded_away = Arc::downgrade(&live);
    drop(live);
    let descriptor = processing_class(Format::Clap);
    RELOAD.with(|reload| {
        *reload.borrow_mut() = Some((
            live_runtime(&reloaded_fx, Format::Clap, &descriptor),
            reloaded_fx.load_resolution(Format::Clap, &descriptor),
        ))
    });
    let mut seams = fx.seams();
    seams.scan_policy =
        PluginScanPolicy::with_allowed_roots(vec![fx.root.clone(), reloaded_fx.root.clone()]);
    seams.capture_state = capture_then_reload_under_the_same_id;

    render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect("the render prints the load whose state it read");

    assert!(
        RELOAD.with(|reload| reload.borrow().is_none()),
        "the reload landed during the state read"
    );
    assert!(
        teardown_threads.lock().expect("teardown").is_empty(),
        "the reloaded-away runtime was not torn down by the render"
    );
    {
        let retired = state.retired_engine_plugins.lock().expect("retired");
        assert_eq!(retired.len(), 1, "the render's last reference is retired");
        assert!(
            std::ptr::eq(Arc::as_ptr(&retired[0]), reloaded_away.as_ptr()),
            "the retired runtime is the one reloaded away"
        );
    }

    state.sweep_retired_engine_plugins(&ui);
    assert_eq!(
        *teardown_threads.lock().expect("teardown"),
        vec![ui.thread_id],
        "the sweep tears it down on the UI thread"
    );
}

/// The mapping and the build read the live records under separate locks. A
/// reload under the instance's id between them — here an instrument from
/// another file, under another engine plugin id — is refused by the plugin the
/// batch was mapped against, and nothing is built.
#[test]
fn a_reload_between_the_mapping_and_the_build_refuses_the_render_by_name() {
    let fx = InstalledFx::create("replaced-first");
    let reloaded_fx = InstalledFx::create("replaced-second");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let descriptor = processing_class(Format::Clap);
    let reloaded = Arc::new(SharedHostedPlugin::new(live_runtime(
        &reloaded_fx,
        Format::Clap,
        &descriptor,
    )));
    let reload = Mutex::new(Some((
        reloaded,
        reloaded_fx.load_resolution(Format::Clap, &descriptor),
    )));
    let mut seams = fx.seams();
    seams.scan_policy =
        PluginScanPolicy::with_allowed_roots(vec![fx.root.clone(), reloaded_fx.root.clone()]);
    seams.after_mapping = Some(Box::new(move |state: &AppState| {
        if let Some((shared, load_resolution)) = reload.lock().expect("reload").take() {
            record_engine_instance(
                state,
                shared,
                load_resolution,
                DeviceKind::Generator,
                ENGINE_PLUGIN_ID + 1,
            );
        }
    }));

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect_err("a print of another plugin than the one mapped is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("its live instance was replaced while the render started"),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing is built");
}

// ── Granted plugin folders ──────────────────────────────────────────────

/// A forbidden set inside `tree`, clear of the fixture's own folder.
fn forbidden_in(tree: &TempTree) -> ForbiddenRoots {
    ForbiddenRoots {
        home: Some(tree.dir("home/musician")),
        default_roots: vec![tree.dir("defaults/VST3")],
        app_storage_roots: vec![tree.dir("app-storage")],
        renderer_writable_grants: Vec::new(),
    }
}

/// An export through the production seams over a grant store that holds the
/// fixture's folder, or nothing.
fn export_through_production_seams(name: &str, granted: bool) -> Result<Vec<f32>, String> {
    let fx = InstalledFx::create(name);
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let tree = TempTree::create(name);
    let forbidden = forbidden_in(&tree);
    if granted {
        grant_at(&tree.store(), &forbidden, &fx.root).expect("the fixture folder is grantable");
    }
    let seams = OfflinePluginSeams::over_grant_store(Some(&tree.store()), &forbidden);
    render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
}

/// The re-vet authorizes what a live load does: a plugin under a folder the
/// user granted prints.
#[test]
fn a_plugin_under_a_granted_folder_passes_the_offline_re_vet_and_prints() {
    let print = export_through_production_seams("granted-folder", true)
        .expect("a plugin from a granted folder renders offline");
    assert!(
        print.iter().any(|sample| *sample != 0.0),
        "the print carries the effect's output"
    );
}

/// The same export with nothing granted is refused by name: the grant is what
/// admitted it.
#[test]
fn a_plugin_under_an_ungranted_folder_is_refused_by_the_offline_re_vet() {
    let refusal = export_through_production_seams("ungranted-folder", false)
        .expect_err("a plugin outside every authorized folder is refused");
    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("Unauthorized plugin scan path"),
        "{refusal}"
    );
}

#[test]
fn an_unreadable_live_state_refuses_the_render_by_name_and_builds_nothing() {
    let fx = InstalledFx::create("unreadable-state");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    seams.capture_state = |_, _| Err(PluginCommandError::Host("the seam keeps it".to_string()));

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect_err("a print without the live state is not the project");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("its live state could not be read: the seam keeps it"),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing was constructed");
}

#[test]
fn a_hosted_instrument_refuses_the_render_and_the_probe_alike() {
    let fx = InstalledFx::create("instrument");
    let state = AppState::default();
    attach(
        &state,
        live_runtime(&fx, Format::Clap, CLAP_PLUGIN_ID),
        fx.load_resolution(Format::Clap, CLAP_PLUGIN_ID),
        DeviceKind::Generator,
    );
    register_material(&state);
    let ui = RecordingUiThread::start();
    let commands = impulse_track(json!([fx_device()]));

    let refusal = render(batch(commands.clone()), &state, &ui, &fx.seams(), None)
        .expect_err("a hosted instrument does not render offline yet");
    let probe = block_on_test(crate::commands::graph::map_graph_batch(
        json!([]),
        batch(commands),
        EXPORT_RATE,
        None,
        &state,
    ))
    .expect("the probe answers");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("hosted instruments do not render offline yet"),
        "{refusal}"
    );
    assert_eq!(probe["acceptance"], "rejected");
    assert_eq!(probe["reason"].as_str(), Some(refusal.as_str()));
    assert_eq!(ui.tasks_run(), 0);
}

#[test]
fn the_probe_admits_the_attached_effect_the_render_prints() {
    let fx = InstalledFx::create("probe");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);

    let probe = block_on_test(crate::commands::graph::map_graph_batch(
        json!([]),
        batch(impulse_track(json!([fx_device()]))),
        EXPORT_RATE,
        None,
        &state,
    ))
    .expect("the probe answers");

    assert_eq!(probe["acceptance"], "accepted", "{probe}");
    assert_eq!(probe["reports"][0]["deviceIds"], json!(["d-fx"]));
}

// ── (e) Cancellation ────────────────────────────────────────────────────

fn a_cancel_mid_render_stops_the_render_of(format: Format) {
    let fx = InstalledFx::create(&format!("cancel-{format:?}"));
    let (state, _live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    let watch = OfflineInstanceWatch::default();
    seams.after_build = Some(watch.after_build(None));
    let long_render = |state: &AppState| {
        block_on_test(render_graph_offline_with(
            batch(impulse_track(json!([fx_device()]))),
            LONG_RENDER_FRAMES,
            EXPORT_RATE,
            Some("render-1".to_string()),
            &ui,
            state,
            &seams,
        ))
    };

    let outcome = thread::scope(|scope| {
        let rendering = scope.spawn(|| long_render(&state));
        // The observable: the render is registered and has rendered a block.
        loop {
            let started = state
                .offline_renders
                .lock()
                .expect("renders")
                .in_flight("render-1")
                .is_some_and(|control| control.rendered_frames() > 0);
            if started {
                break;
            }
            assert!(
                !rendering.is_finished(),
                "the render ended before it was cancelled"
            );
            thread::yield_now();
        }
        cancel_graph_offline("render-1".to_string(), &state).expect("the cancel lands");
        rendering.join().expect("the render thread returns")
    });

    let refusal = outcome.expect_err("a cancelled render returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    watch.assert_every_instance_left_processing();
    watch.assert_every_instance_torn_down_on(&ui);
    assert_eq!(
        ui.tasks_run(),
        2,
        "the construction and the release ran on the UI thread"
    );
    assert!(state
        .retired_engine_plugins
        .lock()
        .expect("retired")
        .is_empty());
    assert!(
        state
            .offline_renders
            .lock()
            .expect("renders")
            .in_flight("render-1")
            .is_none(),
        "a finished render leaves the registry"
    );
}

#[test]
fn a_cancel_that_arrives_before_its_render_still_cancels_it_and_builds_nothing() {
    let fx = InstalledFx::create("cancel-early");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();

    cancel_graph_offline("render-early".to_string(), &state).expect("an early cancel is kept");
    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &fx.seams(),
        Some("render-early"),
    )
    .expect_err("the render was cancelled before it began");

    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(
        ui.tasks_run(),
        0,
        "no instance is built for a cancelled render"
    );
    assert_eq!(
        state
            .offline_renders
            .lock()
            .expect("renders")
            .pending_cancel_count(),
        0
    );
}

#[test]
fn the_pending_cancel_record_is_bounded_and_forgets_the_oldest() {
    let mut renders = OfflineRenders::default();
    for index in 0..=PENDING_CANCEL_LIMIT {
        renders.cancel(&format!("never-started-{index}"));
    }
    assert_eq!(renders.pending_cancel_count(), PENDING_CANCEL_LIMIT);

    let oldest = renders.begin("never-started-0").expect("the id is free");
    let newest = renders
        .begin(&format!("never-started-{PENDING_CANCEL_LIMIT}"))
        .expect("the id is free");
    assert!(!oldest.is_cancelled(), "the oldest cancel was forgotten");
    assert!(newest.is_cancelled(), "a remembered cancel still lands");
    renders.cancel("never-started-0");
    assert!(
        oldest.is_cancelled(),
        "an in-flight render is cancelled directly"
    );
    assert!(
        renders.begin("never-started-0").is_err(),
        "an id in flight is refused"
    );
}

#[test]
fn a_cancel_after_its_render_finished_does_not_cancel_the_next_render_under_its_id() {
    let fx = InstalledFx::create("cancel-late");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let print = || {
        render(
            batch(impulse_track(json!([fx_device()]))),
            &state,
            &ui,
            &seams,
            Some("r"),
        )
    };

    print().expect("the first render under the id prints");
    cancel_graph_offline("r".to_string(), &state).expect("a late cancel is answered");
    assert_eq!(
        state
            .offline_renders
            .lock()
            .expect("renders")
            .pending_cancel_count(),
        0,
        "a cancel for a finished render is dropped, not queued"
    );
    print().expect("the id's next render is not cancelled by the late cancel");
}

#[test]
fn a_cancel_for_a_finished_id_still_cancels_once_a_render_begins_under_it_again() {
    let mut renders = OfflineRenders::default();
    renders.begin("r").expect("the id is free");
    renders.finish("r");
    let again = renders.begin("r").expect("a finished id is free");
    renders.finish("r");

    renders.cancel("r");
    assert_eq!(renders.pending_cancel_count(), 0, "the id just finished");
    let rebegun = renders.begin("r").expect("a finished id is free");
    renders.cancel("r");
    assert!(
        rebegun.is_cancelled(),
        "a render under a reused id is cancellable"
    );
    assert!(!again.is_cancelled());
    renders.finish("r");

    for index in 0..=FINISHED_RENDER_LIMIT {
        renders
            .begin(&format!("finished-{index}"))
            .expect("the id is free");
        renders.finish(&format!("finished-{index}"));
    }
    renders.cancel("finished-0");
    assert_eq!(
        renders.pending_cancel_count(),
        1,
        "the finished record is bounded: the oldest id is forgotten, and its cancel is kept"
    );
}

#[test]
fn a_render_id_is_bounded_on_the_render_and_the_cancel_alike() {
    let fx = InstalledFx::create("render-id-bound");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let at_the_limit = "r".repeat(RENDER_ID_MAX_BYTES);
    let one_over = "r".repeat(RENDER_ID_MAX_BYTES + 1);
    let built_in_only = || batch(impulse_track(json!([])));

    render(built_in_only(), &state, &ui, &seams, Some(&at_the_limit))
        .expect("an id at the limit renders");
    cancel_graph_offline(at_the_limit, &state).expect("an id at the limit is cancellable");

    for (id, reason) in [
        (
            one_over.as_str(),
            "must be at most 128 bytes; this one is 129",
        ),
        ("", "must not be empty"),
    ] {
        let refusal = render(built_in_only(), &state, &ui, &seams, Some(id))
            .expect_err("the render refuses the id");
        assert!(
            refusal.starts_with(OFFLINE_RENDER_ID_INVALID) && refusal.contains(reason),
            "{refusal}"
        );
        let refusal =
            cancel_graph_offline(id.to_string(), &state).expect_err("the cancel refuses the id");
        assert!(
            refusal.starts_with(OFFLINE_RENDER_ID_INVALID) && refusal.contains(reason),
            "{refusal}"
        );
    }
    assert_eq!(
        state
            .offline_renders
            .lock()
            .expect("renders")
            .pending_cancel_count(),
        0,
        "a refused cancel is not queued"
    );
}

/// A rate outside the range is refused before the live state is read or an
/// instance is built; a built-in-only render is held to the same range.
#[test]
fn the_export_sample_rate_is_bounded_before_anything_is_built() {
    let fx = InstalledFx::create("rate-bound");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    seams.capture_state = |_, _| {
        Err(PluginCommandError::Host(
            "a refused rate reads no live state".to_string(),
        ))
    };
    let render_at = |devices: Value, sample_rate: f64| {
        block_on_test(render_graph_offline_with(
            batch(impulse_track(devices)),
            1_024,
            sample_rate,
            None,
            &ui,
            &state,
            &seams,
        ))
    };

    for sample_rate in [7_999.0, 384_001.0, f64::NAN, f64::INFINITY] {
        for devices in [json!([fx_device()]), json!([])] {
            let refusal = render_at(devices, sample_rate).expect_err("the rate is refused");
            assert!(
                refusal
                    .contains("outside the offline render's supported range of 8000 to 384000 Hz"),
                "{refusal}"
            );
        }
    }
    assert_eq!(ui.tasks_run(), 0, "a refused rate builds nothing");

    for sample_rate in [8_000.0, 384_000.0] {
        render_at(json!([]), sample_rate).expect("a built-in-only render at the bound renders");
    }
}

/// The runtime gate covers an instance's vet and construction, not the rest
/// of the build: an unload of every plugin issued while an instance waits to
/// have its state restored completes before the export finishes building.
#[test]
fn an_unload_of_every_plugin_does_not_wait_out_an_exports_build() {
    let _hint_guard = crate::host::hint_test_support::guard();
    let _serial = crate::commands::plugins::serialize_against_exclusive_gate_holds();
    let fx = InstalledFx::create("gate-scope");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let (restoring, restore_reached) = mpsc::channel::<()>();
    let (release_restore, restore_released) = mpsc::channel::<()>();
    let restore_released = Mutex::new(restore_released);
    let mut seams = fx.seams();
    seams.before_restore = Some(Box::new(move || {
        let _ = restoring.send(());
        let _ = restore_released
            .lock()
            .expect("release")
            .recv_timeout(Duration::from_secs(30));
    }));

    let unloaded_while_building = thread::scope(|scope| {
        let building = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                None,
            )
        });
        restore_reached
            .recv_timeout(Duration::from_secs(10))
            .expect("the build constructs its instance");
        let (unloaded, unload_done) = mpsc::channel();
        let state = &state;
        scope.spawn(move || {
            let reply = block_on_test(crate::commands::plugins::unload_plugin(
                None,
                &crate::host::plugin_window::NoWindowHost,
                state,
            ));
            let _ = unloaded.send(reply.map(|_| ()));
        });
        let outcome = unload_done.recv_timeout(Duration::from_secs(5));
        let still_building = !building.is_finished();
        let _ = release_restore.send(());
        let _ = building.join().expect("the build thread returns");
        (outcome, still_building)
    });

    let (outcome, still_building) = unloaded_while_building;
    // Unload-all takes the runtime gate exclusively before it reads which
    // instances exist, so its answering at all means the gate was free.
    outcome
        .expect("the unload completes while the export is still building")
        .expect("the unload answers");
    assert!(still_building, "the export had not finished building");
}

/// The live state read refuses while parameter writes wait for the live
/// engine, rather than draining them, so the render refuses by that reason and
/// builds nothing.
#[test]
fn a_live_instance_with_parameter_writes_pending_refuses_the_render_by_that_reason() {
    let fx = InstalledFx::create("pending-writes");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    live.enqueue_parameter(GAIN_PARAM_ID, 0.7)
        .expect("the write is queued for the live engine");
    assert!(live.has_pending_parameter_writes());

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect_err("a print past unprocessed parameter writes is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("the plugin has parameter writes pending"),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing is built");
    assert!(
        live.has_pending_parameter_writes(),
        "the render leaves the live writes for the live engine"
    );
}

#[test]
fn a_cancel_mid_render_stops_it_and_releases_its_clap_instance_on_the_ui_thread() {
    a_cancel_mid_render_stops_the_render_of(Format::Clap);
}

#[test]
fn a_cancel_mid_render_stops_it_and_releases_its_vst3_instance_on_the_ui_thread() {
    a_cancel_mid_render_stops_the_render_of(Format::Vst3);
}

// ── (f) A block the offline instance was not served ─────────────────────

#[test]
fn an_offline_instance_that_misses_a_block_refuses_the_render_by_name() {
    let fx = InstalledFx::create("unserved");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    // Closing the lifecycle is what an unload does; the slot then passes
    // every block through dry.
    seams.after_build = Some(Box::new(|runtimes: &[Arc<SharedHostedPlugin>]| {
        runtimes.iter().for_each(|runtime| runtime.begin_unload())
    }));

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect_err("a print with a dry hole in it is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("which would pass through dry"),
        "{refusal}"
    );
    assert_eq!(
        ui.tasks_run(),
        2,
        "the refused render still releases its instance"
    );
}

// ── A block the offline instance failed to process ─────────────────────

/// A class that answers one process call with a failure, mid-render: the
/// wrapper latches it and passes that block through unprocessed, so the print
/// is refused by name, and the instance is still released on the UI thread.
fn an_offline_instance_that_fails_a_block_refuses_the_render_by_name(format: Format) {
    let fx = InstalledFx::create(&format!("process-error-{format:?}"));
    let (state, _live) = state_with_live_class(&fx, format, &failing_class(format));
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    let watch = OfflineInstanceWatch::default();
    seams.after_build = Some(watch.after_build(None));
    let frames_before_the_failure =
        (FAILING_PROCESS_CALL as usize + 1) * daw_engine::offline::OFFLINE_BLOCK_FRAMES;
    assert!(
        FRAMES > frames_before_the_failure,
        "the render reaches the failing call"
    );

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect_err("a print a plugin failed to process is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("it failed to process a block of the render"),
        "{refusal}"
    );
    watch.assert_every_instance_left_processing();
    watch.assert_every_instance_torn_down_on(&ui);
    assert_eq!(
        ui.tasks_run(),
        2,
        "the refused render still releases its instance"
    );
    assert!(state
        .retired_engine_plugins
        .lock()
        .expect("retired")
        .is_empty());
}

#[test]
fn an_offline_clap_instance_that_fails_a_block_refuses_the_render_by_name() {
    an_offline_instance_that_fails_a_block_refuses_the_render_by_name(Format::Clap);
}

#[test]
fn an_offline_vst3_instance_that_fails_a_block_refuses_the_render_by_name() {
    an_offline_instance_that_fails_a_block_refuses_the_render_by_name(Format::Vst3);
}

// ── An offline instance that never processes ───────────────────────────

/// A class that refuses to start processing has every block of the render
/// passed through untouched by its wrapper — the live path's behaviour, kept —
/// so the print is refused by name, and the instance is still released.
fn an_offline_instance_that_refuses_to_start_processing_refuses_the_render(format: Format) {
    let fx = InstalledFx::create(&format!("start-refused-{format:?}"));
    let (state, _live) = state_with_live_class(&fx, format, &start_refusing_class(format));
    let ui = RecordingUiThread::start();

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect_err("a print a plugin never processed is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("it refused to start processing"),
        "{refusal}"
    );
    assert_eq!(
        ui.tasks_run(),
        2,
        "the refused render still releases its instance"
    );
}

#[test]
fn an_offline_clap_instance_that_refuses_to_start_processing_refuses_the_render() {
    an_offline_instance_that_refuses_to_start_processing_refuses_the_render(Format::Clap);
}

#[test]
fn an_offline_vst3_instance_that_refuses_to_start_processing_refuses_the_render() {
    an_offline_instance_that_refuses_to_start_processing_refuses_the_render(Format::Vst3);
}

/// The renderer recognises a cancel by its `offline-render-cancelled` prefix
/// (`isNativeOfflineRenderCancelled.ts`), so the whole text is pinned, with
/// and without the caller's render id.
#[test]
fn a_cancelled_render_answers_in_the_text_the_renderer_matches() {
    assert_eq!(
        OfflineRenderError::Cancelled {
            render_id: Some("render-1".to_string()),
            frames: 512,
        }
        .to_string(),
        "offline-render-cancelled: render 'render-1' was cancelled after 512 frames; nothing was returned"
    );
    assert_eq!(
        OfflineRenderError::Cancelled {
            render_id: None,
            frames: 0,
        }
        .to_string(),
        "offline-render-cancelled: render was cancelled after 0 frames; nothing was returned"
    );
}
