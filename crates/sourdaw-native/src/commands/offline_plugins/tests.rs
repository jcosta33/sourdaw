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
use crate::commands::graph::{render_graph_offline_with, OfflineRenderHead};
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
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_INSTRUMENT_PLUGIN_ID, CLAP_PLUGIN_ID,
    CLAP_PROCESS_ERROR_PLUGIN_ID, CLAP_START_REFUSED_PLUGIN_ID, ECHO_FRAMES, FAILING_PROCESS_CALL,
    GAIN_PARAM_ID, LATENCY_FRAMES, VST3_CLASS_ID, VST3_INSTRUMENT_CLASS_ID,
    VST3_PROCESS_ERROR_CLASS_ID, VST3_START_REFUSED_CLASS_ID,
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

    /// What a load records about an instrument class: the same file, scanned
    /// as a generator.
    fn instrument_resolution(&self, format: Format, descriptor_id: &str) -> VettedRegistryEntry {
        let mut resolution = self.load_resolution(format, descriptor_id);
        resolution.entry.chain_kind = DeviceKind::Generator;
        resolution
    }

    fn seams(&self) -> OfflinePluginSeams {
        OfflinePluginSeams {
            scan_policy: PluginScanPolicy::with_allowed_roots(vec![self.root.clone()]),
            capture_state: read_live_state,
            construct: create_hosted_runtime,
            after_build: None,
            after_admission: None,
            after_mapping: None,
            before_restore: None,
            before_runtime_gate: None,
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
        let thread = thread::spawn(move || {
            announce
                .send(thread::current().id())
                .expect("the UI thread announces itself");
            while let Ok(task) = queued.recv() {
                task.run();
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

    fn run_on_ui_thread(
        &self,
        task: &Arc<UiThreadTask>,
    ) -> Result<(), crate::host::ui_thread::UiThreadError> {
        let (done, waited) = mpsc::sync_channel(1);
        let queued = Arc::clone(task);
        let counted = Arc::clone(&self.tasks_run);
        self.work
            .send(UiThreadTask::new(move || {
                queued.run();
                // Counted before the answer: the caller reads the count as soon
                // as it is answered.
                counted.fetch_add(1, Ordering::SeqCst);
                let _ = done.send(());
            }))
            .map_err(|_| "the UI thread is gone".to_string())?;
        waited
            .recv()
            .map_err(|_| "the UI thread never answered".to_string().into())
    }
}

/// Every count below is read straight after the call that ran the task
/// returns, so a task has to be counted before its caller is answered.
///
/// The window between the answer and a late count is a few instructions, so
/// the loop runs with half the cores kept busy: preempting the UI thread inside
/// it is what a loaded CI runner does. The other half, and the time bound, are
/// for the tests of this process running beside it, several of which hold
/// wall-clock deadlines.
#[test]
fn a_ui_thread_task_is_counted_before_its_caller_is_answered() {
    const ROUND_TRIPS: usize = 20_000;
    const LOAD_BOUND: std::time::Duration = std::time::Duration::from_millis(500);
    let cores = thread::available_parallelism().map_or(2, usize::from);
    let _load = SpinLoad::start((cores / 2).max(1));
    let ui = RecordingUiThread::start();
    let started = std::time::Instant::now();

    for expected in 1..=ROUND_TRIPS {
        if started.elapsed() > LOAD_BOUND {
            break;
        }
        ui.run_on_ui_thread(&UiThreadTask::new(|| {}))
            .expect("the UI thread runs the task");
        assert_eq!(
            ui.tasks_run(),
            expected,
            "an answered task must already be counted"
        );
    }
}

/// Threads that keep cores busy until dropped, on every path out of a test.
struct SpinLoad {
    spinning: Arc<std::sync::atomic::AtomicBool>,
    spinners: Vec<thread::JoinHandle<()>>,
}

impl SpinLoad {
    fn start(threads: usize) -> Self {
        let spinning = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let spinners = (0..threads)
            .map(|_| {
                let spinning = Arc::clone(&spinning);
                thread::spawn(move || {
                    while spinning.load(Ordering::Relaxed) {
                        std::hint::spin_loop();
                    }
                })
            })
            .collect();
        Self { spinning, spinners }
    }
}

impl Drop for SpinLoad {
    fn drop(&mut self) {
        self.spinning.store(false, Ordering::Relaxed);
        for spinner in self.spinners.drain(..) {
            let _ = spinner.join();
        }
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
            sample_offset: 0,
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

/// The descriptor id of the class that sounds the notes it is sent.
fn instrument_class(format: Format) -> String {
    match format {
        Format::Clap => CLAP_INSTRUMENT_PLUGIN_ID.to_string(),
        Format::Vst3 => format_class_id(&VST3_INSTRUMENT_CLASS_ID),
    }
}

/// An engine holding one live instance of the instrument class, attached as a
/// generator, with Gain at `LIVE_GAIN`.
fn state_with_live_instrument(
    fx: &InstalledFx,
    format: Format,
) -> (AppState, Arc<SharedHostedPlugin>) {
    let state = AppState::default();
    let descriptor = instrument_class(format);
    let live = attach(
        &state,
        live_runtime(fx, format, &descriptor),
        fx.instrument_resolution(format, &descriptor),
        DeviceKind::Generator,
    );
    register_material(&state);
    (state, live)
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
    render_frames(batch, FRAMES as u32, state, ui, seams, render_id)
}

fn render_frames(
    batch: Value,
    frames: u32,
    state: &AppState,
    ui: &dyn UiThread,
    seams: &OfflinePluginSeams,
    render_id: Option<&str>,
) -> Result<Vec<f32>, String> {
    render_frames_from(
        batch,
        frames,
        OfflineRenderHead::EngineFrameZero,
        state,
        ui,
        seams,
        render_id,
    )
}

fn render_frames_from(
    batch: Value,
    frames: u32,
    head: OfflineRenderHead,
    state: &AppState,
    ui: &dyn UiThread,
    seams: &OfflinePluginSeams,
    render_id: Option<&str>,
) -> Result<Vec<f32>, String> {
    block_on_test(render_graph_offline_with(
        batch,
        frames,
        EXPORT_RATE,
        render_id.map(str::to_string),
        head,
        ui,
        state,
        seams,
    ))
    .map_err(|refusal| refusal.to_string())
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
                Ok::<_, String>(plugin.activation_sample_rate())
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
            Ok::<_, String>(plugin.activation_sample_rate())
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

/// An export prints the compensation from the head: the engine renders the
/// depth it holds the master to, the hosted instance's own latency, ahead of
/// the requested frames and drops it, so the dry track keeps its timeline
/// frame, the latent strip arrives on it too, and the print keeps its length.
fn a_trimmed_print_starts_on_the_masters_timeline_frame_zero_in(format: Format) {
    let fx = InstalledFx::create(&format!("pdc-head-{format:?}"));
    let (state, _live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let dry_track = vec![
        strip("t2", json!([])),
        clip("t2", "impulse", DRY_IMPULSE_FRAME, 4),
    ];
    let mut both = impulse_track(json!([fx_device()]));
    both.extend(dry_track.clone());

    let dry_alone =
        render(batch(dry_track), &state, &ui, &seams, None).expect("the dry track renders");
    let untrimmed = render(batch(both.clone()), &state, &ui, &seams, None).expect("renders");
    let trimmed = render_frames_from(
        batch(both),
        FRAMES as u32,
        OfflineRenderHead::MasterCompensationTrimmed,
        &state,
        &ui,
        &seams,
        None,
    )
    .expect("the trimmed print renders");

    assert_eq!(
        trimmed.len(),
        FRAMES,
        "the print keeps the frames it was asked for"
    );
    assert_eq!(
        trimmed[DRY_IMPULSE_FRAME], dry_alone[DRY_IMPULSE_FRAME],
        "the dry impulse is back on its own timeline frame"
    );
    let untrimmed_tail = FRAMES - LATENCY_FRAMES;
    assert_frames_equal(&trimmed[..untrimmed_tail], &untrimmed[LATENCY_FRAMES..]);
}

#[test]
fn a_trimmed_clap_print_starts_on_the_masters_timeline_frame_zero() {
    a_trimmed_print_starts_on_the_masters_timeline_frame_zero_in(Format::Clap);
}

#[test]
fn a_trimmed_vst3_print_starts_on_the_masters_timeline_frame_zero() {
    a_trimmed_print_starts_on_the_masters_timeline_frame_zero_in(Format::Vst3);
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
    // Two points inside one render block, neither on its head: the whole path
    // — mapping, engine stamp, bridge queue, wrapper, plugin — has to carry
    // each one to its own sample for the print to match.
    const BLOCK_HEAD: usize = 8_192;
    const FIRST_WRITE: usize = BLOCK_HEAD + 10;
    const SECOND_WRITE: usize = BLOCK_HEAD + 200;
    let fx = InstalledFx::create(&format!("automation-{format:?}"));
    let (state, _live) = state_with_live_fx(&fx, format);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();
    let dc_track = |devices: Value| vec![strip("t1", devices), clip("t1", "dc", 0, FRAMES)];
    let write = |value: f64, frame: usize| {
        json!({ "kind": "write-device-parameter",
            "target": { "kind": "device-parameter", "trackId": "t1", "deviceId": "d-fx",
                        "parameterId": GAIN_PARAM_ID.to_string() },
            "write": { "shape": "step", "value": value, "time": frame as f64 / EXPORT_RATE } })
    };

    let dry = render(batch(dc_track(json!([]))), &state, &ui, &seams, None).expect("renders");
    let mut automated = dc_track(json!([fx_device()]));
    automated.push(write(1.0, FIRST_WRITE));
    automated.push(write(0.5, SECOND_WRITE));
    let print = render(batch(automated), &state, &ui, &seams, None).expect("renders");

    assert_eq!(BLOCK_HEAD % daw_engine::offline::OFFLINE_BLOCK_FRAMES, 0);
    const { assert!(SECOND_WRITE < BLOCK_HEAD + daw_engine::offline::OFFLINE_BLOCK_FRAMES) };
    let expected = through_the_effect(&dry, |frame| match frame {
        frame if frame < FIRST_WRITE => LIVE_GAIN as f32,
        frame if frame < SECOND_WRITE => 1.0,
        _ => 0.5,
    });
    assert_frames_equal(&print, &expected);
}

#[test]
fn a_hosted_parameter_write_mid_render_moves_an_offline_clap_instance_on_its_sample() {
    a_hosted_parameter_write_mid_render_moves_the_offline_instance_in(Format::Clap);
}

#[test]
fn a_hosted_parameter_write_mid_render_moves_an_offline_vst3_instance_on_its_sample() {
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
    render_control: &OfflineRenderControl,
) -> Result<Vec<u8>, PluginCommandError> {
    let chunk = read_live_state(runtime, state, render_control)?;
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

/// An engine plugin id restarts with the engine, so a replacement loaded from
/// another file whose plugin reports the same name and kind can land under the
/// very id the batch was mapped with. It is still not the plugin the batch was
/// mapped against, and the render refuses it by name.
#[test]
fn a_same_named_replacement_under_the_mapped_engine_id_refuses_the_render_by_name() {
    let fx = InstalledFx::create("same-name-first");
    let replacement_fx = InstalledFx::create("same-name-second");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let descriptor = processing_class(Format::Clap);
    let replacement = Arc::new(SharedHostedPlugin::new(live_runtime(
        &replacement_fx,
        Format::Clap,
        &descriptor,
    )));
    let reload = Mutex::new(Some((
        replacement,
        replacement_fx.load_resolution(Format::Clap, &descriptor),
    )));
    let mut seams = fx.seams();
    seams.scan_policy =
        PluginScanPolicy::with_allowed_roots(vec![fx.root.clone(), replacement_fx.root.clone()]);
    seams.after_mapping = Some(Box::new(move |state: &AppState| {
        if let Some((shared, load_resolution)) = reload.lock().expect("reload").take() {
            record_engine_instance(
                state,
                shared,
                load_resolution,
                DeviceKind::Effect,
                ENGINE_PLUGIN_ID,
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
    .map(|print| print.len())
    .expect_err("a print of a replacement under the mapped id is refused");

    assert!(
        refusal.contains("'d-fx'")
            && refusal.contains("'Sourdaw Harness Fx'")
            && refusal.contains("its live instance was replaced while the render started"),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing is built");
}

/// The same live runtime re-attached under a new engine plugin id between the
/// mapping and the build is the plugin the batch was mapped against: the
/// render prints it, exactly as it prints with the id unchanged.
#[test]
fn an_unchanged_instance_re_attached_under_a_new_engine_id_still_prints() {
    let fx = InstalledFx::create("re-attached");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let descriptor = processing_class(Format::Clap);
    let unchanged = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect("the instance prints under the id it was mapped with");

    let reattach = Mutex::new(Some((live, fx.load_resolution(Format::Clap, &descriptor))));
    let mut seams = fx.seams();
    seams.after_mapping = Some(Box::new(move |state: &AppState| {
        if let Some((shared, load_resolution)) = reattach.lock().expect("reattach").take() {
            record_engine_instance(
                state,
                shared,
                load_resolution,
                DeviceKind::Effect,
                ENGINE_PLUGIN_ID + 1,
            );
        }
    }));

    let reattached = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        None,
    )
    .expect("the same runtime under a new engine id prints");

    assert!(
        reattached.iter().any(|sample| *sample != 0.0),
        "the print carries the effect's output"
    );
    assert_frames_equal(&reattached, &unchanged);
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
    seams.capture_state = |_, _, _| {
        Err(PluginCommandError::Control(
            PluginControlRefusal::TimedOut {
                plugin: "the seam keeps it".to_string(),
            },
        ))
    };

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
            && refusal.contains(
                "its live state could not be read: Timed out waiting for plugin control access: \
                 the seam keeps it"
            ),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing was constructed");
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

// ── (d2) A hosted instrument ────────────────────────────────────────────

/// One scheduled note on the instrument's device, at an export-rate frame.
fn note(frame: usize, key: u8, velocity: u8, is_note_on: bool) -> Value {
    json!({ "time": frame as f64 / EXPORT_RATE, "note": key, "velocity": velocity,
            "channel": 0, "isNoteOn": is_note_on })
}

fn schedule_notes(notes: Vec<Value>) -> Value {
    json!({ "kind": "schedule-midi", "trackId": "t1", "deviceId": "d-fx",
            "probabilitySeed": 0, "notes": notes })
}

/// Three held notes, none sharing a velocity: one starting and ending inside
/// a block, one inside another, and one on block edges (blocks are 512 frames).
/// Each is `(on, off, key, velocity)`.
const HELD_NOTES: [(usize, usize, u8, u8); 3] = [
    (700, 1_300, 60, 127),
    (1_800, 2_000, 64, 64),
    (2_560, 3_072, 67, 32),
];

fn held_note_commands() -> Vec<Value> {
    let notes = HELD_NOTES
        .iter()
        .flat_map(|(on, off, key, velocity)| {
            [
                note(*on, *key, *velocity, true),
                note(*off, *key, *velocity, false),
            ]
        })
        .collect();
    vec![strip("t1", json!([fx_device()])), schedule_notes(notes)]
}

/// What the instrument class writes for a velocity at `LIVE_GAIN`: the
/// velocity as the format's wrapper normalises it, times the gain.
fn instrument_level(format: Format, velocity: u8) -> f32 {
    let normalised = match format {
        Format::Clap => (f64::from(velocity) / 127.0) as f32,
        Format::Vst3 => f32::from(velocity) / 127.0,
    };
    LIVE_GAIN as f32 * normalised
}

/// The print the held notes owe: each note's level from its note-on's frame up
/// to, not including, its note-off's frame, and silence elsewhere.
fn the_held_notes_printed(format: Format) -> Vec<f32> {
    let mut expected = vec![0.0f32; FRAMES];
    for (on, off, _, velocity) in HELD_NOTES {
        expected[on..off].fill(instrument_level(format, velocity));
    }
    expected
}

fn a_hosted_instrument_prints_the_notes_scheduled_on_it(format: Format) {
    let fx = InstalledFx::create(&format!("instrument-{format:?}"));
    let (state, _live) = state_with_live_instrument(&fx, format);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    let watch = OfflineInstanceWatch::default();
    seams.after_build = Some(watch.after_build(Some(record_offline_state)));
    OFFLINE_STATE.with(|states| states.borrow_mut().clear());

    let print = render(batch(held_note_commands()), &state, &ui, &seams, None)
        .expect("the attached instrument renders offline");

    assert_frames_equal(&print, &the_held_notes_printed(format));
    let offline_states = OFFLINE_STATE.with(|states| states.borrow().clone());
    assert_eq!(offline_states.len(), 1, "one offline instance was built");
    let (offline_chunk, offline_rate) = &offline_states[0];
    let expected_offline = match format {
        Format::Clap => CLAP_RENDER_OFFLINE,
        Format::Vst3 => VST3_OFFLINE,
    };
    assert_eq!(
        recorded(offline_chunk, format).configured_mode,
        expected_offline
    );
    assert_eq!(*offline_rate, EXPORT_RATE);
    watch.assert_every_instance_left_processing();
    watch.assert_every_instance_torn_down_on(&ui);
    assert_eq!(
        ui.tasks_run(),
        2,
        "one construction and one release, both on the UI thread"
    );
}

#[test]
fn a_clap_instrument_prints_the_notes_scheduled_on_it_on_their_samples() {
    a_hosted_instrument_prints_the_notes_scheduled_on_it(Format::Clap);
}

#[test]
fn a_vst3_instrument_prints_the_notes_scheduled_on_it_on_their_samples() {
    a_hosted_instrument_prints_the_notes_scheduled_on_it(Format::Vst3);
}

/// The notes land on the one device the batch addresses: the same render with
/// no notes prints silence, so the level above is the notes' and not the
/// instrument's idle output.
#[test]
fn a_hosted_instrument_with_no_notes_prints_silence() {
    let fx = InstalledFx::create("instrument-idle");
    let (state, _live) = state_with_live_instrument(&fx, Format::Clap);
    let ui = RecordingUiThread::start();

    let print = render(
        batch(vec![strip("t1", json!([fx_device()]))]),
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect("the attached instrument renders offline");

    assert_frames_equal(&print, &vec![0.0; FRAMES]);
}

#[test]
fn the_probe_admits_the_attached_instrument_the_render_prints() {
    let fx = InstalledFx::create("instrument-probe");
    let (state, _live) = state_with_live_instrument(&fx, Format::Vst3);

    let probe = block_on_test(crate::commands::graph::map_graph_batch(
        json!([]),
        batch(held_note_commands()),
        EXPORT_RATE,
        None,
        &state,
    ))
    .expect("the probe answers");

    assert_eq!(probe["acceptance"], "accepted", "{probe}");
    assert_eq!(probe["reports"][0]["deviceIds"], json!(["d-fx"]));
}

/// A device on a strip that contributes nothing is omitted whatever it is, so
/// an instrument there builds no offline instance.
#[test]
fn a_hosted_instrument_on_a_silent_strip_builds_no_instance() {
    let fx = InstalledFx::create("instrument-silent");
    let (state, _live) = state_with_live_instrument(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut silent = strip("t1", json!([fx_device()]));
    silent["contributesAudio"] = json!(false);

    let print = render(batch(vec![silent]), &state, &ui, &fx.seams(), None)
        .expect("a silent strip renders");

    assert_frames_equal(&print, &vec![0.0; FRAMES]);
    assert_eq!(ui.tasks_run(), 0, "nothing was constructed");
}

/// Notes in the long part below: past the live store's reserve of events.
const LONG_PART_NOTES: usize = 3_000;
/// Frames between one note's on and the next's, and how long each is held.
/// Ten frames apart puts about fifty events in a 512-frame block, under the
/// block's event buffer, so only the store's size is under test.
const LONG_PART_SPACING: usize = 10;
const LONG_PART_HELD: usize = 4;
const LONG_PART_START: usize = 1_000;

fn long_part_velocity(index: usize) -> u8 {
    (1 + index % 127) as u8
}

fn long_part_on(index: usize) -> usize {
    LONG_PART_START + LONG_PART_SPACING * index
}

/// 3,000 notes is 6,000 events, three times what a live store holds.
fn a_hosted_instrument_prints_a_part_longer_than_the_live_store_holds(format: Format) {
    const {
        assert!(2 * LONG_PART_NOTES > daw_engine::midi::note_store::MIDI_NOTE_STORE_CAPACITY);
    }
    let fx = InstalledFx::create(&format!("instrument-long-{format:?}"));
    let (state, _live) = state_with_live_instrument(&fx, format);
    let ui = RecordingUiThread::start();
    let notes = (0..LONG_PART_NOTES)
        .flat_map(|index| {
            let velocity = long_part_velocity(index);
            [
                note(long_part_on(index), 60, velocity, true),
                note(long_part_on(index) + LONG_PART_HELD, 60, velocity, false),
            ]
        })
        .collect();
    let frames = long_part_on(LONG_PART_NOTES) + 2_048;
    let commands = vec![strip("t1", json!([fx_device()])), schedule_notes(notes)];

    let print = render_frames(
        batch(commands),
        frames as u32,
        &state,
        &ui,
        &fx.seams(),
        None,
    )
    .expect("a part longer than the live store holds prints whole");

    let level = |index: usize| instrument_level(format, long_part_velocity(index));
    for index in [0, LONG_PART_NOTES / 2, LONG_PART_NOTES - 1] {
        let on = long_part_on(index);
        assert_eq!(print[on - 1], 0.0, "silent before note {index}");
        assert_eq!(
            print[on..on + LONG_PART_HELD],
            [level(index); LONG_PART_HELD],
            "note {index} held"
        );
        assert_eq!(print[on + LONG_PART_HELD], 0.0, "silent after note {index}");
    }
    let sounding = print.iter().filter(|sample| **sample != 0.0).count();
    assert_eq!(sounding, LONG_PART_NOTES * LONG_PART_HELD);
}

#[test]
fn a_clap_instrument_prints_a_part_longer_than_the_live_store_holds() {
    a_hosted_instrument_prints_a_part_longer_than_the_live_store_holds(Format::Clap);
}

#[test]
fn a_vst3_instrument_prints_a_part_longer_than_the_live_store_holds() {
    a_hosted_instrument_prints_a_part_longer_than_the_live_store_holds(Format::Vst3);
}

/// Two batches at one device that together pass the offline ceiling are
/// refused by name before an instance is built: each fits the per-batch
/// ceiling, so only the per-device total can refuse them.
#[test]
fn notes_past_the_offline_ceiling_across_batches_refuse_the_render_by_name() {
    const CEILING: usize = super::OFFLINE_NOTE_EVENT_CEILING;
    let fx = InstalledFx::create("instrument-ceiling");
    let (state, _live) = state_with_live_instrument(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let half = (0..CEILING / 2 + 1)
        .map(|index| note(index, 60, 100, true))
        .collect::<Vec<_>>();
    let commands = vec![
        strip("t1", json!([fx_device()])),
        schedule_notes(half.clone()),
        schedule_notes(half),
    ];

    let refusal = render(batch(commands), &state, &ui, &fx.seams(), None)
        .expect_err("a store past the offline ceiling is refused");

    assert!(
        refusal.contains(&format!("past the store's ceiling of {CEILING}")),
        "{refusal}"
    );
    assert_eq!(ui.tasks_run(), 0, "nothing was constructed");
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
            OfflineRenderHead::EngineFrameZero,
            &ui,
            state,
            &seams,
        ))
        .map_err(|refusal| refusal.to_string())
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

const SECOND_INSTANCE: &str = "fx-live-second";

/// A second engine-attached instance of the processing class, under its own
/// instance and engine plugin ids, and the device that names it.
fn attach_second_live_fx(fx: &InstalledFx, state: &AppState) -> Value {
    let format = Format::Clap;
    let descriptor = processing_class(format);
    state.engine_plugins.lock().expect("engine plugins").insert(
        SECOND_INSTANCE.to_string(),
        EnginePluginInstanceData {
            engine_plugin_id: ENGINE_PLUGIN_ID + 7,
            runtime: Arc::new(SharedHostedPlugin::new(live_runtime(
                fx,
                format,
                &descriptor,
            ))),
            name: "Sourdaw Harness Fx".to_string(),
            parameters: Vec::new(),
            has_gui: false,
            chain_kind: DeviceKind::Effect,
            parameter_events: None,
            load_resolution: fx.load_resolution(format, &descriptor),
        },
    );
    json!({ "id": "d-fx-second", "name": "Harness Fx", "type": "plugin", "bypassed": false,
            "parameterValues": {}, "externalPluginId": "com.sourdaw.harness-fx",
            "externalInstanceId": SECOND_INSTANCE })
}

/// A cancel that lands after the mapping, before any instance is constructed,
/// stops the build there: nothing is constructed for a render nobody wants.
#[test]
fn a_cancel_after_the_mapping_constructs_no_instance() {
    let fx = InstalledFx::create("cancel-before-construct");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    seams.after_mapping = Some(Box::new(|state: &AppState| {
        cancel_graph_offline("render-mapped".to_string(), state).expect("the cancel lands");
    }));

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        Some("render-mapped"),
    )
    .expect_err("the render was cancelled before it built anything");

    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(ui.tasks_run(), 0, "no instance was constructed");
}

/// A cancel that lands while the build is under way stops it before the next
/// restore and the next construction: the instance already built is released
/// on the UI thread and no further one is constructed.
#[test]
fn a_cancel_while_building_constructs_no_further_instance() {
    let fx = InstalledFx::create("cancel-while-building");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let second_fx_device = attach_second_live_fx(&fx, &state);
    let ui = RecordingUiThread::start();
    let (restoring, restore_reached) = mpsc::channel::<()>();
    let (release_restore, restore_released) = mpsc::channel::<()>();
    let first_restore = Mutex::new(Some((restoring, restore_released)));
    let mut seams = fx.seams();
    seams.before_restore = Some(Box::new(move || {
        let Some((restoring, restore_released)) = first_restore.lock().expect("first").take()
        else {
            return;
        };
        restoring.send(()).expect("the test is watching the build");
        restore_released
            .recv_timeout(Duration::from_secs(10))
            .expect("the test releases the restore");
    }));

    let outcome = thread::scope(|scope| {
        let building = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device(), second_fx_device]))),
                &state,
                &ui,
                &seams,
                Some("render-building"),
            )
        });
        restore_reached
            .recv_timeout(Duration::from_secs(10))
            .expect("the build constructs its first instance");
        cancel_graph_offline("render-building".to_string(), &state).expect("the cancel lands");
        release_restore.send(()).expect("the build is waiting");
        building.join().expect("the build thread returns")
    });

    let refusal = outcome.expect_err("a render cancelled while building returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(
        ui.tasks_run(),
        2,
        "the first instance's construction and release ran; nothing further was built"
    );
    assert!(state
        .retired_engine_plugins
        .lock()
        .expect("retired")
        .is_empty());
}

/// A cancel that lands while the build waits its turn on the runtime gate,
/// behind an exclusive holder, is read once the gate is taken: nothing is
/// constructed for it. The seam runs after the check ahead of the wait, so
/// only a read behind the gate can see this cancel.
#[test]
fn a_cancel_while_the_build_waits_on_the_runtime_gate_constructs_no_instance() {
    let fx = InstalledFx::create("cancel-at-gate");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let gate_hold = crate::commands::plugins::hold_plugin_runtime_gate_exclusively();
    let (waiting, wait_reached) = mpsc::channel::<()>();
    let waiting = Mutex::new(waiting);
    let mut seams = fx.seams();
    seams.before_runtime_gate = Some(Box::new(move || {
        waiting
            .lock()
            .expect("waiting")
            .send(())
            .expect("the test is watching the gate");
    }));

    let outcome = thread::scope(|scope| {
        let building = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                Some("render-gated"),
            )
        });
        wait_reached
            .recv_timeout(Duration::from_secs(10))
            .expect("the build reaches the runtime gate");
        cancel_graph_offline("render-gated".to_string(), &state).expect("the cancel lands");
        drop(gate_hold);
        building.join().expect("the build thread returns")
    });

    let refusal = outcome.expect_err("a render cancelled at the gate returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(ui.tasks_run(), 0, "no instance was constructed");
}

/// A UI thread whose queue the test pumps itself, as the shell's loop does:
/// a task posted from a worker waits there, unrun, until the test drains it.
struct PumpedUiThread {
    posted: crate::host::ui_thread::PostedUiThread,
    announce_post: Mutex<mpsc::Sender<()>>,
}

impl UiThread for PumpedUiThread {
    fn is_ui_thread(&self) -> bool {
        false
    }

    fn run_on_ui_thread(
        &self,
        task: &Arc<UiThreadTask>,
    ) -> Result<(), crate::host::ui_thread::UiThreadError> {
        self.posted.post_and_wait(task, || {
            self.announce_post
                .lock()
                .expect("announce")
                .send(())
                .expect("the test is watching the queue");
            Ok(())
        })
    }
}

/// Constructions the counting seam was asked for. A process static, because
/// the construct seam is a plain function; only one test reads it.
static COUNTED_CONSTRUCTIONS: AtomicUsize = AtomicUsize::new(0);

fn count_then_construct(
    backend: crate::commands::plugins::HostBackend,
    path: &str,
    descriptor_id: &str,
    sample_rate: f64,
    mode: ProcessMode,
) -> Result<HostedRuntime, daw_plugin_host::PluginError> {
    COUNTED_CONSTRUCTIONS.fetch_add(1, Ordering::SeqCst);
    create_hosted_runtime(backend, path, descriptor_id, sample_rate, mode)
}

/// A construction posted to the UI thread before quit cancels the render, and
/// run only after, opens no plugin: the hop reads the cancel itself, because
/// the hop's deadline bounds only the wait for the UI thread to start it.
#[test]
fn a_construction_posted_before_quit_and_run_after_it_opens_no_plugin() {
    let fx = InstalledFx::create("cancel-posted-construction");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let (announce_post, post_announced) = mpsc::channel();
    let ui = PumpedUiThread {
        posted: crate::host::ui_thread::PostedUiThread::new(Duration::from_secs(10)),
        announce_post: Mutex::new(announce_post),
    };
    COUNTED_CONSTRUCTIONS.store(0, Ordering::SeqCst);
    let mut seams = fx.seams();
    seams.construct = count_then_construct;

    let outcome = thread::scope(|scope| {
        let building = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                Some("render-posted"),
            )
        });
        post_announced
            .recv_timeout(Duration::from_secs(10))
            .expect("the build posts its construction");
        cancel_every_offline_render(&state);
        ui.posted.drain();
        building.join().expect("the build thread returns")
    });

    let refusal = outcome.expect_err("a render cancelled at quit returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(
        COUNTED_CONSTRUCTIONS.load(Ordering::SeqCst),
        0,
        "the plugin was not opened"
    );
}

/// A cancel that lands between the last live state read and the first
/// construction stops the build before it waits on the runtime gate: with the
/// gate held, only the read ahead of the wait can end the render.
#[test]
fn a_cancel_between_the_capture_and_the_first_construction_runs_no_ui_task() {
    let fx = InstalledFx::create("cancel-before-first-construction");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    seams.capture_state = capture_then_cancel_the_render;
    let gate_hold = crate::commands::plugins::hold_plugin_runtime_gate_exclusively();
    let (finished, outcome) = mpsc::channel();

    thread::scope(|scope| {
        scope.spawn(|| {
            let _ = finished.send(render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                Some(CAPTURE_CANCELLED_RENDER),
            ));
        });
        let answered = outcome.recv_timeout(Duration::from_secs(5));
        drop(gate_hold);
        let refusal = answered
            .expect("the render ended while the runtime gate was still held")
            .expect_err("a render cancelled before its first construction returns no print");
        assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    });

    assert_eq!(ui.tasks_run(), 0, "no UI-thread task ran");
}

/// Set by [`enter_then_read_live_state`] once the capture is under way.
static CAPTURE_ENTERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn enter_then_read_live_state(
    runtime: &SharedHostedPlugin,
    state: &AppState,
    render_control: &OfflineRenderControl,
) -> Result<Vec<u8>, PluginCommandError> {
    CAPTURE_ENTERED.store(true, Ordering::SeqCst);
    read_live_state(runtime, state, render_control)
}

/// A capture waiting on the live instance's held control gate ends once the
/// render is cancelled, instead of waiting out the control timeout.
#[test]
fn a_cancel_cuts_short_a_live_state_capture_waiting_on_a_held_control_gate() {
    const HELD_FOR: Duration = Duration::from_secs(10);
    const CUT_SHORT_WITHIN: Duration = Duration::from_millis(500);
    let fx = InstalledFx::create("cancel-held-gate");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    CAPTURE_ENTERED.store(false, Ordering::SeqCst);
    let mut seams = fx.seams();
    seams.capture_state = enter_then_read_live_state;
    let (holding, hold_reached) = mpsc::channel::<()>();
    let (release_hold, hold_released) = mpsc::channel::<()>();

    let (outcome, cut_short_in) = thread::scope(|scope| {
        let held = &live;
        scope.spawn(move || {
            held.with_control(OFFLINE_CONTROL_TIMEOUT, |_| {
                holding.send(()).expect("the test is watching the hold");
                let _ = hold_released.recv_timeout(HELD_FOR);
                Ok::<_, std::convert::Infallible>(())
            })
            .expect("the hold runs");
        });
        hold_reached
            .recv_timeout(Duration::from_secs(10))
            .expect("the live control gate is held");
        let rendering = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                Some("render-held-gate"),
            )
        });
        while !CAPTURE_ENTERED.load(Ordering::SeqCst) {
            assert!(!rendering.is_finished(), "the render ended before capture");
            thread::yield_now();
        }
        cancel_graph_offline("render-held-gate".to_string(), &state).expect("the cancel lands");
        let cancelled_at = std::time::Instant::now();
        let outcome = rendering.join().expect("the render thread returns");
        let cut_short_in = cancelled_at.elapsed();
        release_hold.send(()).expect("the hold is waiting");
        (outcome, cut_short_in)
    });

    let refusal = outcome.expect_err("a render cancelled while capturing returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert!(
        cut_short_in < CUT_SHORT_WITHIN,
        "the cancel ended the wait on the held gate: {cut_short_in:?}"
    );
    assert_eq!(ui.tasks_run(), 0, "no instance was constructed");
}

