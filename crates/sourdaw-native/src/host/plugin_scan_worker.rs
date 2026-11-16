use daw_plugin_host::scanner::{
    extract_clap_instance_metadata, extract_clap_metadata, ClapDescriptorMetadata, PluginFormat,
    ScannedDescriptor, ScannedInstance,
};
use daw_plugin_host::vst3_scanner::{extract_vst3_instance_metadata, extract_vst3_metadata};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
pub const WORKER_ARGUMENT: &str = "--sourdaw-plugin-scan-worker";

/// The worker that creates a live CLAP instance and inspects it.
///
/// One instance answers everything discovery needs from a plugin that is not
/// merely a descriptor — its parameter contract, its declared audio ports, and
/// whether it has an editor. Adding a query does not add a process: the
/// isolation shape is unchanged, still one bounded child per plugin whose crash
/// or hang is the supervisor's problem and not the app's.
pub const INSTANCE_WORKER_ARGUMENT: &str = "--sourdaw-plugin-instance-scan-worker";
/// The whole time one candidate's helper is allowed to run, whichever pass
/// spawned it.
///
/// `pub(crate)` because the scan walk hands every candidate exactly this bound
/// (`commands::plugins`). A helper handed less is killed for the walk's clock
/// rather than its own, and the refusal it reports cannot be told apart from a
/// plugin that genuinely hangs — so the two bounds have to be the same value.
///
/// Ten seconds because a large sampled instrument legitimately needs more than
/// a couple of them to load its entry point and answer: killing it earlier
/// quarantines a working plugin for being big, and quarantine is a record the
/// user has to clear by hand. A plugin that is genuinely wedged is still
/// bounded — this decides how long a scan waits before saying so, not whether
/// it ever does.
pub(crate) const WORKER_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a leaf worker may live by its own clock, whoever spawned it.
///
/// Above [`WORKER_TIMEOUT`] — the longest bound any spawner gives a helper —
/// so a live spawner's process-group kill always fires first and its
/// [`ScanFailure::TimedOut`] is what quarantine sees. This deadline only
/// decides anything when no spawner is left to fire: a helper whose spawner
/// died without killing it must not spin in a plugin's constructor forever.
const HELPER_DEADLINE: Duration = Duration::from_secs(WORKER_TIMEOUT.as_secs() + 2);

/// The helper's exit code when its own [`HELPER_DEADLINE`] terminated it.
///
/// Distinct from 0, from the generic 2 and from
/// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] so that, whenever a spawner does
/// observe it, it reads as what it is: a process failure of a helper the
/// plugin kept from finishing, never a clean answer or the helper's own
/// write refusal. A Unix helper that leads its process group may end by its
/// group kill instead (see [`terminate_current_process`]), which a spawner
/// classifies the same way.
const HELPER_DEADLINE_EXIT_CODE: i32 = 4;

/// The helper's exit code when it found the process that spawned it gone.
/// Distinct from [`HELPER_DEADLINE_EXIT_CODE`] for the same reason that one
/// is distinct from the rest: which tie ended the helper is a different
/// story, and neither may be mistaken for a self-diagnosed refusal.
const HELPER_PARENT_GONE_EXIT_CODE: i32 = 5;

/// Env var a spawner sets to its own process id for the helper's parent
/// watch. It names the helper's direct parent, so a launcher that forks
/// rather than execs the helper would read as a parent that is already gone.
pub const SCAN_PARENT_PID_ENV: &str = "SOURDAW_PLUGIN_SCAN_PARENT_PID";

const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_millis(50);
/// The largest response a leaf worker may write and the supervisor will read.
///
/// Sized from measurement, and the measurement is enforced rather than trusted:
/// `the_response_limit_admits_the_stated_worst_case_parameter_list` serializes
/// a parameter list at `MAX_RESPONSE_PARAMETERS`, every descriptor maximal (a
/// 128-byte name beside a 128-byte module — the scanner's own text caps — plus
/// a full-width id, three full-width floats and four booleans), and fails the
/// moment the compact JSON outgrows this bound or loses its headroom.
///
/// The former 256 KiB cap was sized for the CLAP world, where the scanner
/// bounds its own parameter walks (at most 256 descriptors carrying at most
/// 32 KiB of name text), so no instance response could come near it. VST3's
/// parameter walk is bounded by nothing but the plugin's own parameter count,
/// and a large instrument answers in full — so the old cap refused the whole
/// response, the helper exited 3, and the plugin's registry row was stored as
/// if it had never answered (#3866).
///
/// The supervisor's read is `take(MAX_RESPONSE_BYTES + 1)`, so its buffering
/// is this constant and nothing more. The worker child collects the parameter
/// list before any serialization; that cost is the scanner's shape, unchanged
/// by this bound.
const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;

/// The parameter-count policy behind [`MAX_RESPONSE_BYTES`], stated here
/// because the scanner does not bound the count for every format: 16,384
/// descriptors is beyond any known instrument, including modular-scale hosts
/// that expose thousands. At the enforced measurement
/// (`the_response_limit_admits_the_stated_worst_case_parameter_list`) that
/// list serializes to 7,542,027 bytes compact, and the byte cap is the
/// smallest power of two that keeps at least twofold headroom above it.
#[cfg(test)]
const MAX_RESPONSE_PARAMETERS: usize = 16_384;

/// The refusal for a response whose compact serialization measures past
/// [`MAX_RESPONSE_BYTES`], as the message the leaf writes. Both sides of the
/// process boundary use it: the leaf refuses to write such a response, and the
/// supervisor refuses to read one ([`ScanFailure::ResponseOverLimit`]).
fn oversized_response_error(bytes: usize) -> String {
    ScanFailure::ResponseOverLimit { bytes }.to_string()
}

/// Why a scan through the bounded helper failed, as the supervisor sees it.
///
/// The variants are the failure kinds the supervisor treats differently:
/// [`ScanFailure::is_process_failure`] decides crash quarantine and
/// [`ScanFailure::is_response_limit_refusal`] decides which reason a row
/// carries. `Display` is the message the registry and the renderer receive, so
/// its text is a contract — rewording one needs a grep of `src/` and
/// `electron/` first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanFailure {
    /// The helper child exited with a non-zero status other than
    /// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`].
    ExitedUnsuccessfully { path: PathBuf },
    /// The helper child ran past its bound and was killed.
    TimedOut,
    /// The helper exited cleanly but left something other than a regular file
    /// at its response path. Fixed text and the plugin path only: it is stored
    /// as a quarantine reason, so it never carries plugin-originated bytes or
    /// OS error text.
    ResponseTampered { path: PathBuf },
    /// The response measured past [`MAX_RESPONSE_BYTES`].
    ResponseOverLimit { bytes: usize },
    /// The helper self-reported that it could not write its response; see
    /// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`].
    ResponseWriteRefused { path: PathBuf },
    /// Any other refusal: the read failed, not the plugin's process, so it is
    /// never quarantine evidence.
    Refused(String),
}

impl ScanFailure {
    /// Whether this is the process-level failure crash quarantine exists to
    /// catch: the helper child exited unsuccessfully, ran past its bound and
    /// was killed, or left a response that is not a regular file.
    ///
    /// The helper itself only ever writes a regular file, so a FIFO, symlink,
    /// device or reparse point at the response path is the plugin's own code
    /// tampering with the helper's output — as much evidence against the
    /// binary as a crash.
    ///
    /// Distinct from a data-level refusal — a malformed response, an
    /// oversized payload, an unregistered format — which says the *read*
    /// failed, not that the binary itself is dangerous to keep re-running.
    /// Only a process failure is evidence worth quarantining a binary over
    /// (#2911).
    pub fn is_process_failure(&self) -> bool {
        matches!(
            self,
            Self::ExitedUnsuccessfully { .. } | Self::ResponseTampered { .. } | Self::TimedOut
        )
    }

    /// Whether this is the helper's own response limit rather than anything
    /// the plugin did — an oversized response, or any other failure to write
    /// one.
    pub fn is_response_limit_refusal(&self) -> bool {
        matches!(
            self,
            Self::ResponseOverLimit { .. } | Self::ResponseWriteRefused { .. }
        )
    }
}