/// Hold `runtime`'s control gate on a thread of its own until `release` is
/// sent or `at_most` passes; returns once the gate is held.
fn hold_control_gate<'scope>(
    scope: &'scope thread::Scope<'scope, '_>,
    runtime: &'scope SharedHostedPlugin,
    at_most: Duration,
) -> mpsc::Sender<()> {
    let (holding, hold_reached) = mpsc::channel::<()>();
    let (release, released) = mpsc::channel::<()>();
    scope.spawn(move || {
        let _ = runtime.with_control(OFFLINE_CONTROL_TIMEOUT, |_| {
            holding.send(()).expect("the test is watching the hold");
            let _ = released.recv_timeout(at_most);
            Ok::<_, std::convert::Infallible>(())
        });
    });
    hold_reached
        .recv_timeout(Duration::from_secs(10))
        .expect("the live control gate is held");
    release
}

/// A capture nobody cancelled waits the live instance's own gate deadline, as
/// a state save does, so an export started behind a gate held for longer than
/// the offline control timeout still prints.
#[test]
fn an_uncancelled_capture_waits_out_a_gate_held_past_the_offline_control_timeout() {
    let fx = InstalledFx::create("held-gate-print");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let seams = fx.seams();

    let printed = thread::scope(|scope| {
        let release = hold_control_gate(scope, &live, Duration::from_secs(3));
        let printed = render(
            batch(impulse_track(json!([fx_device()]))),
            &state,
            &ui,
            &seams,
            Some("render-held-print"),
        );
        let _ = release.send(());
        printed
    });

    printed.expect("the render waited out the hold and printed");
}

/// A capture that outwaits the live instance's own gate deadline gives the
/// state save's verdict: the render is refused as unresponsive and the live
/// instance is marked, which a try-lock capture would never do.
#[test]
fn a_capture_behind_a_gate_held_past_its_deadline_marks_the_live_instance_unresponsive() {
    let fx = InstalledFx::create("held-gate-verdict");
    let (state, _first) = state_with_live_fx(&fx, Format::Clap);
    let descriptor = processing_class(Format::Clap);
    let live = Arc::new(
        SharedHostedPlugin::new(live_runtime(&fx, Format::Clap, &descriptor))
            .with_control_gate_deadline(Duration::from_millis(150)),
    );
    record_engine_instance(
        &state,
        Arc::clone(&live),
        fx.load_resolution(Format::Clap, &descriptor),
        DeviceKind::Effect,
        ENGINE_PLUGIN_ID,
    );
    let ui = RecordingUiThread::start();
    let seams = fx.seams();

    thread::scope(|scope| {
        let release = hold_control_gate(scope, &live, Duration::from_secs(10));
        let refusal = render(
            batch(impulse_track(json!([fx_device()]))),
            &state,
            &ui,
            &seams,
            Some("render-held-verdict"),
        )
        .expect_err("a gate held past its deadline refuses the render");
        let later = live.try_with_control(Duration::from_millis(10), |_| {
            Ok::<_, std::convert::Infallible>(())
        });
        let _ = release.send(());

        assert!(refusal.contains("plugin-unresponsive:"), "{refusal}");
        assert!(
            matches!(
                later,
                Err(crate::host::native_bridge::PluginControlError::Refused(
                    PluginControlRefusal::Unresponsive { .. }
                ))
            ),
            "the live instance is marked unresponsive"
        );
    });
}