impl std::fmt::Display for ScanFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ExitedUnsuccessfully { path } => write!(
                formatter,
                "Plugin scan helper exited unsuccessfully for {}",
                path.display()
            ),
            Self::TimedOut => formatter.write_str("Plugin scan helper timed out"),
            Self::ResponseTampered { path } => write!(
                formatter,
                "Plugin scan helper response was not a regular file for {}",
                path.display()
            ),
            Self::ResponseOverLimit { bytes } => write!(
                formatter,
                "Plugin scan helper response of {bytes} bytes exceeded the scan helper's {MAX_RESPONSE_BYTES}-byte limit"
            ),
            Self::ResponseWriteRefused { path } => write!(
                formatter,
                "Plugin scan helper could not write its response for {}; the scan helper's response limit is {MAX_RESPONSE_BYTES} bytes",
                path.display()
            ),
            Self::Refused(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ScanFailure {}

/// The leaf worker's exit code for a self-diagnosed refusal to write its
/// response — a malformed payload, the response exceeding
/// [`MAX_RESPONSE_BYTES`], or the response file itself failing to write.
///
/// Distinct from the generic non-zero exit ([`WorkerRole::Malformed`], no
/// backend for the format) on purpose: those and a crashing plugin all share
/// exit code 2 and are indistinguishable from here, which is fine because
/// every one of them is either a genuine process failure or a caller error
/// that never reaches a real plugin. A response-write refusal is neither — it
/// can fire for every candidate in one scan on a systemic fault (a full disk,
/// a read-only temp directory) that has nothing to do with any plugin being
/// dangerous, and folding it into the same exit code as a crash would
/// quarantine every binary the process ever touched. See
/// [`process_failure`], which is what keeps it out of
/// [`ScanFailure::is_process_failure`].
///
/// The inverse residual is accepted, not closed: a plugin whose own static
/// initializer happens to call `exit(3)` reads as a self-diagnosed write
/// refusal and escapes quarantine. That plugin still costs no more than one
/// bounded spawn per scan — nothing near the deadline-exhausting repeat
/// spawns an unquarantined *hang* would cost — because a plugin that hangs
/// instead is still caught by `wait_bounded`'s timeout, which classifies
/// entirely on elapsed time and never looks at an exit code at all.
const RESPONSE_WRITE_REFUSAL_EXIT_CODE: i32 = 3;

/// Env var a host sets to describe how a leaf worker process is launched.
///
/// The default — re-executing this process — holds only where the executable
/// scans its own arguments on startup. A host whose executable is a runtime
/// rather than the application (it is handed a script, and would treat a bare
/// `--sourdaw-plugin-scan-worker` as an unknown option) has to say how to get
/// back into worker mode, and this is where it says it.
///
/// The value is a JSON object, deliberately transport- and shell-agnostic:
///
/// ```json
/// { "program": "…", "args": ["…"], "env": { "…": "…" } }
/// ```
///
/// `args` is prepended to the worker arguments and `env` is added to the child's
/// environment. Nothing about the policy moves: the child is still bounded, still
/// killed as a process group at the deadline, and still the only process that
/// loads a plugin entry point.
pub const SCAN_WORKER_COMMAND_ENV: &str = "SOURDAW_PLUGIN_SCAN_WORKER_COMMAND";

/// How a leaf worker process is launched. See [`SCAN_WORKER_COMMAND_ENV`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanWorkerCommand {
    /// `PathBuf` and `String`, not `OsString`: serde renders an `OsString` as a
    /// tagged byte enum rather than a plain JSON string, so a host writing the
    /// obvious `"program": "/path"` would fail to parse.
    pub program: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

impl ScanWorkerCommand {
    /// Re-execute this process: the application binary scans its own argv.
    fn from_current_exe() -> Result<Self, String> {
        Ok(Self {
            program: std::env::current_exe().map_err(|error| {
                format!("Cannot resolve plugin scan helper executable: {error}")
            })?,
            args: Vec::new(),
            env: BTreeMap::new(),
        })
    }

    /// Parse a host's declaration.
    ///
    /// An unparseable or empty declaration is an error rather than a silent
    /// fallback to re-execution: falling back would launch the wrong program for
    /// every plugin on the machine and report each one as a scan failure, which
    /// reads to a user as "this system has no working plugins" instead of "this
    /// setting is wrong".
    fn from_json(declared: &str) -> Result<Self, String> {
        let command: Self = serde_json::from_str(declared).map_err(|error| {
            format!("{SCAN_WORKER_COMMAND_ENV} is not a valid command: {error}")
        })?;
        if command.program.as_os_str().is_empty() {
            return Err(format!("{SCAN_WORKER_COMMAND_ENV} names no program"));
        }
        Ok(command)
    }

    /// Read the host's declaration, or fall back to re-execution.
    fn resolve() -> Result<Self, String> {
        let Some(declared) = std::env::var_os(SCAN_WORKER_COMMAND_ENV) else {
            return Self::from_current_exe();
        };
        let declared = declared
            .to_str()
            .ok_or_else(|| format!("{SCAN_WORKER_COMMAND_ENV} is not valid UTF-8"))?;
        Self::from_json(declared)
    }
}
#[derive(Serialize, Deserialize)]
struct WorkerResponse<T> {
    worker_pid: u32,
    result: Result<T, String>,
}
struct ResponseDirectory(PathBuf);
#[test]
fn scoped_scan_response_directory() {
    crate::host::runtime_scope::RuntimeScope::test_in_process(
        concat!(module_path!(), "::scoped_scan_response_directory"),
        |root| {
            let directory = ResponseDirectory::create().unwrap();
            let path = directory.0.clone();
            assert_eq!(
                path.parent().unwrap(),
                root.join("native/data/private/scan-responses")
            );
            assert!(path.is_dir());
            drop(directory);
            assert!(!path.exists());
        },
    );
}
#[test]
fn a_refused_scope_creates_no_scan_response_directory() {
    crate::host::runtime_scope::RuntimeScope::test_in_refused_process(
        concat!(
            module_path!(),
            "::a_refused_scope_creates_no_scan_response_directory"
        ),
        || assert!(ResponseDirectory::create().is_err()),
    );
}
impl ResponseDirectory {
    fn create() -> Result<Self, String> {
        let parent =
            crate::host::runtime_scope::RuntimeScope::path("native/data/private/scan-responses")?
                .unwrap_or_else(std::env::temp_dir);
        let path = parent.join(format!("sourdaw-plugin-scan-{}", uuid::Uuid::new_v4()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&path)
            .map_err(|error| format!("Cannot create plugin scan response directory: {error}"))?;
        Ok(Self(path))
    }
}
impl Drop for ResponseDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
/// The bounded child's entries for one plugin format.
///
/// The registry is the format dispatch, and it is the only thing a new format
/// adds to this file: both entries produce the scan's format-neutral types, so
/// the worker protocol, the response envelope, and the isolation shape around
/// them are already written in terms every format shares.
struct FormatScanBackend {
    /// Read every plugin descriptor the file declares — one bundle may hold
    /// several. No instance is created.
    descriptor: fn(&Path) -> Result<Vec<ScannedDescriptor>, String>,
    /// Create one live-but-unactivated instance of the plugin `plugin_id`
    /// names in the file, and read its parameter contract and capability
    /// extensions.
    instance: fn(&Path, plugin_id: &str) -> Result<ScannedInstance, String>,
}

/// The registered scan backend for a format, or `None` when Sourdaw has none.
///
/// A format with no backend is never scanned — the walk refuses it by name
/// before a candidate exists — so reaching here with one is a caller error, and
/// both sides of the protocol refuse rather than guess.
///
/// This registry and [`PluginFormat::scan_support`] answer the same question
/// from two places, and `the_two_scan_registries_agree` is what keeps them from
/// disagreeing.
fn scan_backend(format: PluginFormat) -> Option<FormatScanBackend> {
    match format {
        PluginFormat::Clap => Some(FormatScanBackend {
            descriptor: |path| {
                // One CLAP bundle may declare many plugins; each row keeps the
                // descriptor id the instance pass will be asked to instantiate.
                extract_clap_metadata(path).map(|bundle| {
                    bundle
                        .into_iter()
                        .map(ClapDescriptorMetadata::into_scanned_descriptor)
                        .collect()
                })
            },
            instance: extract_clap_instance_metadata,
        }),
        PluginFormat::Vst3 => Some(FormatScanBackend {
            descriptor: |path| {
                extract_vst3_metadata(path).map(|metadata| vec![metadata.into_scanned_descriptor()])
            },
            // VST3's extractor resolves its own class from the bundle, so the
            // selector adds nothing there — and its descriptor pass declares
            // exactly one row, so only one instance is ever asked for.
            instance: |path, _plugin_id| extract_vst3_instance_metadata(path),
        }),
        PluginFormat::Vst2 | PluginFormat::AudioUnit => None,
    }
}

fn no_scan_backend(format: PluginFormat) -> String {
    format!("No plugin scan backend for format {}", format.wire_name())
}

pub fn run_from_process_args() -> Option<i32> {
    run_from_args(std::env::args_os())
}
/// What a set of process arguments asks this process to be.
#[derive(Debug, PartialEq, Eq)]
enum WorkerRole<'args> {
    /// Extract one plugin's descriptor, or one live instance's parameters and
    /// capabilities, into a response file. `plugin_id` names the bundle plugin
    /// an instance inspection instantiates; the descriptor pass has none.
    Extract {
        format: PluginFormat,
        plugin_id: Option<&'args str>,
        plugin_path: &'args OsString,
        response_path: &'args OsString,
    },
    /// The arguments name a worker but are not a usable invocation.
    Malformed,
}

/// Decide this process's role from its arguments.
///
/// The marker is *located* rather than required at a fixed index, because a host
/// that re-enters through a runtime puts its own arguments — a script path —
/// between the executable and ours (see [`SCAN_WORKER_COMMAND_ENV`]). Index 0 is
/// excluded from the search so an executable whose own path spells the marker
/// cannot claim the role.
///
/// Everything strict about the fixed-index form is kept: the marker must be
/// followed by exactly the arguments its role takes and nothing after them, so
/// an invocation with a stray extra argument is refused rather than
/// half-interpreted. The instance marker takes one argument more than the
/// descriptor marker: the id of the plugin in the bundle to instantiate.
///
/// The first of those arguments is the plugin's format. It is refused unless it
/// is UTF-8, names a format Sourdaw recognises, and that format has a registered
/// scan backend — a worker that guessed the format would load a plugin's entry
/// point through the wrong extractor, which is exactly the read this process
/// exists to contain. The instance marker's plugin id is UTF-8 for the same
/// reason: it becomes the CString handed to `create_plugin`, and an id the
/// worker could not decode is one it would be guessing about.
fn worker_role(args: &[OsString]) -> Option<WorkerRole<'_>> {
    let marker_index = args.iter().skip(1).position(|argument| {
        argument == std::ffi::OsStr::new(WORKER_ARGUMENT)
            || argument == std::ffi::OsStr::new(INSTANCE_WORKER_ARGUMENT)
    })? + 1;
    let inspects_instance = args[marker_index] == std::ffi::OsStr::new(INSTANCE_WORKER_ARGUMENT);
    // Format, path, the instance role's plugin id, then the response path.
    let plugin_id_index = if inspects_instance {
        Some(marker_index + 3)
    } else {
        None
    };
    let response_index = plugin_id_index.map_or(marker_index + 3, |index| index + 1);
    if args.len() != response_index + 1 {
        return Some(WorkerRole::Malformed);
    }
    let Some(format) = args[marker_index + 1]
        .to_str()
        .and_then(PluginFormat::from_wire_name)
        .filter(|format| scan_backend(*format).is_some())
    else {
        return Some(WorkerRole::Malformed);
    };
    let plugin_id = match plugin_id_index {
        Some(index) => match args[index].to_str() {
            Some(plugin_id) => Some(plugin_id),
            None => return Some(WorkerRole::Malformed),
        },
        None => None,
    };
    Some(WorkerRole::Extract {
        format,
        plugin_id,
        plugin_path: &args[marker_index + 2],
        response_path: &args[response_index],
    })
}

fn run_from_args(args: impl IntoIterator<Item = OsString>) -> Option<i32> {
    let args: Vec<OsString> = args.into_iter().collect();
    let (format, plugin_id, plugin_path, response_path) = match worker_role(&args)? {
        WorkerRole::Malformed => return Some(2),
        WorkerRole::Extract {
            format,
            plugin_id,
            plugin_path,
            response_path,
        } => (format, plugin_id, plugin_path, response_path),
    };
    // `worker_role` already refused a format with no backend, so this cannot be
    // `None` — but the dispatch reads from the registry rather than assuming
    // CLAP, which is the whole point of the argument.
    let Some(backend) = scan_backend(format) else {
        return Some(2);
    };
    arm_helper_watchdog(helper_deadline());
    let result = match plugin_id {
        Some(plugin_id) => write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: (backend.instance)(Path::new(plugin_path), plugin_id),
            },
        ),
        None => write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: (backend.descriptor)(Path::new(plugin_path)),
            },
        ),
    };
    Some(if result.is_ok() {
        0
    } else {
        RESPONSE_WRITE_REFUSAL_EXIT_CODE
    })
}
/// What the helper's watchdog does after one look at its clock and its parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchdogVerdict {
    KeepWaiting,
    Terminate(i32),
}

fn watchdog_verdict(elapsed: Duration, deadline: Duration, parent_alive: bool) -> WatchdogVerdict {
    if !parent_alive {
        return WatchdogVerdict::Terminate(HELPER_PARENT_GONE_EXIT_CODE);
    }
    if elapsed >= deadline {
        return WatchdogVerdict::Terminate(HELPER_DEADLINE_EXIT_CODE);
    }
    WatchdogVerdict::KeepWaiting
}

/// The watchdog loop, platform-neutral: only the probe and the terminator
/// differ per OS. Returns the code it terminated with, which only a test's
/// terminator ever lets it reach.
fn watch_helper_lifetime(
    deadline: Duration,
    parent_alive: impl Fn() -> bool,
    terminate: impl FnOnce(i32),
) -> i32 {
    let armed_at = Instant::now();
    loop {
        match watchdog_verdict(armed_at.elapsed(), deadline, parent_alive()) {
            WatchdogVerdict::KeepWaiting => std::thread::sleep(WATCHDOG_POLL_INTERVAL),
            WatchdogVerdict::Terminate(code) => {
                terminate(code);
                return code;
            }
        }
    }
}

/// Tie this helper's lifetime to `deadline` and to the process that spawned
/// it, on a thread of its own so a plugin that never returns cannot hold it.
///
/// Armed only once the arguments name a real extraction, and before any
/// plugin code runs. A failure to start the thread leaves the helper bounded
/// by its spawner alone, as every helper was before this watchdog existed,
/// rather than turning a resource fault into a plugin failure.
fn arm_helper_watchdog(deadline: Duration) {
    let parent_alive = parent_probe();
    let _ = std::thread::Builder::new()
        .name("sourdaw-scan-helper-watchdog".to_string())
        .spawn(move || {
            watch_helper_lifetime(deadline, parent_alive, terminate_current_process);
        });
}

/// Test builds only: a re-exec child may shorten the deadline the real worker
/// entry arms, so a test reaches it in milliseconds rather than seconds.
#[cfg(test)]
const TEST_HELPER_DEADLINE_MS_ENV: &str = "SOURDAW_TEST_HELPER_DEADLINE_MS";

fn helper_deadline() -> Duration {
    #[cfg(test)]
    if let Some(milliseconds) = std::env::var(TEST_HELPER_DEADLINE_MS_ENV)
        .ok()
        .and_then(|value| value.parse().ok())
    {
        return Duration::from_millis(milliseconds);
    }
    HELPER_DEADLINE
}

fn declared_parent_pid() -> Option<u32> {
    std::env::var(SCAN_PARENT_PID_ENV).ok()?.parse().ok()
}

/// A parent that died before this probe was built has already handed the
/// helper to another reaper, so comparing against the declared pid catches
/// it where a parent id read now would not.
#[cfg(unix)]
fn parent_probe() -> Box<dyn Fn() -> bool + Send> {
    let expected = declared_parent_pid()
        .and_then(|pid| libc::pid_t::try_from(pid).ok())
        // SAFETY: getppid has no preconditions and cannot fail.
        .unwrap_or_else(|| unsafe { libc::getppid() });
    // SAFETY: as above.
    Box::new(move || unsafe { libc::getppid() } == expected)
}