const UNACTIVATED_RENDER: &str = "render-unactivated";

/// The state the construct seam below cancels the render through. A process
/// static, because the construct seam is a plain function.
static CANCELLING_CONSTRUCTION: Mutex<Option<Arc<AppState>>> = Mutex::new(None);

/// Cancel the render, then hand back a runtime whose activation failed.
fn cancel_then_construct_an_unactivated_runtime(
    _backend: crate::commands::plugins::HostBackend,
    _path: &str,
    _descriptor_id: &str,
    _sample_rate: f64,
    _mode: ProcessMode,
) -> Result<HostedRuntime, daw_plugin_host::PluginError> {
    let state = CANCELLING_CONSTRUCTION
        .lock()
        .expect("state")
        .take()
        .expect("the test names the state to cancel through");
    cancel_graph_offline(UNACTIVATED_RENDER.to_string(), &state).expect("the cancel lands");
    let mut wrapper =
        ClapWrapper::new_engine_owned_command_fixture("unactivated", Vec::new(), false);
    wrapper.deactivate_engine_owned_command_fixture();
    Ok(wrapper.into())
}

/// A construction that finishes after the cancel, with a runtime that would
/// refuse the render as a failed activation, ends the render as cancelled:
/// a cancel is never reported as a plugin's failure.
#[test]
fn a_cancel_during_construction_wins_over_the_activation_refusal() {
    let fx = InstalledFx::create("cancel-then-unactivated");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let state = Arc::new(state);
    *CANCELLING_CONSTRUCTION.lock().expect("state") = Some(Arc::clone(&state));
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    seams.construct = cancel_then_construct_an_unactivated_runtime;

    let refusal = render(
        batch(impulse_track(json!([fx_device()]))),
        &state,
        &ui,
        &seams,
        Some(UNACTIVATED_RENDER),
    )
    .expect_err("a render cancelled during its construction returns no print");

    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
}