/// What the Windows parent watch saw: the open that failed, or the answer of
/// one zero-timeout wait on the opened handle.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParentObservation {
    OpenFailed(ParentOpenFailure),
    Waited(ParentWaitOutcome),
}

#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParentOpenFailure {
    /// No process has the declared pid.
    NoSuchProcess,
    /// Any other refusal, such as a token that may not open a live spawner.
    Other,
}

#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParentWaitOutcome {
    Exited,
    Running,
    Failed,
}

/// Only proof the parent is gone ends the helper. A watch that cannot tell
/// reads the parent as alive and leaves the decision to the deadline and the
/// spawner's own bound: exiting on it would quarantine a plugin for a helper
/// that merely could not see its spawner.
#[cfg(any(windows, test))]
fn parent_alive_from(observation: ParentObservation) -> bool {
    !matches!(
        observation,
        ParentObservation::OpenFailed(ParentOpenFailure::NoSuchProcess)
            | ParentObservation::Waited(ParentWaitOutcome::Exited)
    )
}

/// Windows has no parent link to read back, so the declared pid is opened
/// once and its handle waited on; with no declaration there is nothing to
/// watch and the deadline alone holds. `OpenProcess` reports a pid no process
/// has as `ERROR_INVALID_PARAMETER`.
#[cfg(windows)]
fn parent_probe() -> Box<dyn Fn() -> bool + Send> {
    use windows::core::HRESULT;
    use windows::Win32::Foundation::{
        ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    struct ParentHandle(HANDLE);
    // SAFETY: a process handle is a kernel object reference, valid from any
    // thread; the watchdog thread is its only user.
    unsafe impl Send for ParentHandle {}

    impl ParentHandle {
        /// A method rather than a field read in the closure: edition 2021
        /// closures capture the fields they name, and the bare `HANDLE`
        /// field is not `Send` the way this wrapper is.
        fn wait_outcome(&self) -> ParentWaitOutcome {
            // SAFETY: the handle stays open for the life of the process.
            match unsafe { WaitForSingleObject(self.0, 0) } {
                WAIT_OBJECT_0 => ParentWaitOutcome::Exited,
                WAIT_TIMEOUT => ParentWaitOutcome::Running,
                _ => ParentWaitOutcome::Failed,
            }
        }
    }

    let Some(pid) = declared_parent_pid() else {
        return Box::new(|| true);
    };
    // SAFETY: OpenProcess takes plain values and reports failure as an error.
    let handle = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(handle) => handle,
        Err(error) => {
            let failure = if error.code() == HRESULT::from_win32(ERROR_INVALID_PARAMETER.0) {
                ParentOpenFailure::NoSuchProcess
            } else {
                ParentOpenFailure::Other
            };
            let alive = parent_alive_from(ParentObservation::OpenFailed(failure));
            return Box::new(move || alive);
        }
    };
    let parent = ParentHandle(handle);
    Box::new(move || parent_alive_from(ParentObservation::Waited(parent.wait_outcome())))
}

#[cfg(not(any(unix, windows)))]
fn parent_probe() -> Box<dyn Fn() -> bool + Send> {
    Box::new(|| true)
}

/// End this process now, from any thread, without running exit handlers or
/// static destructors a wedged plugin may hold a lock inside, and without
/// the crash report an abort would file against the plugin's host.
///
/// A helper that leads its own process group — every helper a spawner
/// starts — kills that whole group, so a child the plugin forked ends with
/// it. The helper itself then ends by that `SIGKILL` or by the `_exit` after
/// it, whichever the kernel completes first. A helper in
/// someone else's group, such as a test runner's, never signals that group
/// and ends by `_exit` alone.
#[cfg(unix)]
fn terminate_current_process(code: i32) {
    // SAFETY: getpid has no preconditions and cannot fail.
    let pid = unsafe { libc::getpid() };
    // SAFETY: getpgrp has no preconditions and cannot fail.
    let group = unsafe { libc::getpgrp() };
    if group == pid {
        // SAFETY: kill takes plain values; the target is this process's own
        // group, which this process leads.
        let _ = unsafe { libc::kill(-pid, libc::SIGKILL) };
    }
    // SAFETY: _exit is async-signal-safe and never returns.
    unsafe { libc::_exit(code) }
}

#[cfg(windows)]
fn terminate_current_process(code: i32) {
    use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
    // SAFETY: the pseudo-handle for the current process is always valid.
    let terminated = unsafe { TerminateProcess(GetCurrentProcess(), code as u32) };
    if terminated.is_err() {
        std::process::exit(code);
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_current_process(code: i32) {
    std::process::exit(code);
}

fn write_response<T: Serialize>(path: &Path, response: &WorkerResponse<T>) -> Result<(), String> {
    let bytes = serde_json::to_vec(response)
        .map_err(|error| format!("Cannot serialize plugin scan response: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(oversized_response_error(bytes.len()));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Cannot create plugin scan response: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("Cannot write plugin scan response: {error}"))
}
/// Read every plugin descriptor a file declares through that format's
/// registered backend, in a bounded child process.
pub fn scan_descriptor_metadata(
    format: PluginFormat,
    path: &Path,
    timeout: Duration,
) -> Result<Vec<ScannedDescriptor>, ScanFailure> {
    scan_worker(format, path, None, timeout, WORKER_ARGUMENT)
}

/// Inspect one live instance of the plugin `plugin_id` names in the file,
/// through that format's registered backend, in a bounded child process.
pub fn scan_instance_metadata(
    format: PluginFormat,
    path: &Path,
    plugin_id: &str,
    timeout: Duration,
) -> Result<ScannedInstance, ScanFailure> {
    scan_worker(
        format,
        path,
        Some(plugin_id),
        timeout,
        INSTANCE_WORKER_ARGUMENT,
    )
}

/// The refusal `scan_worker` reports for a helper that exited unsuccessfully,
/// shaped by which of two things that exit code means.
///
/// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] is [`ScanFailure::ResponseWriteRefused`],
/// which [`ScanFailure::is_process_failure`] never classifies as evidence
/// worth quarantining a binary over. Every other non-zero exit — a crash,
/// `WorkerRole::Malformed`, no backend for the format — is
/// [`ScanFailure::ExitedUnsuccessfully`], which it does.
///
/// The message states what happened (the helper could not write) and the one
/// helper fact every exit-3 cause shares (its response limit). It deliberately
/// does not claim which cause fired: an oversize refusal and a broken
/// environment share the exit code, and the child has no channel that could
/// carry the distinction — stderr is null, and a refusal sidecar would carry
/// text from the same process the plugin's own code ran in toward strings the
/// registry publishes, which the reason contract forbids. The measured size
/// therefore appears only where it is observable, in
/// [`ScanFailure::ResponseOverLimit`]'s read-side refusal.
fn process_failure(path: &Path, status: &ExitStatus) -> ScanFailure {
    let path = path.to_path_buf();
    if status.code() == Some(RESPONSE_WRITE_REFUSAL_EXIT_CODE) {
        return ScanFailure::ResponseWriteRefused { path };
    }
    ScanFailure::ExitedUnsuccessfully { path }
}

/// The registry-facing reason for a response-write refusal.
///
/// The plugin answered — the instance was created and inspected successfully,
/// and the helper failed only when writing the answer down — so the generic
/// "could not safely complete inspection" reason would blame the plugin for
/// silence that was the helper's. This says which one it was, with the limit
/// as a number and nothing else: it is published through
/// `parameter_metadata_reason`, whose contract is a safe scanner disposition,
/// never a plugin-originated diagnostic payload.
pub fn response_limit_metadata_reason() -> String {
    format!(
        "The plugin answered the scan, but the scan helper could not write its response — its response limit is {MAX_RESPONSE_BYTES} bytes — so no parameter contract was recorded."
    )
}

fn scan_worker<T: DeserializeOwned>(
    format: PluginFormat,
    path: &Path,
    plugin_id: Option<&str>,
    timeout: Duration,
    worker_argument: &str,
) -> Result<T, ScanFailure> {
    // Refused here as well as in the child: launching a process to be told the
    // format is unhostable spends a spawn and a deadline to reach the same
    // answer, and the child's refusal is an exit code with no reason in it.
    if scan_backend(format).is_none() {
        return Err(ScanFailure::Refused(no_scan_backend(format)));
    }
    let launcher = ScanWorkerCommand::resolve().map_err(ScanFailure::Refused)?;
    scan_worker_with(&launcher, format, path, plugin_id, timeout, worker_argument)
}

fn scan_worker_with<T: DeserializeOwned>(
    launcher: &ScanWorkerCommand,
    format: PluginFormat,
    path: &Path,
    plugin_id: Option<&str>,
    timeout: Duration,
    worker_argument: &str,
) -> Result<T, ScanFailure> {
    let response_directory = ResponseDirectory::create().map_err(ScanFailure::Refused)?;
    let response_path = response_directory.0.join("metadata.json");
    let mut command = Command::new(&launcher.program);
    command
        .args(&launcher.args)
        .arg(worker_argument)
        .arg(format.wire_name())
        .arg(path);
    // The instance marker names which plugin of a multi-plugin bundle to
    // instantiate; the descriptor marker has no per-plugin argument.
    if let Some(plugin_id) = plugin_id {
        command.arg(plugin_id);
    }
    command
        .arg(&response_path)
        .envs(&launcher.env)
        .env(SCAN_PARENT_PID_ENV, std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let status = run_bounded(&mut command, timeout.min(WORKER_TIMEOUT))?;
    if !status.success() {
        return Err(process_failure(path, &status));
    }
    let bytes = read_response_bytes(&response_path, path)?;
    let response: WorkerResponse<T> = serde_json::from_slice(&bytes).map_err(|error| {
        ScanFailure::Refused(format!(
            "Plugin scan helper returned invalid metadata: {error}"
        ))
    })?;
    if response.worker_pid == std::process::id() {
        return Err(ScanFailure::Refused(
            "Plugin metadata extraction did not cross a process boundary".to_string(),
        ));
    }
    response.result.map_err(ScanFailure::Refused)
}
/// Read the helper's response, accepting only a regular file that can be read
/// without blocking.
///
/// The plugin runs inside the helper and is handed the response path, so
/// whatever sits there when the helper exits is untrusted. Every check is made
/// on the opened descriptor, never on the path, because the plugin — or a
/// process it forked that outlives the helper — can swap the path between a
/// check and the open.
fn read_response_bytes(response_path: &Path, plugin_path: &Path) -> Result<Vec<u8>, ScanFailure> {
    let file = open_response(response_path, plugin_path)?;
    let metadata = file
        .metadata()
        .map_err(|error| cannot_read_response(&error))?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        return Err(ScanFailure::ResponseTampered {
            path: plugin_path.to_path_buf(),
        });
    }
    if metadata.len() > MAX_RESPONSE_BYTES {
        return Err(ScanFailure::ResponseOverLimit {
            bytes: usize::try_from(metadata.len()).unwrap_or(usize::MAX),
        });
    }
    // The bound stays on the read itself: a forked process can still grow the
    // file after the size was taken.
    let mut bytes = Vec::new();
    file.take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| cannot_read_response(&error))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(ScanFailure::ResponseOverLimit { bytes: bytes.len() });
    }
    Ok(bytes)
}

fn cannot_read_response(error: &std::io::Error) -> ScanFailure {
    ScanFailure::Refused(format!("Cannot read plugin scan helper response: {error}"))
}

fn returned_no_metadata(error: &std::io::Error) -> ScanFailure {
    ScanFailure::Refused(format!("Plugin scan helper returned no metadata: {error}"))
}

/// Open the response without following a final symlink, and on Unix without
/// waiting for a FIFO's writer or adopting a terminal an intermediate
/// directory swap could aim the open at.
#[cfg(unix)]
fn open_response(response_path: &Path, plugin_path: &Path) -> Result<fs::File, ScanFailure> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_NOCTTY)
        .open(response_path)
        .map_err(|error| {
            if error.raw_os_error() == Some(libc::ELOOP) {
                return ScanFailure::ResponseTampered {
                    path: plugin_path.to_path_buf(),
                };
            }
            returned_no_metadata(&error)
        })
}

#[cfg(windows)]
fn open_response(response_path: &Path, _plugin_path: &Path) -> Result<fs::File, ScanFailure> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(response_path)
        .map_err(|error| returned_no_metadata(&error))
}