const CAPTURE_CANCELLED_RENDER: &str = "render-capturing";

/// Live state reads by [`capture_then_cancel_the_render`]. A process static,
/// because the capture seam is a plain function; only one test reads it.
static CANCELLING_CAPTURES: AtomicUsize = AtomicUsize::new(0);

/// Read the live state, then cancel the render reading it.
fn capture_then_cancel_the_render(
    runtime: &SharedHostedPlugin,
    state: &AppState,
    render_control: &OfflineRenderControl,
) -> Result<Vec<u8>, PluginCommandError> {
    CANCELLING_CAPTURES.fetch_add(1, Ordering::SeqCst);
    let chunk = read_live_state(runtime, state, render_control)?;
    cancel_graph_offline(CAPTURE_CANCELLED_RENDER.to_string(), state).expect("the cancel lands");
    Ok(chunk)
}

/// A cancel that lands while the live states are read stops the reads there:
/// no further live state is read, every live runtime the render took is given
/// back, and nothing is constructed.
#[test]
fn a_cancel_during_the_live_state_capture_reads_no_further_state_and_returns_every_runtime() {
    let fx = InstalledFx::create("cancel-while-capturing");
    let (state, live) = state_with_live_fx(&fx, Format::Clap);
    let second_fx_device = attach_second_live_fx(&fx, &state);
    let ui = RecordingUiThread::start();
    CANCELLING_CAPTURES.store(0, Ordering::SeqCst);
    let mut seams = fx.seams();
    seams.capture_state = capture_then_cancel_the_render;

    let refusal = render(
        batch(impulse_track(json!([fx_device(), second_fx_device]))),
        &state,
        &ui,
        &seams,
        Some(CAPTURE_CANCELLED_RENDER),
    )
    .expect_err("a render cancelled while capturing returns no print");

    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(
        CANCELLING_CAPTURES.load(Ordering::SeqCst),
        1,
        "the second instance's live state was not read"
    );
    assert_eq!(ui.tasks_run(), 0, "no instance was constructed");
    let engine_plugins = state.engine_plugins.lock().expect("engine plugins");
    assert_eq!(
        Arc::strong_count(&engine_plugins[INSTANCE].runtime),
        2,
        "the first runtime is held by its record and this test alone"
    );
    assert!(Arc::ptr_eq(&engine_plugins[INSTANCE].runtime, &live));
    assert_eq!(
        Arc::strong_count(&engine_plugins[SECOND_INSTANCE].runtime),
        1,
        "the second runtime is held by its record alone"
    );
    assert!(state
        .retired_engine_plugins
        .lock()
        .expect("retired")
        .is_empty());
}