#[cfg(not(any(unix, windows)))]
fn open_response(response_path: &Path, _plugin_path: &Path) -> Result<fs::File, ScanFailure> {
    OpenOptions::new()
        .read(true)
        .open(response_path)
        .map_err(|error| returned_no_metadata(&error))
}

/// Whether the opened response is itself a reparse point. Opened with
/// `FILE_FLAG_OPEN_REPARSE_POINT`, a symlink or junction is not followed, so
/// its own attributes say what it is.
#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

/// Every helper this process has running, and whether it was told to stop.
///
/// Production uses the one process-wide [`HELPER_REGISTRY`]; every function
/// below takes the registry it works on so a test's stop never leaks into
/// another test's spawns.
///
/// Spawning and deregistering happen under the lock that a stop holds while
/// it kills, so no helper starts after a stop and no kill can land on a pid
/// the OS has already handed to another process: a pid leaves the set before
/// or as its process is reaped, never after.
///
/// Once stopped, no entry point returns to its caller: a thread that asks to
/// spawn, reap or forget a helper parks for the rest of the process's life
/// (see [`park_until_process_exit`]).
struct HelperRegistry {
    state: Mutex<HelperRegistryState>,
}

struct HelperRegistryState {
    stopping: bool,
    live: BTreeSet<u32>,
}

/// Stop exists only for a process about to exit, and a stopped scan has no
/// truthful answer: any value returned to the walk — a refusal or an exit
/// status — would let it publish a registry that drops every candidate it
/// did not reach. So the calling thread never returns, and the process's
/// exit ends it. The loop absorbs `park`'s spurious wake-ups.
fn park_until_process_exit() -> ! {
    loop {
        std::thread::park();
    }
}

impl HelperRegistry {
    const fn new() -> Self {
        Self {
            state: Mutex::new(HelperRegistryState {
                stopping: false,
                live: BTreeSet::new(),
            }),
        }
    }

    /// Nothing panics while holding the lock, so a poisoned one still holds
    /// a consistent set.
    fn lock(&self) -> MutexGuard<'_, HelperRegistryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The lock, or never: once stopped, the guard is released and the
    /// calling thread parks.
    fn lock_unless_stopped(&self) -> MutexGuard<'_, HelperRegistryState> {
        let state = self.lock();
        if state.stopping {
            drop(state);
            park_until_process_exit();
        }
        state
    }

    fn spawn(&self, command: &mut Command) -> Result<Child, ScanFailure> {
        let mut state = self.lock_unless_stopped();
        let child = command.spawn().map_err(|error| {
            ScanFailure::Refused(format!("Cannot start plugin scan helper: {error}"))
        })?;
        state.live.insert(child.id());
        Ok(child)
    }

    /// Reap the helper if it has exited, deregistering it under the same lock.
    fn try_reap(&self, child: &mut Child) -> std::io::Result<Option<ExitStatus>> {
        let mut state = self.lock_unless_stopped();
        let Some(status) = child.try_wait()? else {
            return Ok(None);
        };
        state.live.remove(&child.id());
        Ok(Some(status))
    }

    /// Take a helper out of the set before its spawner reaps it itself.
    fn forget(&self, child: &Child) {
        let mut state = self.lock_unless_stopped();
        state.live.remove(&child.id());
    }

    /// Kill every live helper's tree and park every later caller, so the
    /// stopped scan never answers.
    fn stop(&self) {
        let mut state = self.lock();
        state.stopping = true;
        for pid in &state.live {
            kill_helper_tree(*pid);
        }
    }
}

static HELPER_REGISTRY: HelperRegistry = HelperRegistry::new();

/// Kill every scan helper this process has running, and park every scan
/// thread that next asks the registry for anything, so a stopped scan never
/// answers and never publishes. For a process that is about to exit: nothing
/// undoes it, and the exit is what ends the parked threads.
pub fn stop_plugin_scan_helpers() {
    HELPER_REGISTRY.stop();
}

fn run_bounded(command: &mut Command, timeout: Duration) -> Result<ExitStatus, ScanFailure> {
    run_bounded_in(&HELPER_REGISTRY, command, timeout)
}

fn run_bounded_in(
    registry: &HelperRegistry,
    command: &mut Command,
    timeout: Duration,
) -> Result<ExitStatus, ScanFailure> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(target_os = "linux")]
    tie_to_spawner_death(command);
    let mut child = registry.spawn(command)?;
    #[cfg(windows)]
    let _job = KillOnCloseJob::assign(&child);
    wait_bounded(registry, &mut child, timeout)
}

/// Have the kernel kill the helper when its spawner dies.
///
/// `PR_SET_PDEATHSIG` fires when the *thread* that forked the child exits,
/// not the process. That is safe here because every spawn and its bounded
/// wait run on one thread, which therefore outlives the helper. The parent
/// check after it closes the race with a spawner that died before the signal
/// was armed. Only async-signal-safe calls run between fork and exec.
///
/// The signal reaches the helper alone, not its group: a child the plugin
/// forked survives a spawner killed outright on Linux. The helper's own
/// watchdog does not cover it either, because the kernel's kill beats the
/// watchdog's next poll.
#[cfg(target_os = "linux")]
fn tie_to_spawner_death(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // SAFETY: getpid has no preconditions and cannot fail.
    let spawner = unsafe { libc::getpid() };
    let tie = move || {
        // A refused prctl leaves the helper's own parent watch and the
        // spawner's deadline in force, so the spawn goes ahead.
        // SAFETY: prctl with PR_SET_PDEATHSIG takes plain values and is
        // async-signal-safe.
        let _ = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) };
        // SAFETY: getppid has no preconditions and is async-signal-safe.
        if unsafe { libc::getppid() } != spawner {
            // SAFETY: _exit is async-signal-safe and never returns.
            unsafe { libc::_exit(HELPER_PARENT_GONE_EXIT_CODE) }
        }
        Ok(())
    };
    // SAFETY: the hook runs between fork and exec, and calls only prctl,
    // getppid and _exit, all async-signal-safe; it allocates nothing and
    // touches no memory shared with the parent.
    unsafe {
        command.pre_exec(tie);
    }
}

/// A job that kills the helper's whole tree when its handle closes — when the
/// spawner reaps the helper, or when the OS closes the handle of a spawner
/// that died. Failing to create or assign it never fails the scan: the
/// helper's own watchdog still holds, and it is also what covers the short
/// window between spawn and assignment.
#[cfg(windows)]
struct KillOnCloseJob(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl KillOnCloseJob {
    fn assign(child: &Child) -> Option<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        // SAFETY: an anonymous job with default security; failure is an error.
        let job = Self(unsafe { CreateJobObjectW(None, PCWSTR::null()) }.ok()?);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `limits` outlives the call and the length is its own size.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .ok()?;
        // SAFETY: the child's handle is open until `child` is dropped, which
        // is after this call.
        unsafe { AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())) }.ok()?;
        Some(job)
    }
}

#[cfg(windows)]
impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns the handle and closes it once.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

fn wait_bounded(
    registry: &HelperRegistry,
    child: &mut Child,
    timeout: Duration,
) -> Result<ExitStatus, ScanFailure> {
    let deadline = Instant::now() + timeout;
    loop {
        match registry.try_reap(child) {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                terminate_process_tree(registry, child);
                return Err(ScanFailure::TimedOut);
            }
            Err(error) => {
                terminate_process_tree(registry, child);
                return Err(ScanFailure::Refused(format!(
                    "Cannot observe plugin scan helper: {error}"
                )));
            }
        }
    }
}

/// Kill and reap the helper's tree.
fn terminate_process_tree(registry: &HelperRegistry, child: &mut Child) {
    registry.forget(child);
    kill_helper_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

/// Every helper leads its own process group, so its pid is the group's id.
#[cfg(unix)]
fn kill_helper_tree(pid: u32) {
    let Ok(group) = libc::pid_t::try_from(pid) else {
        return;
    };
    // SAFETY: kill takes plain values; the group is unreaped while registered.
    let _ = unsafe { libc::kill(-group, libc::SIGKILL) };
}
#[cfg(windows)]
fn kill_helper_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}
#[cfg(not(any(unix, windows)))]
fn kill_helper_tree(_pid: u32) {}
#[cfg(test)]
mod tests {
    use super::*;
    use daw_plugin_host::scanner::FormatScanSupport;
    use daw_plugin_host::scanner::{ScannedInstanceCapabilities, ScannedParameterDescriptor};

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    /// The direct form: the application binary scanning its own argv.
    #[test]
    fn the_marker_is_found_directly_after_the_executable() {
        assert_eq!(
            worker_role(&args(&[
                "/app",
                WORKER_ARGUMENT,
                "clap",
                "/p.clap",
                "/out.json"
            ])),
            Some(WorkerRole::Extract {
                format: PluginFormat::Clap,
                plugin_id: None,
                plugin_path: &OsString::from("/p.clap"),
                response_path: &OsString::from("/out.json"),
            })
        );
    }

    /// The Electron form: a runtime executable that is handed its script first.
    /// Without this the leaf process would decide it is not a worker at all,
    /// run the host's entry point instead, and every scan would time out.
    #[test]
    fn the_marker_is_found_after_a_runtime_argument() {
        assert_eq!(
            worker_role(&args(&[
                "/electron",
                "/shell/scanWorker.js",
                INSTANCE_WORKER_ARGUMENT,
                "clap",
                "/p.clap",
                "org.example.plugin",
                "/out.json",
            ])),
            Some(WorkerRole::Extract {
                format: PluginFormat::Clap,
                plugin_id: Some("org.example.plugin"),
                plugin_path: &OsString::from("/p.clap"),
                response_path: &OsString::from("/out.json"),
            })
        );
    }

    /// The instance worker without its plugin selector is the invocation a
    /// stale host would send, and instantiating the bundle's first plugin as a
    /// guess is exactly the behavior the selector exists to remove.
    #[test]
    fn an_instance_worker_invocation_without_a_plugin_id_is_malformed() {
        assert_eq!(
            worker_role(&args(&[
                "/app",
                INSTANCE_WORKER_ARGUMENT,
                "clap",
                "/p.clap",
                "/out.json"
            ])),
            Some(WorkerRole::Malformed)
        );
    }

    /// Non-UTF-8 bytes in the plugin id are refused, not lossily decoded: the
    /// id becomes the CString handed to `create_plugin`, and a lossy decode
    /// would ask the bundle for a plugin that does not exist.
    #[cfg(unix)]
    #[test]
    fn an_instance_worker_invocation_whose_plugin_id_is_not_utf8_is_malformed() {
        use std::os::unix::ffi::OsStringExt;

        let arguments = vec![
            OsString::from("/app"),
            OsString::from(INSTANCE_WORKER_ARGUMENT),
            OsString::from("clap"),
            OsString::from("/p.clap"),
            OsString::from_vec(vec![0x70, 0x6c, 0x75, 0x67, 0xff, 0x69, 0x6e]),
            OsString::from("/out.json"),
        ];

        assert_eq!(worker_role(&arguments), Some(WorkerRole::Malformed));
    }

    #[test]
    fn arguments_without_the_marker_are_not_a_worker() {
        assert_eq!(worker_role(&args(&["/app"])), None);
        assert_eq!(worker_role(&args(&["/app", "/shell/main.js"])), None);
    }

    /// An executable whose own path spells the marker must not be able to claim
    /// the role — index 0 is never searched.
    #[test]
    fn the_executable_path_cannot_claim_the_worker_role() {
        assert_eq!(
            worker_role(&args(&[WORKER_ARGUMENT, "clap", "/p.clap", "/out.json"])),
            None
        );
    }

    #[test]
    fn a_worker_invocation_with_the_wrong_argument_count_is_malformed() {
        assert_eq!(
            worker_role(&args(&["/app", WORKER_ARGUMENT, "clap", "/p.clap"])),
            Some(WorkerRole::Malformed)
        );
        assert_eq!(
            worker_role(&args(&[
                "/app",
                WORKER_ARGUMENT,
                "clap",
                "/p.clap",
                "/out.json",
                "extra"
            ])),
            Some(WorkerRole::Malformed)
        );
    }

    /// The pre-format arity, which is now one argument short. Pinned because it
    /// is the invocation a stale host would send, and reading `/p.clap` as the
    /// format has to fail rather than fall through to CLAP.
    #[test]
    fn a_worker_invocation_that_omits_the_format_is_malformed() {
        assert_eq!(
            worker_role(&args(&["/app", WORKER_ARGUMENT, "/p.clap", "/out.json"])),
            Some(WorkerRole::Malformed)
        );
    }

    /// A format value the registry does not know is refused rather than
    /// defaulted. Defaulting would run the CLAP extractor — a dlopen and an
    /// entry-point call — against a file nobody claimed was a CLAP plugin.
    #[test]
    fn a_worker_invocation_naming_an_unknown_format_is_malformed() {
        assert_eq!(
            worker_role(&args(&[
                "/app",
                WORKER_ARGUMENT,
                "mystery",
                "/p.clap",
                "/out.json"
            ])),
            Some(WorkerRole::Malformed)
        );
        assert_eq!(
            worker_role(&args(&[
                "/app",
                WORKER_ARGUMENT,
                "",
                "/p.clap",
                "/out.json"
            ])),
            Some(WorkerRole::Malformed)
        );
    }

    /// A format Sourdaw recognises but has no scan backend for. The walk refuses
    /// these before a candidate exists, so an invocation naming one is a caller
    /// error — and the worker must not answer it by loading the file through
    /// some other format's extractor.
    #[test]
    fn a_worker_invocation_naming_a_format_with_no_backend_is_malformed() {
        for format in ["vst2", "au"] {
            assert_eq!(
                worker_role(&args(&[
                    "/app",
                    WORKER_ARGUMENT,
                    format,
                    "/p.plugin",
                    "/out.json"
                ])),
                Some(WorkerRole::Malformed),
                "{format} has no scan backend and must not reach an extractor"
            );
        }
    }

    /// Non-UTF-8 bytes in the format argument are refused, not lossily decoded.
    #[cfg(unix)]
    #[test]
    fn a_worker_invocation_whose_format_is_not_utf8_is_malformed() {
        use std::os::unix::ffi::OsStringExt;

        let arguments = vec![
            OsString::from("/app"),
            OsString::from(WORKER_ARGUMENT),
            OsString::from_vec(vec![0x63, 0x6c, 0x61, 0xff, 0x70]),
            OsString::from("/p.clap"),
            OsString::from("/out.json"),
        ];

        assert_eq!(worker_role(&arguments), Some(WorkerRole::Malformed));
    }

    /// The registry is the dispatch. This fails the moment a format is
    /// registered without the rest of the packet that makes it real.
    #[test]
    fn only_the_hosted_formats_have_a_registered_scan_backend() {
        assert!(scan_backend(PluginFormat::Clap).is_some());
        assert!(scan_backend(PluginFormat::Vst3).is_some());
        assert!(scan_backend(PluginFormat::Vst2).is_none());
        assert!(scan_backend(PluginFormat::AudioUnit).is_none());
    }

    /// Two registries answer "can this format be scanned?" — the walk asks
    /// `scan_support` to decide whether a file is even a candidate, and this
    /// file asks `scan_backend` to decide what to do with one. Nothing made them
    /// agree.
    ///
    /// Disagreeing either way is a user-visible fault with no error attached to
    /// it. A format the walk collects and this file has no backend for produces
    /// a spawn refusal for every bundle the user owns. A format this file has a
    /// backend for and the walk refuses is a working host the user is told is
    /// not implemented, and the backend is never reached to contradict it.
    #[test]
    fn the_two_scan_registries_agree_about_every_format() {
        for format in PluginFormat::ALL {
            assert_eq!(
                scan_backend(format).is_some(),
                matches!(format.scan_support(), FormatScanSupport::Extractor),
                "{} is scannable according to one registry and not the other",
                format.wire_name()
            );
        }
    }

    /// A format with no backend is refused before a process is spawned, with a
    /// reason — the child's refusal is an exit code and carries none.
    #[test]
    fn scanning_a_format_with_no_backend_refuses_without_spawning_a_worker() {
        let refusal = scan_descriptor_metadata(
            PluginFormat::Vst2,
            Path::new("/plugins/Vendor.vst"),
            Duration::from_millis(1),
        )
        .expect_err("a format with no scan backend must be refused");

        assert_eq!(
            refusal.to_string(),
            "No plugin scan backend for format vst2"
        );
    }