/// A cancel that lands once the final instance is constructed, before its
/// state is restored, refuses the build there: the restore does not run, so
/// the build never reaches the look every restored instance gets.
#[test]
fn a_cancel_before_the_final_instances_restore_refuses_the_build_without_restoring_it() {
    let fx = InstalledFx::create("cancel-before-final-restore");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let (restoring, restore_reached) = mpsc::channel::<()>();
    let (release_restore, restore_released) = mpsc::channel::<()>();
    let restore_handshake = Mutex::new((restoring, restore_released));
    let restored_builds = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&restored_builds);
    let mut seams = fx.seams();
    seams.before_restore = Some(Box::new(move || {
        let (restoring, restore_released) = &*restore_handshake.lock().expect("handshake");
        restoring.send(()).expect("the test is watching the build");
        restore_released
            .recv_timeout(Duration::from_secs(10))
            .expect("the test releases the restore");
    }));
    seams.after_build = Some(Box::new(move |_: &[Arc<SharedHostedPlugin>]| {
        counted.fetch_add(1, Ordering::SeqCst);
    }));

    let outcome = thread::scope(|scope| {
        let building = scope.spawn(|| {
            render(
                batch(impulse_track(json!([fx_device()]))),
                &state,
                &ui,
                &seams,
                Some("render-final-restore"),
            )
        });
        restore_reached
            .recv_timeout(Duration::from_secs(10))
            .expect("the build constructs its only instance");
        cancel_graph_offline("render-final-restore".to_string(), &state).expect("the cancel lands");
        release_restore.send(()).expect("the build is waiting");
        building.join().expect("the build thread returns")
    });

    let refusal =
        outcome.expect_err("a render cancelled before its final restore returns no print");
    assert!(refusal.starts_with(OFFLINE_RENDER_CANCELLED), "{refusal}");
    assert_eq!(
        restored_builds.load(Ordering::SeqCst),
        0,
        "the build stopped before restoring its final instance"
    );
    assert_eq!(
        ui.tasks_run(),
        2,
        "the instance's construction and release ran"
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
    seams.capture_state = |_, _, _| {
        Err(PluginCommandError::Control(
            PluginControlRefusal::TimedOut {
                plugin: "a refused rate reads no live state".to_string(),
            },
        ))
    };
    let render_at = |devices: Value, sample_rate: f64| {
        block_on_test(render_graph_offline_with(
            batch(impulse_track(devices)),
            1_024,
            sample_rate,
            None,
            OfflineRenderHead::EngineFrameZero,
            &ui,
            &state,
            &seams,
        ))
        .map_err(|refusal| refusal.to_string())
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

// ── (e2) Admission ──────────────────────────────────────────────────────

/// The seams of a render that holds its slot until `release` sends, after
/// announcing on `admitted` that it holds one.
fn holding_its_slot(
    fx: &InstalledFx,
    admitted: mpsc::Sender<()>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
) -> OfflinePluginSeams {
    let mut seams = fx.seams();
    let admitted = Mutex::new(admitted);
    seams.after_admission = Some(Box::new(move || {
        admitted
            .lock()
            .expect("admitted")
            .send(())
            .expect("the test is watching admission");
        release
            .lock()
            .expect("release")
            .recv_timeout(Duration::from_secs(10))
            .expect("the test releases the slot");
    }));
    seams
}

/// Renders in flight are bounded, the ones nobody can cancel included: past
/// the limit a render is refused by name before it maps or builds anything,
/// and a slot given back admits the next one.
#[test]
fn a_render_past_the_in_flight_limit_is_refused_by_name_until_a_slot_is_released() {
    let fx = InstalledFx::create("admission-limit");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let (admitted, admissions) = mpsc::channel();
    let (release_unnamed, unnamed_released) = mpsc::channel();
    let (release_named, named_released) = mpsc::channel();
    let holding_unnamed = holding_its_slot(
        &fx,
        admitted.clone(),
        Arc::new(Mutex::new(unnamed_released)),
    );
    let holding_named = holding_its_slot(&fx, admitted, Arc::new(Mutex::new(named_released)));
    let plain = fx.seams();
    let with_the_fx = || batch(impulse_track(json!([fx_device()])));
    let built_in_only = || batch(impulse_track(json!([])));

    thread::scope(|scope| {
        let unnamed = scope.spawn(|| render(built_in_only(), &state, &ui, &holding_unnamed, None));
        let named =
            scope.spawn(|| render(built_in_only(), &state, &ui, &holding_named, Some("held")));
        for _ in 0..MAX_OFFLINE_RENDERS_IN_FLIGHT {
            admissions
                .recv_timeout(Duration::from_secs(10))
                .expect("each held render is admitted");
        }

        let refusal = render(with_the_fx(), &state, &ui, &plain, Some("over"))
            .map(|print| print.len())
            .expect_err("a render past the limit is refused");
        assert!(
            refusal.starts_with(OFFLINE_RENDER_LIMIT_REACHED),
            "{refusal}"
        );
        assert_eq!(ui.tasks_run(), 0, "the refused render built nothing");
        assert!(
            state
                .offline_renders
                .lock()
                .expect("renders")
                .in_flight("over")
                .is_none(),
            "a refused render is not registered"
        );

        release_unnamed
            .send(())
            .expect("the unnamed render is waiting");
        unnamed
            .join()
            .expect("the unnamed render returns")
            .expect("the unnamed render prints");
        render(with_the_fx(), &state, &ui, &plain, Some("after"))
            .expect("a released slot admits the next render");

        release_named.send(()).expect("the named render is waiting");
        named
            .join()
            .expect("the named render returns")
            .expect("the named render prints");
    });
}

/// Quit's first step cancels a hosted-effect render mid-flight, whatever its
/// caller named it, and returns once the render has released its offline
/// instance on the UI thread — well inside the stop budget.
#[test]
fn the_quit_step_cancels_an_offline_render_in_flight_and_returns_within_its_budget() {
    let fx = InstalledFx::create("quit-cancel");
    let (state, _live) = state_with_live_fx(&fx, Format::Clap);
    let ui = RecordingUiThread::start();
    let mut seams = fx.seams();
    let watch = OfflineInstanceWatch::default();
    seams.after_build = Some(watch.after_build(None));

    let (outcome, left_running, stopped_in, charged) = thread::scope(|scope| {
        let rendering = scope.spawn(|| {
            block_on_test(render_graph_offline_with(
                batch(impulse_track(json!([fx_device()]))),
                LONG_RENDER_FRAMES,
                EXPORT_RATE,
                Some("export-at-quit".to_string()),
                OfflineRenderHead::EngineFrameZero,
                &ui,
                &state,
                &seams,
            ))
        });
        // The observable: the render is registered and has rendered a block.
        loop {
            let started = state
                .offline_renders
                .lock()
                .expect("renders")
                .in_flight("export-at-quit")
                .is_some_and(|control| control.rendered_frames() > 0);
            if started {
                break;
            }
            assert!(
                !rendering.is_finished(),
                "the render ended before quit cancelled it"
            );
            thread::yield_now();
        }
        let mut charged = Duration::ZERO;
        let started = std::time::Instant::now();
        let left_running = crate::shutdown::stop_offline_renders(&state, &ui, &mut |poll| {
            thread::sleep(poll);
            charged += poll;
            poll
        });
        let stopped_in = started.elapsed();
        let outcome = rendering.join().expect("the render thread returns");
        (outcome, left_running, stopped_in, charged)
    });

    let refusal = outcome
        .map(|bytes| bytes.len())
        .expect_err("a render cancelled at quit returns no print");
    assert!(
        refusal.to_string().starts_with(OFFLINE_RENDER_CANCELLED),
        "{refusal}"
    );
    assert_eq!(left_running, 0, "the render gave its slot back");
    assert!(
        charged < crate::shutdown::OFFLINE_RENDER_STOP_BUDGET,
        "the step stopped waiting before its budget ran out: {charged:?}"
    );
    assert!(
        stopped_in < crate::shutdown::SHELL_FORCE_EXIT_DEADLINE,
        "the step returned inside the shell's force-exit deadline: {stopped_in:?}"
    );
    watch.assert_every_instance_left_processing();
    watch.assert_every_instance_torn_down_on(&ui);
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