    #[test]
    fn a_declared_launch_command_carries_its_arguments_and_environment() {
        let command = ScanWorkerCommand::from_json(
            r#"{"program":"/electron","args":["/shell/scanWorker.js"],"env":{"RUN_AS_NODE":"1"}}"#,
        )
        .expect("a well-formed command should parse");

        assert_eq!(command.program, PathBuf::from("/electron"));
        assert_eq!(command.args, vec!["/shell/scanWorker.js".to_string()]);
        assert_eq!(
            command.env.get("RUN_AS_NODE").map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn a_declared_launch_command_may_omit_its_arguments_and_environment() {
        let command =
            ScanWorkerCommand::from_json(r#"{"program":"/app"}"#).expect("program alone is enough");

        assert!(command.args.is_empty());
        assert!(command.env.is_empty());
    }

    /// Falling back to re-execution here would launch the wrong program once
    /// per plugin and report every one of them as a broken plugin.
    #[test]
    fn an_unusable_launch_command_is_refused_rather_than_ignored() {
        assert!(ScanWorkerCommand::from_json("not json").is_err());
        assert!(ScanWorkerCommand::from_json(r#"{"program":""}"#).is_err());
        assert!(ScanWorkerCommand::from_json(r#"{"args":["/shell/scanWorker.js"]}"#).is_err());
    }

    struct HostileClapFixture {
        root: PathBuf,
        plugin_path: PathBuf,
    }

    impl Drop for HostileClapFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn build_hostile_clap(test_name: &str) -> HostileClapFixture {
        let root = std::env::temp_dir().join(format!(
            "sourdaw-hostile-clap-{test_name}-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("hostile CLAP fixture directory should be created");
        let source_path = root.join("hostile_clap.rs");
        let plugin_path = root.join("hostile.clap");
        fs::write(
            &source_path,
            r#"use std::ffi::{c_char,c_void};
#[repr(C)] struct Version{major:u32,minor:u32,revision:u32}
#[repr(C)] struct Entry{version:Version,init:Option<unsafe extern "C" fn(*const c_char)->bool>,deinit:Option<unsafe extern "C" fn()>,get_factory:Option<unsafe extern "C" fn(*const c_char)->*const c_void>}
#[cfg(unix)] unsafe extern "C" { fn fork()->i32; }
#[cfg(unix)] fn fork_a_spinning_child_then_hang(pid_file:std::ffi::OsString)->!{
 let child=unsafe{fork()};
 if child==0{loop{std::hint::spin_loop();}}
 let _=std::fs::write(pid_file,child.to_string());
 loop{std::thread::sleep(std::time::Duration::from_secs(1));}
}
unsafe extern "C" fn init(_: *const c_char)->bool{
 #[cfg(unix)] if let Some(pid_file)=std::env::var_os("SOURDAW_TEST_PLUGIN_FORK_PID_FILE"){fork_a_spinning_child_then_hang(pid_file);}
 if std::env::var_os("SOURDAW_TEST_PLUGIN_HANG").is_some(){loop{std::thread::sleep(std::time::Duration::from_secs(1));}}
 std::process::abort();
}
#[no_mangle] static clap_entry:Entry=Entry{version:Version{major:1,minor:2,revision:0},init:Some(init),deinit:None,get_factory:None};"#,
        )
        .expect("hostile CLAP fixture source should be written");
        let status = Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into()))
            .args(["--crate-type", "cdylib", "--edition", "2021"])
            .arg(&source_path)
            .arg("-o")
            .arg(&plugin_path)
            .status()
            .expect("rustc should compile the hostile CLAP fixture");
        assert!(status.success());
        HostileClapFixture { root, plugin_path }
    }
    #[test]
    fn hostile_fixture_child() {
        let Some(path) = std::env::var_os("SOURDAW_TEST_PLUGIN_PATH") else {
            return;
        };
        let _ = extract_clap_metadata(Path::new(&path));
        panic!("hostile CLAP fixture should not return");
    }
    fn hostile_command(plugin_path: &Path) -> Command {
        let mut command =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        command
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::hostile_fixture_child")
            .env("SOURDAW_TEST_PLUGIN_PATH", plugin_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    /// The response belongs to one manual VST3 worker test. Its UUID makes a
    /// stale response from another test process impossible to mistake for this
    /// worker's result, and its drop removes no path the test did not create.
    struct Vst3WorkerResponsePath(PathBuf);

    impl Vst3WorkerResponsePath {
        fn create() -> Self {
            Self(std::env::temp_dir().join(format!(
                "sourdaw-vst3-instance-worker-{}.json",
                uuid::Uuid::new_v4()
            )))
        }
    }

    impl Drop for Vst3WorkerResponsePath {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    /// This leaf is selected exactly by the manual parent below. It keeps the
    /// real bundle load in the bounded child: the test runner that requested
    /// the evidence never calls a third-party VST3 entry point itself.
    #[test]
    #[ignore = "selected only by the bounded VST3 worker regression test"]
    fn real_vst3_instance_worker_child() {
        let plugin_path = std::env::var_os("SOURDAW_TEST_VST3_PATH")
            .expect("SOURDAW_TEST_VST3_PATH is required for the VST3 worker child");
        let response_path = std::env::var_os("SOURDAW_TEST_VST3_RESPONSE_PATH")
            .expect("SOURDAW_TEST_VST3_RESPONSE_PATH is required for the VST3 worker child");

        assert_eq!(
            run_from_args([
                OsString::from("sourdaw-vst3-instance-worker-child"),
                OsString::from(INSTANCE_WORKER_ARGUMENT),
                OsString::from(PluginFormat::Vst3.wire_name()),
                plugin_path,
                // VST3 resolves the bundle's declared class itself. The
                // backend intentionally ignores this selector, but the
                // instance-worker protocol still requires a valid UTF-8 id.
                OsString::from("com.native-instruments.massive"),
                response_path,
            ]),
            Some(0),
            "the worker must serialize the real VST3 instance result"
        );
    }

    /// #3749: this is intentionally manual and vendor-backed. It exercises the
    /// VST3 registry's real `backend.instance` call through `run_from_args`, so
    /// changing that call site to fabricate `Some(false)` fails here even while
    /// helper-only capability tests remain green. It never opens an editor:
    /// VST3's editor query remains a UI-thread operation outside scan workers.
    #[test]
    #[ignore = "requires SOURDAW_TEST_VST3_PATH and launches its bundle only in a bounded child"]
    fn a_real_vst3_instance_worker_leaves_editor_support_unqueried() {
        let plugin_path = std::env::var_os("SOURDAW_TEST_VST3_PATH")
            .expect("SOURDAW_TEST_VST3_PATH is required for this manual VST3 worker test");
        let response_path = Vst3WorkerResponsePath::create();
        let mut command =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        command
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::real_vst3_instance_worker_child")
            .arg("--ignored")
            .arg("--test-threads=1")
            .env("SOURDAW_TEST_VST3_PATH", plugin_path)
            .env("SOURDAW_TEST_VST3_RESPONSE_PATH", &response_path.0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let status = run_bounded(&mut command, WORKER_TIMEOUT)
            .expect("the VST3 worker child must remain observable within its bound");
        assert!(status.success(), "the VST3 worker child must succeed");

        let bytes = fs::read(&response_path.0)
            .expect("the successful VST3 worker child must serialize a response");
        let response: WorkerResponse<ScannedInstance> = serde_json::from_slice(&bytes)
            .expect("the VST3 worker response must deserialize as ScannedInstance");
        assert_ne!(
            response.worker_pid,
            std::process::id(),
            "the VST3 metadata must come from the worker child, not this test runner"
        );
        let scanned = response
            .result
            .expect("the VST3 worker must serialize successful instance metadata");
        assert!(
            scanned.capabilities.audio_channels.is_some(),
            "the VST3 worker must report the bundle's declared audio channels"
        );
        assert_eq!(
            scanned.capabilities.has_custom_ui, None,
            "the worker must not fabricate VST3 editor absence without a UI-thread query"
        );
    }

    #[test]
    fn crashed_helper_does_not_take_down_the_supervisor() {
        let fixture = build_hostile_clap("crash");
        let mut command = hostile_command(&fixture.plugin_path);
        let status = run_bounded(&mut command, WORKER_TIMEOUT)
            .expect("the crashed child should still be observable within the worker timeout");
        assert!(!status.success());
    }
    #[test]
    fn hung_helper_is_killed_at_the_deadline() {
        let fixture = build_hostile_clap("hang");
        let mut command = hostile_command(&fixture.plugin_path);
        command.env("SOURDAW_TEST_PLUGIN_HANG", "1");
        let error = run_bounded(&mut command, Duration::from_millis(500))
            .expect_err("the hung child should exceed the deadline");
        assert_eq!(error, ScanFailure::TimedOut);
    }
    #[cfg(unix)]
    /// A killed process stays visible to `kill(pid, 0)` until its parent
    /// reaps it, so "the group was killed" is only provable over a reap
    /// window: keep polling until the signal probe reports ESRCH.
    fn process_is_gone_within(pid: i32, window: Duration) -> bool {
        let deadline = Instant::now() + window;
        loop {
            // SAFETY: `libc::kill` takes plain integers and touches no memory
            // of ours; signal 0 only probes whether `pid` exists.
            let probe = unsafe { libc::kill(pid, 0) };
            let gone =
                probe == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
            if gone {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    #[cfg(unix)]
    #[test]
    fn timeout_kills_the_helper_process_group() {
        let pid_path =
            std::env::temp_dir().join(format!("sourdaw-scan-child-{}", std::process::id()));
        // A stale file from an earlier run under the same test-binary pid
        // must never be mistaken for this run's helper.
        let _ = fs::remove_file(&pid_path);
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!("sleep 30 & echo $! > {}; wait", pid_path.display()),
        ]);
        // Long enough for `sh` to fork `sleep` and write its pid even on a
        // loaded runner; the orphaned `sleep 30` still outlives this
        // deadline, so the group kill below is still what gets exercised.
        assert!(run_bounded(&mut command, Duration::from_secs(2)).is_err());
        let pid = fs::read_to_string(&pid_path).expect(
            "the helper must write its child's pid before the deadline; \
             a missing file means the deadline fired first",
        );
        let _ = fs::remove_file(&pid_path);
        let pid: i32 = pid.trim().parse().expect(
            "the helper's pid file must hold the child's pid; an empty file means the \
             deadline fired between creating and writing it",
        );
        assert!(
            process_is_gone_within(pid, Duration::from_secs(2)),
            "sleep {pid} is still alive after the group kill's reap window"
        );
    }

    /// Whether `pid` has exited within `window`. An orphan is reaped by
    /// whichever process adopted it, not by this test, so on Linux a zombie
    /// still awaiting that reaper already counts as exited.
    #[cfg(unix)]
    fn process_has_exited_within(pid: i32, window: Duration) -> bool {
        let deadline = Instant::now() + window;
        loop {
            #[cfg(target_os = "linux")]
            {
                let zombie = fs::read_to_string(format!("/proc/{pid}/stat"))
                    .ok()
                    .and_then(|stat| {
                        stat.rsplit_once(')')
                            .map(|(_, rest)| rest.trim_start().starts_with('Z'))
                    })
                    .unwrap_or(false);
                if zombie {
                    return true;
                }
            }
            if process_is_gone_within(pid, Duration::ZERO) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Wait for `child` to exit, never longer than `window`.
    fn exit_status_within(child: &mut Child, window: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + window;
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                return Some(status);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Read a pid a child process wrote, never waiting longer than `window`.
    #[cfg(unix)]
    fn read_pid_within(path: &Path, window: Duration) -> Option<i32> {
        let deadline = Instant::now() + window;
        loop {
            if let Some(pid) = fs::read_to_string(path)
                .ok()
                .and_then(|text| text.trim().parse().ok())
            {
                return Some(pid);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Kills whatever a lifetime test left running, so a regression fails
    /// the test instead of leaving a spinning process behind it.
    #[cfg(unix)]
    struct Stragglers {
        children: Vec<Child>,
        pids: Vec<i32>,
        files: Vec<PathBuf>,
    }

    #[cfg(unix)]
    impl Stragglers {
        fn cleaning(files: Vec<PathBuf>) -> Self {
            Self {
                children: Vec::new(),
                pids: Vec::new(),
                files,
            }
        }
    }

    #[cfg(unix)]
    impl Drop for Stragglers {
        fn drop(&mut self) {
            for pid in &self.pids {
                if !process_is_gone_within(*pid, Duration::ZERO) {
                    // SAFETY: kill takes plain values.
                    let _ = unsafe { libc::kill(*pid, libc::SIGKILL) };
                }
            }
            for child in &mut self.children {
                let _ = child.kill();
                let _ = child.wait();
            }
            for file in &self.files {
                let _ = fs::remove_file(file);
            }
        }
    }

    const ORPHAN_SPAWNER_PLUGIN_ENV: &str = "SOURDAW_TEST_ORPHAN_SPAWNER_PLUGIN";
    const ORPHAN_HELPER_MARKER_ENV: &str = "SOURDAW_TEST_ORPHAN_HELPER";
    const ORPHAN_HELPER_PID_FILE_ENV: &str = "SOURDAW_TEST_ORPHAN_HELPER_PID_FILE";
    const DEADLINE_CHILD_MARKER_ENV: &str = "SOURDAW_TEST_DEADLINE_WATCHDOG_CHILD";
    const PLAIN_SPAWNER_PID_FILE_ENV: &str = "SOURDAW_TEST_PLAIN_SPAWNER_HELPER_PID_FILE";

    /// The stand-in spawner for the Linux kernel tie: runs a plain `sh`
    /// helper, which arms no watchdog, through the real bounded spawn. The
    /// test kills this process.
    #[test]
    fn plain_helper_spawner_child() {
        let Some(pid_file) = std::env::var_os(PLAIN_SPAWNER_PID_FILE_ENV) else {
            return;
        };
        let mut command = Command::new("sh");
        command
            .args(["-c", "echo $$ > \"$0\"; exec sleep 30"])
            .arg(pid_file);
        let _ = run_bounded_in(&HelperRegistry::new(), &mut command, WORKER_TIMEOUT);
    }

    /// Only `PR_SET_PDEATHSIG` can end this helper inside the window: it runs
    /// no watchdog, and the spawner's own bound dies with the spawner.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_killed_spawner_takes_a_plain_helper_with_it_on_linux() {
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-plain-helper-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        let spawner = Command::new(std::env::current_exe().expect("test executable should exist"))
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::plain_helper_spawner_child")
            .env(PLAIN_SPAWNER_PID_FILE_ENV, &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the stand-in spawner should start");
        let spawner_pid = i32::try_from(spawner.id()).expect("a pid fits an i32");
        stragglers.children.push(spawner);

        let helper = read_pid_within(&pid_file, Duration::from_secs(10))
            .expect("the plain helper should start and write its pid");
        stragglers.pids.push(helper);

        // SAFETY: kill takes plain values; the spawner is this test's child.
        assert_eq!(unsafe { libc::kill(spawner_pid, libc::SIGKILL) }, 0);
        for child in &mut stragglers.children {
            let _ = child.wait();
        }

        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "plain helper {helper} outlived its killed spawner"
        );
    }

    /// The stand-in spawner: scans the hanging fixture through the real
    /// `scan_worker_with`, so the helper is launched exactly as production
    /// launches it, parent pid and all. The test kills this process.
    #[test]
    fn orphan_spawner_child() {
        let Some(plugin_path) = std::env::var_os(ORPHAN_SPAWNER_PLUGIN_ENV) else {
            return;
        };
        let launcher = ScanWorkerCommand {
            program: std::env::current_exe().expect("test executable should exist"),
            // `--` hands the worker arguments to libtest as extra filters,
            // which match no test, rather than as unknown options.
            args: vec![
                "--exact".to_string(),
                "host::plugin_scan_worker::tests::orphan_helper_child".to_string(),
                "--".to_string(),
            ],
            env: BTreeMap::from([
                ("SOURDAW_TEST_PLUGIN_HANG".to_string(), "1".to_string()),
                (ORPHAN_HELPER_MARKER_ENV.to_string(), "1".to_string()),
            ]),
        };
        let _ = scan_worker_with::<Vec<ScannedDescriptor>>(
            &launcher,
            PluginFormat::Clap,
            Path::new(&plugin_path),
            None,
            WORKER_TIMEOUT,
            WORKER_ARGUMENT,
        );
    }

    /// The stand-in helper: the real worker entry, whose plugin hangs in its
    /// entry point and never returns.
    #[test]
    fn orphan_helper_child() {
        if std::env::var_os(ORPHAN_HELPER_MARKER_ENV).is_none() {
            return;
        }
        let pid_file = PathBuf::from(
            std::env::var_os(ORPHAN_HELPER_PID_FILE_ENV)
                .expect("the orphan helper needs a pid file to write"),
        );
        let staged = pid_file.with_extension("partial");
        fs::write(&staged, std::process::id().to_string()).expect("the pid should be written");
        fs::rename(&staged, &pid_file).expect("the pid file should be published");
        let _ = run_from_process_args();
        panic!("the hanging fixture should never return");
    }

    /// The defect itself: a spawner killed outright — no stop, no group kill —
    /// must not leave its helper spinning. The window is far below both the
    /// spawner's bound and the helper's own deadline, so neither of those can
    /// end the helper inside it. What does is a parent tie: on Linux either
    /// `PR_SET_PDEATHSIG` or the helper's parent watch, on macOS the parent
    /// watch alone. The Linux signal is pinned on its own by
    /// `a_killed_spawner_takes_a_plain_helper_with_it_on_linux`.
    #[cfg(unix)]
    #[test]
    fn a_helper_does_not_outlive_its_killed_spawner() {
        let fixture = build_hostile_clap("orphan");
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-orphan-helper-{}", uuid::Uuid::new_v4()));
        let mut stragglers =
            Stragglers::cleaning(vec![pid_file.clone(), pid_file.with_extension("partial")]);
        let spawner = Command::new(std::env::current_exe().expect("test executable should exist"))
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::orphan_spawner_child")
            .env(ORPHAN_SPAWNER_PLUGIN_ENV, &fixture.plugin_path)
            .env(ORPHAN_HELPER_PID_FILE_ENV, &pid_file)
            .env_remove(SCAN_PARENT_PID_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the stand-in spawner should start");
        let spawner_pid = i32::try_from(spawner.id()).expect("a pid fits an i32");
        stragglers.children.push(spawner);

        let helper = read_pid_within(&pid_file, Duration::from_secs(10))
            .expect("the stand-in helper should start and write its pid");
        stragglers.pids.push(helper);
        assert!(
            !process_is_gone_within(helper, Duration::from_millis(500)),
            "the helper {helper} must be hung in the fixture before its spawner dies"
        );

        // SAFETY: kill takes plain values; the spawner is this test's child.
        assert_eq!(unsafe { libc::kill(spawner_pid, libc::SIGKILL) }, 0);
        for child in &mut stragglers.children {
            let _ = child.wait();
        }

        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "helper {helper} outlived its killed spawner"
        );
    }

    /// The stand-in for a plugin that never yields: the real watchdog armed
    /// with a short deadline, then a spin no check between calls could break.
    #[test]
    fn deadline_watchdog_child() {
        if std::env::var_os(DEADLINE_CHILD_MARKER_ENV).is_none() {
            return;
        }
        arm_helper_watchdog(Duration::from_millis(300));
        loop {
            std::hint::spin_loop();
        }
    }

    #[test]
    fn a_helper_that_never_yields_ends_at_its_own_deadline() {
        let mut child =
            Command::new(std::env::current_exe().expect("test executable should exist"))
                .arg("--exact")
                .arg("host::plugin_scan_worker::tests::deadline_watchdog_child")
                .env(DEADLINE_CHILD_MARKER_ENV, "1")
                .env_remove(SCAN_PARENT_PID_ENV)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("the spinning stand-in should start");

        let status = exit_status_within(&mut child, Duration::from_secs(5));
        if status.is_none() {
            let _ = child.kill();
            let _ = child.wait();
        }

        assert_eq!(
            status.and_then(|status| status.code()),
            Some(HELPER_DEADLINE_EXIT_CODE),
            "the spinning helper must end itself at its deadline"
        );
    }

    const GROUP_HELPER_PLUGIN_ENV: &str = "SOURDAW_TEST_GROUP_HELPER_PLUGIN";

    /// The real worker entry over a plugin that forks a spinning child and
    /// then hangs, with the deadline shortened for this child only.
    #[test]
    fn group_deadline_helper_child() {
        let Some(plugin_path) = std::env::var_os(GROUP_HELPER_PLUGIN_ENV) else {
            return;
        };
        let response_path =
            std::env::temp_dir().join(format!("sourdaw-group-helper-{}", uuid::Uuid::new_v4()));
        let _ = run_from_args([
            OsString::from("sourdaw-group-helper-child"),
            OsString::from(WORKER_ARGUMENT),
            OsString::from(PluginFormat::Clap.wire_name()),
            plugin_path,
            response_path.into_os_string(),
        ]);
        panic!("the forking fixture should never return");
    }

    /// A helper's deadline ends its whole process group, so a child the
    /// plugin forked cannot keep spinning after the helper is gone.
    #[cfg(unix)]
    #[test]
    fn a_helper_deadline_also_ends_the_plugins_forked_child() {
        use std::os::unix::process::{CommandExt, ExitStatusExt};

        let fixture = build_hostile_clap("fork");
        let fork_pid_file =
            std::env::temp_dir().join(format!("sourdaw-forked-child-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![fork_pid_file.clone()]);
        let mut helper =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        helper
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::group_deadline_helper_child")
            .env(GROUP_HELPER_PLUGIN_ENV, &fixture.plugin_path)
            .env("SOURDAW_TEST_PLUGIN_FORK_PID_FILE", &fork_pid_file)
            .env(TEST_HELPER_DEADLINE_MS_ENV, "1000")
            .env_remove(SCAN_PARENT_PID_ENV)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        stragglers
            .children
            .push(helper.spawn().expect("the forking helper should start"));

        let forked = read_pid_within(&fork_pid_file, Duration::from_secs(10))
            .expect("the plugin should fork its child and record its pid");
        stragglers.pids.push(forked);
        let status = stragglers
            .children
            .first_mut()
            .and_then(|child| exit_status_within(child, Duration::from_secs(5)));

        // The group kill and the `_exit` after it race for the helper itself,
        // so either end is the deadline's; the forked child is the proof.
        assert!(
            status.is_some_and(|status| status.signal() == Some(libc::SIGKILL)
                || status.code() == Some(HELPER_DEADLINE_EXIT_CODE)),
            "the helper must end at its deadline: {status:?}"
        );
        assert!(
            process_has_exited_within(forked, Duration::from_secs(2)),
            "the plugin's forked child {forked} outlived its helper"
        );
    }

    /// The Windows parent watch exits only on proof the parent is gone; a
    /// watch that cannot tell leaves the decision to the deadline.
    #[test]
    fn only_proof_of_a_gone_parent_reads_as_gone() {
        let cases = [
            (
                ParentObservation::OpenFailed(ParentOpenFailure::NoSuchProcess),
                false,
            ),
            (
                ParentObservation::OpenFailed(ParentOpenFailure::Other),
                true,
            ),
            (ParentObservation::Waited(ParentWaitOutcome::Exited), false),
            (ParentObservation::Waited(ParentWaitOutcome::Running), true),
            (ParentObservation::Waited(ParentWaitOutcome::Failed), true),
        ];
        for (observation, alive) in cases {
            assert_eq!(parent_alive_from(observation), alive, "{observation:?}");
        }
    }

    /// Whether this process's child `pid` has exited within `window`, reaping
    /// it here. A child someone else already reaped (`ECHILD`) has exited too.
    #[cfg(unix)]
    fn child_has_exited_within(pid: i32, window: Duration) -> bool {
        let deadline = Instant::now() + window;
        loop {
            let mut status = 0;
            // SAFETY: waitpid with WNOHANG takes plain values and a valid
            // out-pointer, and never blocks.
            let reaped = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            if reaped == pid {
                return true;
            }
            if reaped == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD)
            {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Stopping kills the live helper, and neither the scan that was waiting
    /// on it nor one started afterwards ever answers: both threads park, so
    /// the walk can never publish a stopped scan. Their parked threads are
    /// deliberately left for this test process's exit to end.
    #[cfg(unix)]
    #[test]
    fn a_stopped_scan_kills_its_helpers_and_never_answers() {
        let registry = std::sync::Arc::new(HelperRegistry::new());
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-stopped-helper-{}", uuid::Uuid::new_v4()));
        let never_spawned =
            std::env::temp_dir().join(format!("sourdaw-never-spawned-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone(), never_spawned.clone()]);
        let (sender, receiver) = std::sync::mpsc::channel();
        let scanning = std::sync::Arc::clone(&registry);
        let hanging_pid_file = pid_file.clone();
        std::thread::spawn(move || {
            let mut command = Command::new("sh");
            command
                .args(["-c", "echo $$ > \"$0\"; exec sleep 30"])
                .arg(&hanging_pid_file);
            let _ = sender.send(run_bounded_in(&scanning, &mut command, WORKER_TIMEOUT));
        });
        let helper = read_pid_within(&pid_file, Duration::from_secs(5))
            .expect("the hanging helper should start and write its pid");
        stragglers.pids.push(helper);

        registry.stop();

        assert!(
            child_has_exited_within(helper, Duration::from_secs(2)),
            "the stopped helper {helper} is still alive"
        );
        assert!(
            matches!(
                receiver.recv_timeout(Duration::from_millis(500)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "the scan that was waiting on a stopped helper must never answer"
        );

        let (later_sender, later_receiver) = std::sync::mpsc::channel();
        let later_registry = std::sync::Arc::clone(&registry);
        let marker = never_spawned.clone();
        std::thread::spawn(move || {
            let mut later = Command::new("sh");
            later.args(["-c", "touch \"$0\""]).arg(&marker);
            let _ = later_sender.send(run_bounded_in(&later_registry, &mut later, WORKER_TIMEOUT));
        });
        assert!(
            matches!(
                later_receiver.recv_timeout(Duration::from_millis(500)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "a scan started after stop must never answer"
        );
        assert!(
            !never_spawned.exists(),
            "a helper asked for after stop must never start"
        );
    }

    #[test]
    fn the_watchdog_decides_from_its_parent_first_then_its_clock() {
        let deadline = Duration::from_secs(1);
        let cases = [
            (
                Duration::ZERO,
                false,
                WatchdogVerdict::Terminate(HELPER_PARENT_GONE_EXIT_CODE),
            ),
            (
                deadline,
                false,
                WatchdogVerdict::Terminate(HELPER_PARENT_GONE_EXIT_CODE),
            ),
            (
                deadline,
                true,
                WatchdogVerdict::Terminate(HELPER_DEADLINE_EXIT_CODE),
            ),
            (
                deadline * 2,
                true,
                WatchdogVerdict::Terminate(HELPER_DEADLINE_EXIT_CODE),
            ),
            (Duration::ZERO, true, WatchdogVerdict::KeepWaiting),
            (deadline / 2, true, WatchdogVerdict::KeepWaiting),
        ];
        for (elapsed, parent_alive, expected) in cases {
            assert_eq!(
                watchdog_verdict(elapsed, deadline, parent_alive),
                expected,
                "elapsed {elapsed:?}, parent alive {parent_alive}"
            );
        }
    }

    #[test]
    fn the_watchdog_terminates_once_its_parent_is_gone() {
        let probes = std::cell::Cell::new(0);
        let terminated = std::cell::Cell::new(None);

        let code = watch_helper_lifetime(
            Duration::from_secs(60),
            || {
                probes.set(probes.get() + 1);
                probes.get() < 3
            },
            |code| terminated.set(Some(code)),
        );

        assert_eq!(code, HELPER_PARENT_GONE_EXIT_CODE);
        assert_eq!(terminated.get(), Some(HELPER_PARENT_GONE_EXIT_CODE));
        assert_eq!(
            probes.get(),
            3,
            "the watchdog keeps waiting while the parent lives"
        );
    }

    #[test]
    fn the_watchdog_terminates_at_its_deadline_with_its_parent_alive() {
        let terminated = std::cell::Cell::new(None);

        let code = watch_helper_lifetime(
            Duration::from_millis(120),
            || true,
            |code| terminated.set(Some(code)),
        );

        assert_eq!(code, HELPER_DEADLINE_EXIT_CODE);
        assert_eq!(terminated.get(), Some(HELPER_DEADLINE_EXIT_CODE));
    }

    #[cfg(unix)]
    #[test]
    fn watchdog_exits_sit_above_every_spawner_bound_and_read_as_process_failures() {
        assert!(HELPER_DEADLINE > WORKER_TIMEOUT);
        assert_ne!(HELPER_DEADLINE_EXIT_CODE, HELPER_PARENT_GONE_EXIT_CODE);
        for code in [HELPER_DEADLINE_EXIT_CODE, HELPER_PARENT_GONE_EXIT_CODE] {
            let failure = process_failure(
                Path::new("/plugins/Wedged.clap"),
                &exit_status_for_code(code),
            );
            assert!(failure.is_process_failure(), "exit {code}: {failure}");
        }
    }

    /// The only two shapes crash quarantine exists to catch.
    #[test]
    fn is_process_failure_recognizes_exit_and_timeout_errors() {
        assert!(exited_unsuccessfully("/plugins/Broken.clap").is_process_failure());
        assert!(ScanFailure::TimedOut.is_process_failure());
        assert!(tampered("/plugins/Hostile.clap").is_process_failure());
    }

    fn exited_unsuccessfully(path: &str) -> ScanFailure {
        ScanFailure::ExitedUnsuccessfully {
            path: PathBuf::from(path),
        }
    }

    fn tampered(path: &str) -> ScanFailure {
        ScanFailure::ResponseTampered {
            path: PathBuf::from(path),
        }
    }

    fn write_refused(path: &str) -> ScanFailure {
        ScanFailure::ResponseWriteRefused {
            path: PathBuf::from(path),
        }
    }

    /// The text of every variant is the message the registry and the renderer
    /// have always received. The expectations are the pre-enum format strings,
    /// written out in full so a rewording fails here.
    #[test]
    fn display_reproduces_each_historical_message_byte_for_byte() {
        assert_eq!(
            exited_unsuccessfully("/plugins/Broken.clap").to_string(),
            "Plugin scan helper exited unsuccessfully for /plugins/Broken.clap"
        );
        assert_eq!(
            ScanFailure::TimedOut.to_string(),
            "Plugin scan helper timed out"
        );
        assert_eq!(
            tampered("/plugins/Hostile.clap").to_string(),
            "Plugin scan helper response was not a regular file for /plugins/Hostile.clap"
        );
        assert_eq!(
            ScanFailure::ResponseOverLimit { bytes: 700_000 }.to_string(),
            "Plugin scan helper response of 700000 bytes exceeded the scan helper's 16777216-byte limit"
        );
        assert_eq!(
            write_refused("/plugins/X.clap").to_string(),
            "Plugin scan helper could not write its response for /plugins/X.clap; the scan helper's response limit is 16777216 bytes"
        );
        assert_eq!(
            ScanFailure::Refused("No plugin scan backend for format vst2".to_string()).to_string(),
            "No plugin scan backend for format vst2"
        );
        assert_eq!(
            oversized_response_error(1),
            ScanFailure::ResponseOverLimit { bytes: 1 }.to_string()
        );
    }

    /// Each variant answers both classification questions exactly as the
    /// prefix match it replaced did.
    #[test]
    fn classification_is_decided_per_variant() {
        let cases = [
            (exited_unsuccessfully("/p.clap"), true, false),
            (ScanFailure::TimedOut, true, false),
            (tampered("/p.clap"), true, false),
            (ScanFailure::ResponseOverLimit { bytes: 1 }, false, true),
            (write_refused("/p.clap"), false, true),
            (ScanFailure::Refused("deadline".to_string()), false, false),
        ];
        for (failure, process, limit) in cases {
            assert_eq!(failure.is_process_failure(), process, "{failure}");
            assert_eq!(failure.is_response_limit_refusal(), limit, "{failure}");
        }
    }

    /// A refusal whose text merely resembles a classified message is still
    /// data-level: classification reads the variant, never the text.
    #[test]
    fn a_refusal_that_reads_like_a_process_failure_is_not_one() {
        let failure = ScanFailure::Refused("Plugin scan helper timed out".to_string());

        assert!(!failure.is_process_failure());
        assert!(!failure.is_response_limit_refusal());
    }

    /// A response the stand-in helper `script` leaves behind, read through the
    /// real `scan_worker` path. Worker arguments arrive as `$1..$n`; the
    /// response path is the last. The call runs on its own thread with a
    /// bound, so a read that blocks fails the test instead of hanging it.
    #[cfg(unix)]
    fn scan_with_stand_in_helper(script: String) -> Result<Vec<ScannedDescriptor>, ScanFailure> {
        let launcher = ScanWorkerCommand {
            program: PathBuf::from("/bin/sh"),
            args: vec![
                "-c".to_string(),
                format!("eval \"out=\\${{$#}}\"\n{script}"),
                "sh".to_string(),
            ],
            env: BTreeMap::new(),
        };
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(scan_worker_with::<Vec<ScannedDescriptor>>(
                &launcher,
                PluginFormat::Clap,
                Path::new("/plugins/Stand-in.clap"),
                None,
                WORKER_TIMEOUT,
                WORKER_ARGUMENT,
            ));
        });
        receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("the scan must return instead of blocking on the response")
    }

    /// A response `scan_worker` accepts: a pid that is not this process's.
    #[cfg(unix)]
    const VALID_RESPONSE: &str = r#"{"worker_pid":1,"result":{"Ok":[]}}"#;

    /// An `Err` the helper reports in its response is the plugin's own text.
    /// Whatever it says, it is a data-level refusal: classification reads the
    /// variant, so a plugin that echoes a classified message cannot get itself
    /// quarantined or its row blamed on the helper's limit.
    #[cfg(unix)]
    #[test]
    fn a_reported_error_that_reads_like_a_classified_message_stays_data_level() {
        // No apostrophe: the payload travels inside a single-quoted shell string.
        for text in [
            "Plugin scan helper timed out",
            "Plugin scan helper response of 1 bytes exceeded the limit",
        ] {
            let response = format!(r#"{{"worker_pid":1,"result":{{"Err":"{text}"}}}}"#);

            let failure =
                scan_with_stand_in_helper(format!("printf '%s' '{response}' > \"$out\"\nexit 0"))
                    .expect_err("a reported error must be returned as a failure");

            assert_eq!(failure, ScanFailure::Refused(text.to_string()));
            assert!(!failure.is_process_failure(), "{failure}");
            assert!(!failure.is_response_limit_refusal(), "{failure}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_healthy_response_is_read() {
        let result =
            scan_with_stand_in_helper(format!("printf '%s' '{VALID_RESPONSE}' > \"$out\"\nexit 0"));

        assert_eq!(result, Ok(Vec::new()));
    }

    /// A FIFO at the response path would block an ordinary open forever, and
    /// only the plugin could have put it there.
    #[cfg(unix)]
    #[test]
    fn a_fifo_response_is_refused_promptly_as_a_process_failure() {
        let error =
            scan_with_stand_in_helper("rm -f \"$out\"\nmkfifo \"$out\"\nexit 0".to_string())
                .expect_err("a FIFO response must be refused");

        assert!(error.is_process_failure(), "{error}");
    }

    /// The symlink's target is a valid response, so the refusal is the link
    /// itself and not a parse failure.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_response_is_refused_as_a_process_failure() {
        let error = scan_with_stand_in_helper(format!(
            "printf '%s' '{VALID_RESPONSE}' > \"$out.real\"\nln -s \"$out.real\" \"$out\"\nexit 0"
        ))
        .expect_err("a symlinked response must be refused");

        assert!(error.is_process_failure(), "{error}");
    }

    /// An oversized regular file is the helper's limit, not tampering.
    #[cfg(unix)]
    #[test]
    fn an_oversized_response_is_a_limit_refusal_not_a_process_failure() {
        let error = scan_with_stand_in_helper(format!(
            "dd if=/dev/zero of=\"$out\" bs=1 count=0 seek={} 2>/dev/null\nexit 0",
            MAX_RESPONSE_BYTES + 1
        ))
        .expect_err("an oversized response must be refused");

        assert!(error.is_response_limit_refusal(), "{error}");
        assert!(!error.is_process_failure(), "{error}");
    }

    /// A real `ExitStatus` for a process that exited with `code`, obtained
    /// cheaply through `sh` rather than the real worker binary or a compiled
    /// hostile CLAP fixture — nothing here depends on what actually crashed.
    #[cfg(unix)]
    fn exit_status_for_code(code: i32) -> ExitStatus {
        Command::new("sh")
            .args(["-c", &format!("exit {code}")])
            .status()
            .expect("sh should run")
    }

    /// The hardening this exit code exists for (#2911): a systemic fault that
    /// stops the worker from writing *any* response — a full disk, a
    /// read-only temp directory — must not read as a crashing plugin, or a
    /// single bad environment quarantines every candidate the process ever
    /// touches on one scan.
    #[cfg(unix)]
    #[test]
    fn a_response_write_refusal_is_not_a_process_failure() {
        let path = Path::new("/plugins/Innocent.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        let message = process_failure(path, &status);

        assert!(
            !message.is_process_failure(),
            "a response-write refusal must never be classified as a process failure: {message}"
        );
    }

    /// The other half: every other non-zero exit — a crash, `Malformed`, no
    /// backend — must keep classifying as a process failure exactly as
    /// before this exit code existed.
    #[cfg(unix)]
    #[test]
    fn any_other_nonzero_exit_still_reads_as_a_process_failure() {
        let path = Path::new("/plugins/Hostile.clap");
        let status = exit_status_for_code(2);

        let message = process_failure(path, &status);

        assert!(
            message.is_process_failure(),
            "a crash's exit code must still quarantine the binary: {message}"
        );
    }

    /// A data-level refusal says the read failed, not that the process itself
    /// crashed or hung — never a reason to quarantine the binary.
    #[test]
    fn is_process_failure_rejects_data_level_refusals() {
        for message in [
            "No plugin scan backend for format vst2",
            "Plugin scan helper returned invalid metadata: EOF",
            "Cannot start plugin scan helper: denied",
        ] {
            assert!(!ScanFailure::Refused(message.to_string()).is_process_failure());
        }
        assert!(!ScanFailure::ResponseOverLimit {
            bytes: MAX_RESPONSE_BYTES as usize
        }
        .is_process_failure());
    }

    /// One `ScannedParameterDescriptor` at the scanner's own text caps: a
    /// 128-byte name beside a 128-byte module, a full-width id, three
    /// full-width floats, every boolean set. The largest single descriptor any
    /// scan can legally produce.
    fn maximal_parameter(id: u32) -> ScannedParameterDescriptor {
        ScannedParameterDescriptor {
            id,
            name: "n".repeat(128),
            module: Some("m".repeat(128)),
            min_value: f64::MIN,
            max_value: f64::MAX,
            default_value: 1.0,
            is_automatable: true,
            is_modulatable: true,
            is_stepped: true,
            is_enum: true,
        }
    }

    fn maximal_instance_response() -> (WorkerResponse<ScannedInstance>, usize) {
        let response = WorkerResponse {
            worker_pid: std::process::id().wrapping_add(1),
            result: Ok(ScannedInstance {
                parameters: (0..MAX_RESPONSE_PARAMETERS as u32)
                    .map(maximal_parameter)
                    .collect(),
                capabilities: ScannedInstanceCapabilities::default(),
            }),
        };
        let bytes = serde_json::to_vec(&response)
            .expect("a maximal instance response should serialize")
            .len();
        (response, bytes)
    }

    /// The measurement [`MAX_RESPONSE_BYTES`] is sized from, enforced rather
    /// than trusted: a parameter list at the policy ceiling
    /// ([`MAX_RESPONSE_PARAMETERS`]), every descriptor maximal, must fit under
    /// the cap with at least twofold headroom. Mutation this catches: growing
    /// the descriptors' serialized shape, or shrinking the cap below what this
    /// build's own scanner can emit.
    #[test]
    fn the_response_limit_admits_the_stated_worst_case_parameter_list() {
        let (_, bytes) = maximal_instance_response();
        let bytes = bytes as u64;

        assert!(
            bytes <= MAX_RESPONSE_BYTES,
            "the measured worst case ({MAX_RESPONSE_PARAMETERS} maximal descriptors, \
             {bytes} bytes compact) must fit the response cap of {MAX_RESPONSE_BYTES}"
        );
        assert!(
            bytes * 2 <= MAX_RESPONSE_BYTES,
            "the cap must keep headroom above the measured worst case: \
             {bytes} bytes doubled already exceeds {MAX_RESPONSE_BYTES}"
        );
    }

    /// #3866: a parameter list over the FORMER 256 KiB cap is written whole.
    /// Before the cap was resized, this response was refused, the helper exited
    /// 3, and the registry row was stored as if the plugin had never answered.
    /// Mutation this catches: restoring the old cap fails the write below.
    #[test]
    fn a_parameter_list_over_the_former_cap_is_written_in_full() {
        const FORMER_MAX_RESPONSE_BYTES: u64 = 256 * 1024;
        let parameter_count = 2_048u32;
        let response = WorkerResponse {
            worker_pid: std::process::id().wrapping_add(1),
            result: Ok(ScannedInstance {
                parameters: (0..parameter_count).map(maximal_parameter).collect(),
                capabilities: ScannedInstanceCapabilities::default(),
            }),
        };
        let expected_len = serde_json::to_vec(&response)
            .expect("the response should serialize")
            .len();
        assert!(
            expected_len as u64 > FORMER_MAX_RESPONSE_BYTES,
            "the synthetic list must exceed the former cap for this test to prove \
             anything: {expected_len} bytes"
        );

        let directory =
            ResponseDirectory::create().expect("the response directory should be created");
        let response_path = directory.0.join("metadata.json");

        write_response(&response_path, &response)
            .expect("a parameter list over the former cap must be written in full");

        let written = fs::read(&response_path).expect("the written response should be readable");
        assert_eq!(written.len(), expected_len);
        let parsed: WorkerResponse<ScannedInstance> =
            serde_json::from_slice(&written).expect("the written response should parse");
        let scanned = parsed
            .result
            .expect("the response should carry the instance");
        assert_eq!(
            scanned.parameters.len(),
            parameter_count as usize,
            "every parameter must survive the response"
        );
        assert_eq!(
            scanned.parameters.last().expect("a non-empty list").id,
            parameter_count - 1,
            "the last parameter must be the real one, not a truncated remnant"
        );
    }

    /// The exit-3 refusal is the helper's own limit, named as such: the
    /// supervisor message carries the limit, never reads as plugin silence,
    /// and is classified as a response-limit refusal rather than a process
    /// failure (#2911's distinction, #3866's wording).
    #[cfg(unix)]
    #[test]
    fn a_response_write_refusal_names_the_helpers_limit() {
        let path = Path::new("/plugins/Innocent.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        let message = process_failure(path, &status);

        assert!(
            message
                .to_string()
                .contains(&MAX_RESPONSE_BYTES.to_string()),
            "the refusal must name the helper's limit so the plugin is not blamed \
             for its silence: {message}"
        );
        assert!(
            !message.is_process_failure(),
            "a response-write refusal must never be classified as a process failure: {message}"
        );
        assert!(message.is_response_limit_refusal());
    }

    /// The oversized-response refusal carries the one number the refusing side
    /// can actually measure, and classifies as the helper's limit.
    #[test]
    fn an_oversized_response_refusal_names_the_size_and_the_helpers_limit() {
        let error = ScanFailure::ResponseOverLimit { bytes: 700_000 };

        assert!(
            error.to_string().contains("700000")
                && error.to_string().contains(&MAX_RESPONSE_BYTES.to_string()),
            "the refusal must name both the measured size and the helper's limit: {error}"
        );
        assert!(
            !error.is_process_failure(),
            "a limit refusal is data-level, never quarantine evidence: {error}"
        );
        assert!(error.is_response_limit_refusal());
    }

    /// Only the helper's own limit refusals classify as such — a timeout, a
    /// crash, or any other refusal must keep its own classification.
    #[test]
    fn only_the_helpers_own_limit_refusals_are_response_limit_refusals() {
        assert!(write_refused("/plugins/X.clap").is_response_limit_refusal());
        assert!(ScanFailure::ResponseOverLimit { bytes: 1 }.is_response_limit_refusal());
        assert!(!ScanFailure::TimedOut.is_response_limit_refusal());
        assert!(!exited_unsuccessfully("/plugins/Broken.clap").is_response_limit_refusal());
        assert!(!ScanFailure::Refused("deadline".to_string()).is_response_limit_refusal());
    }
}
