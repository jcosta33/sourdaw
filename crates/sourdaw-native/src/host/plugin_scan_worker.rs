use crate::host::runtime_scope::RuntimeScopeRefusal;
use daw_plugin_host::scanner::{
    extract_clap_instance_metadata, extract_clap_metadata, ClapDescriptorMetadata, PluginFormat,
    ScanError, ScannedDescriptor, ScannedInstance,
};
use daw_plugin_host::vst3_scanner::{
    extract_vst3_instance_metadata, extract_vst3_metadata, Vst3ScanError,
};
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

/// The trusted process the application starts between itself and each Unix
/// helper, re-entering the helper's own executable: the marker is followed by
/// the helper's whole command line. It runs no plugin code. It spawns the
/// helper, watches the application through a socket only the application
/// holds the other end of, and after the helper's exit or the application's
/// end kills every process the helper's tree left (see
/// [`supervise_helper_tree`]).
const TREE_SUPERVISOR_ARGUMENT: &str = "--sourdaw-plugin-scan-tree-supervisor";
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
/// On Unix that parent is the tree supervisor, which overrides the
/// application's value with its own pid.
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
    /// The helper child exited with a non-zero status, including a
    /// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] the supervisor could not confirm.
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
    /// The helper reported that it could not write its response, and the
    /// supervisor's own write into the same directory failed with a storage
    /// fault; see [`process_failure`].
    ResponseWriteRefused { path: PathBuf },
    /// No scan backend is registered for the format.
    NoBackend { format: PluginFormat },
    /// The default launcher, this executable, could not be resolved.
    LauncherUnresolvable { cause: String },
    /// [`SCAN_WORKER_COMMAND_ENV`] did not parse as a command.
    LauncherInvalid { cause: String },
    /// [`SCAN_WORKER_COMMAND_ENV`] parsed but names an empty program.
    LauncherNamesNoProgram,
    /// [`SCAN_WORKER_COMMAND_ENV`] is not valid UTF-8.
    LauncherNotUtf8,
    /// The runtime scope that holds response directories refused.
    Scope(RuntimeScopeRefusal),
    /// The private response directory could not be created.
    ResponseDirectoryUncreatable { cause: String },
    /// The private response directory could not be pinned.
    ResponseDirectoryUnopenable { cause: String },
    /// The helper, or its tree supervisor, could not be spawned.
    HelperUnstartable { cause: String },
    /// The helper's exit could not be observed.
    HelperUnobservable { cause: String },
    /// The tree supervisor ended before it said it was spawning the helper.
    SupervisorEndedEarly,
    /// The response file could not be opened or read.
    ResponseUnreadable { cause: String },
    /// The helper exited cleanly without leaving a response.
    NoResponse { cause: String },
    /// The response did not parse as the helper's envelope.
    ResponseInvalid { cause: String },
    /// The response names this process as its writer.
    SameProcess,
    /// Text this module does not generate: the error the helper reported in
    /// its response (the plugin's own), or a caller's refusal.
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
            Self::NoBackend { format } => write!(
                formatter,
                "No plugin scan backend for format {}",
                format.wire_name()
            ),
            Self::LauncherUnresolvable { cause } => write!(
                formatter,
                "Cannot resolve plugin scan helper executable: {cause}"
            ),
            Self::LauncherInvalid { cause } => write!(
                formatter,
                "{SCAN_WORKER_COMMAND_ENV} is not a valid command: {cause}"
            ),
            Self::LauncherNamesNoProgram => {
                write!(formatter, "{SCAN_WORKER_COMMAND_ENV} names no program")
            }
            Self::LauncherNotUtf8 => write!(formatter, "{SCAN_WORKER_COMMAND_ENV} is not valid UTF-8"),
            Self::Scope(refusal) => refusal.fmt(formatter),
            Self::ResponseDirectoryUncreatable { cause } => write!(
                formatter,
                "Cannot create plugin scan response directory: {cause}"
            ),
            Self::ResponseDirectoryUnopenable { cause } => write!(
                formatter,
                "Cannot open plugin scan response directory: {cause}"
            ),
            Self::HelperUnstartable { cause } => {
                write!(formatter, "Cannot start plugin scan helper: {cause}")
            }
            Self::HelperUnobservable { cause } => {
                write!(formatter, "Cannot observe plugin scan helper: {cause}")
            }
            Self::SupervisorEndedEarly => {
                formatter.write_str("Plugin scan tree supervisor ended before it started a helper")
            }
            Self::ResponseUnreadable { cause } => {
                write!(formatter, "Cannot read plugin scan helper response: {cause}")
            }
            Self::NoResponse { cause } => {
                write!(formatter, "Plugin scan helper returned no metadata: {cause}")
            }
            Self::ResponseInvalid { cause } => {
                write!(formatter, "Plugin scan helper returned invalid metadata: {cause}")
            }
            Self::SameProcess => formatter
                .write_str("Plugin metadata extraction did not cross a process boundary"),
            Self::Refused(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ScanFailure {}

impl From<RuntimeScopeRefusal> for ScanFailure {
    fn from(refusal: RuntimeScopeRefusal) -> Self {
        Self::Scope(refusal)
    }
}

/// The leaf worker's exit code when it could not create or write its
/// response file.
///
/// Distinct from the generic non-zero exit ([`WorkerRole::Malformed`], no
/// backend for the format) on purpose: those and a crashing plugin all share
/// exit code 2 and are indistinguishable from here, which is fine because
/// every one of them is either a genuine process failure or a caller error
/// that never reaches a real plugin. A response-write refusal is neither — it
/// can fire for every candidate in one scan on a systemic fault (a full disk,
/// an exhausted quota, a filesystem gone read-only) that has nothing to do
/// with any plugin being dangerous, and folding it into the same exit code as
/// a crash would quarantine every binary the process ever touched.
///
/// The code alone proves nothing, though: the plugin runs inside the helper
/// and can call `exit(3)` itself (#6662). [`process_failure`] therefore keeps
/// the refusal class only when the supervisor's own write into the same
/// directory fails with a storage fault too; an exit 3 without that is a
/// process failure and quarantines.
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
    fn from_current_exe() -> Result<Self, ScanFailure> {
        Ok(Self {
            program: std::env::current_exe().map_err(|error| {
                ScanFailure::LauncherUnresolvable {
                    cause: error.to_string(),
                }
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
    fn from_json(declared: &str) -> Result<Self, ScanFailure> {
        let command: Self =
            serde_json::from_str(declared).map_err(|error| ScanFailure::LauncherInvalid {
                cause: error.to_string(),
            })?;
        if command.program.as_os_str().is_empty() {
            return Err(ScanFailure::LauncherNamesNoProgram);
        }
        Ok(command)
    }

    /// Read the host's declaration, or fall back to re-execution.
    fn resolve() -> Result<Self, ScanFailure> {
        let Some(declared) = std::env::var_os(SCAN_WORKER_COMMAND_ENV) else {
            return Self::from_current_exe();
        };
        let declared = declared.to_str().ok_or(ScanFailure::LauncherNotUtf8)?;
        Self::from_json(declared)
    }
}
#[derive(Serialize, Deserialize)]
struct WorkerResponse<T> {
    worker_pid: u32,
    result: Result<T, String>,
}
/// The private directory one helper writes its response into.
///
/// `pin` is the supervisor's own handle on the directory it created. The
/// plugin runs in the helper, is handed this path, and may rename the
/// directory or leave a symlink in its place before it exits; the pin is what
/// keeps [`ResponseDirectory::probe_write`] checking the directory the
/// supervisor made rather than whatever the path names by then. On Unix the
/// probe creates through the pinned descriptor; on Windows the pin is opened
/// without delete sharing, so the directory cannot be renamed or removed while
/// it is held. It is `None` only on platforms that have neither.
struct ResponseDirectory {
    path: PathBuf,
    pin: Option<fs::File>,
}
#[test]
fn scoped_scan_response_directory() {
    crate::host::runtime_scope::RuntimeScope::test_in_process(
        concat!(module_path!(), "::scoped_scan_response_directory"),
        |root| {
            let directory = ResponseDirectory::create().unwrap();
            let path = directory.path.clone();
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
        || {
            assert!(matches!(
                ResponseDirectory::create(),
                Err(ScanFailure::Scope(RuntimeScopeRefusal::Invalid))
            ))
        },
    );
}
impl ResponseDirectory {
    fn create() -> Result<Self, ScanFailure> {
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
            .map_err(|error| ScanFailure::ResponseDirectoryUncreatable {
                cause: error.to_string(),
            })?;
        // Owned before the pin is opened, so a refused pin still removes the
        // directory on the way out.
        let mut directory = Self { path, pin: None };
        directory.pin = pin_directory(&directory.path).map_err(|error| {
            ScanFailure::ResponseDirectoryUnopenable {
                cause: error.to_string(),
            }
        })?;
        Ok(directory)
    }

    /// Write a small file of the supervisor's own into this directory and
    /// flush it to storage, so a full disk shows here and not only on a later
    /// writeback.
    fn probe_write(&self) -> std::io::Result<()> {
        let name = format!("write-probe-{}", uuid::Uuid::new_v4());
        let mut probe = self.create_probe(&name)?;
        probe.write_all(b"probe")?;
        probe.sync_all()
    }

    /// Bytes an unprivileged writer can still use on the pinned directory's
    /// volume, or `None` when that cannot be read.
    #[cfg(unix)]
    fn available_bytes(&self) -> Option<u64> {
        use std::os::fd::AsRawFd;
        let pin = self.pin.as_ref()?;
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: the pinned descriptor is open for as long as `self`, and
        // `stats` is writable storage for exactly one `statvfs`.
        if unsafe { libc::fstatvfs(pin.as_raw_fd(), stats.as_mut_ptr()) } != 0 {
            return None;
        }
        // SAFETY: `fstatvfs` returned 0, so it filled `stats`.
        let stats = unsafe { stats.assume_init() };
        Some(widened(stats.f_bavail).saturating_mul(widened(stats.f_frsize)))
    }

    #[cfg(not(unix))]
    fn available_bytes(&self) -> Option<u64> {
        None
    }

    #[cfg(unix)]
    fn create_probe(&self, name: &str) -> std::io::Result<fs::File> {
        use std::os::fd::{AsRawFd, FromRawFd};
        let pin = self
            .pin
            .as_ref()
            .ok_or_else(|| std::io::Error::other("the response directory is not pinned"))?;
        let name = std::ffi::CString::new(name).map_err(std::io::Error::other)?;
        // SAFETY: the pinned descriptor is open for as long as `self`, `name`
        // is a NUL-terminated string that outlives the call, and the mode is
        // the variadic argument O_CREAT requires.
        let descriptor = unsafe {
            libc::openat(
                pin.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600 as libc::c_uint,
            )
        };
        if descriptor < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: `descriptor` was just opened by this call and nothing else
        // owns it.
        Ok(unsafe { fs::File::from_raw_fd(descriptor) })
    }

    #[cfg(not(unix))]
    fn create_probe(&self, name: &str) -> std::io::Result<fs::File> {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.path.join(name))
    }
}

/// A `statvfs` count as `u64`. The field widths differ by platform — macOS
/// counts blocks in 32 bits, Linux in 64 — so a direct conversion is a no-op
/// on one of them and a lint there.
#[cfg(unix)]
fn widened(count: impl Into<u64>) -> u64 {
    count.into()
}

#[cfg(unix)]
fn pin_directory(path: &Path) -> std::io::Result<Option<fs::File>> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map(Some)
}

#[cfg(windows)]
fn pin_directory(path: &Path) -> std::io::Result<Option<fs::File>> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map(Some)
}

#[cfg(not(any(unix, windows)))]
fn pin_directory(_path: &Path) -> std::io::Result<Option<fs::File>> {
    Ok(None)
}

impl Drop for ResponseDirectory {
    fn drop(&mut self) {
        // The Windows pin forbids removing the directory while it is open.
        drop(self.pin.take());
        let _ = fs::remove_dir_all(&self.path);
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
    descriptor: fn(&Path) -> Result<Vec<ScannedDescriptor>, BackendError>,
    /// Create one live-but-unactivated instance of the plugin `plugin_id`
    /// names in the file, and read its parameter contract and capability
    /// extensions.
    instance: fn(&Path, plugin_id: &str) -> Result<ScannedInstance, BackendError>,
}

/// A format backend's refusal, as the helper reports it in its response.
#[derive(Debug)]
enum BackendError {
    Clap(ScanError),
    Vst3(Vst3ScanError),
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Clap(error) => error.fmt(formatter),
            Self::Vst3(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for BackendError {}

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
                extract_clap_metadata(path)
                    .map(|bundle| {
                        bundle
                            .into_iter()
                            .map(ClapDescriptorMetadata::into_scanned_descriptor)
                            .collect()
                    })
                    .map_err(BackendError::Clap)
            },
            instance: |path, plugin_id| {
                extract_clap_instance_metadata(path, plugin_id).map_err(BackendError::Clap)
            },
        }),
        PluginFormat::Vst3 => Some(FormatScanBackend {
            descriptor: |path| {
                extract_vst3_metadata(path)
                    .map(|metadata| vec![metadata.into_scanned_descriptor()])
                    .map_err(BackendError::Vst3)
            },
            // VST3's extractor resolves its own class from the bundle, so the
            // selector adds nothing there — and its descriptor pass declares
            // exactly one row, so only one instance is ever asked for.
            instance: |path, _plugin_id| {
                extract_vst3_instance_metadata(path).map_err(BackendError::Vst3)
            },
        }),
        PluginFormat::Vst2 | PluginFormat::AudioUnit => None,
    }
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
    /// Supervise the helper whose whole command line, program first, follows
    /// the tree supervisor marker.
    SuperviseTree { helper: &'args [OsString] },
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
///
/// The first marker decides. The tree supervisor's command line carries the
/// helper's after its own marker, worker marker included, so the supervisor
/// marker is the one found first there and nowhere else: the application puts
/// it only in front of a helper command line it built itself.
fn worker_role(args: &[OsString]) -> Option<WorkerRole<'_>> {
    let marker_index = args.iter().skip(1).position(|argument| {
        argument == std::ffi::OsStr::new(WORKER_ARGUMENT)
            || argument == std::ffi::OsStr::new(INSTANCE_WORKER_ARGUMENT)
            || argument == std::ffi::OsStr::new(TREE_SUPERVISOR_ARGUMENT)
    })? + 1;
    if args[marker_index] == std::ffi::OsStr::new(TREE_SUPERVISOR_ARGUMENT) {
        let helper = &args[marker_index + 1..];
        if helper.is_empty() {
            return Some(WorkerRole::Malformed);
        }
        return Some(WorkerRole::SuperviseTree { helper });
    }
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
        WorkerRole::SuperviseTree { helper } => return Some(supervise_helper_tree(helper)),
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
    adopt_orphaned_descendants();
    arm_helper_watchdog(helper_deadline());
    let result = match plugin_id {
        Some(plugin_id) => write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: (backend.instance)(Path::new(plugin_path), plugin_id)
                    .map_err(|error| error.to_string()),
            },
        ),
        None => write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: (backend.descriptor)(Path::new(plugin_path))
                    .map_err(|error| error.to_string()),
            },
        ),
    };
    kill_own_descendants();
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
    // Read now, before any plugin code runs: plugin code may move this process
    // out of its group, and the group it led still holds the plugin's children.
    let leads_group = leads_own_process_group();
    let _ = std::thread::Builder::new()
        .name("sourdaw-scan-helper-watchdog".to_string())
        .spawn(move || {
            watch_helper_lifetime(deadline, parent_alive, |code| {
                terminate_current_process(code, leads_group);
            });
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

/// Whether this process leads its own process group, which every helper a
/// spawner starts does.
#[cfg(unix)]
fn leads_own_process_group() -> bool {
    // SAFETY: getpid has no preconditions and cannot fail.
    let pid = unsafe { libc::getpid() };
    // SAFETY: getpgrp has no preconditions and cannot fail.
    let group = unsafe { libc::getpgrp() };
    group == pid
}

#[cfg(not(unix))]
fn leads_own_process_group() -> bool {
    false
}

/// End this process now, from any thread, without running exit handlers or
/// static destructors a wedged plugin may hold a lock inside, and without
/// the crash report an abort would file against the plugin's host.
///
/// `leads_group` is what [`leads_own_process_group`] answered when the
/// watchdog was armed. A helper that led its own process group — every helper
/// a spawner starts — kills that whole group, so a child the plugin forked
/// ends with it, even when the plugin has since moved the helper out of the
/// group. The helper itself then ends by that `SIGKILL` or by the `_exit`
/// after it, whichever the kernel completes first. A helper that was in
/// someone else's group, such as a test runner's, never signals that group
/// and ends by `_exit` alone.
///
/// The descendant sweep runs first to reach children that left the
/// helper's original group.
#[cfg(unix)]
fn terminate_current_process(code: i32, leads_group: bool) {
    kill_own_descendants();
    if leads_group {
        // SAFETY: getpid has no preconditions and cannot fail.
        let pid = unsafe { libc::getpid() };
        // The group this process led when it was armed, named by its own pid.
        send_group_signal(pid, libc::SIGKILL);
    }
    // SAFETY: _exit is async-signal-safe and never returns.
    unsafe { libc::_exit(code) }
}

#[cfg(windows)]
fn terminate_current_process(code: i32, _leads_group: bool) {
    use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
    // SAFETY: GetCurrentProcess has no preconditions and returns a
    // pseudo-handle that needs no closing.
    let current = unsafe { GetCurrentProcess() };
    // SAFETY: the pseudo-handle for the current process is always valid and
    // carries PROCESS_TERMINATE.
    let terminated = unsafe { TerminateProcess(current, code as u32) };
    if terminated.is_err() {
        std::process::exit(code);
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_current_process(code: i32, _leads_group: bool) {
    std::process::exit(code);
}

/// Make this process the reaper of every orphan in its tree, so a plugin's
/// descendant whose parent exits reparents here rather than to init and
/// stays reachable. The helper calls it for [`kill_own_descendants`]; the
/// tree supervisor calls it so that the helper's own orphans, which a dying
/// helper hands to its nearest living subreaper ancestor, land in the
/// supervisor ([`reap_adopted_tree`]). A refusal leaves only the orphan case
/// uncovered, so the scan goes ahead.
#[cfg(target_os = "linux")]
fn adopt_orphaned_descendants() {
    // SAFETY: prctl with PR_SET_CHILD_SUBREAPER takes plain values and
    // touches no memory of ours.
    let _ = unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) };
}

#[cfg(not(target_os = "linux"))]
fn adopt_orphaned_descendants() {}

/// How many stop-then-kill sweeps one descendant kill makes at most.
///
/// Each sweep stops every process it finds, parents before their children,
/// so a process can fork only between its parent's sweep and its own stop;
/// the next sweep catches what it forked. The kill ends after the first
/// sweep that finds nothing new. The cap keeps a plugin that forks without
/// end from holding the helper's exit, the watchdog's included, past a
/// bounded number of process-table walks.
#[cfg(unix)]
const DESCENDANT_SWEEP_PASSES: usize = 8;

/// The most processes one sweep visits, bounding each walk the same way.
/// Only the helper's own sweep is left with this cap: the tree supervisor
/// repeats its sweep on Linux, reaping between passes, until no child is
/// left ([`reap_adopted_tree`]).
#[cfg(all(unix, not(test)))]
const DESCENDANT_SWEEP_MAX_PROCESSES: usize = 4096;

/// Test builds scale the cap down so a test tree can outgrow it: what the
/// cap bounds does not depend on its value, and a tree past 4096 processes
/// is too heavy to fork in a test.
#[cfg(all(unix, test))]
const DESCENDANT_SWEEP_MAX_PROCESSES: usize = 64;

/// Kill every process descended from this helper: the first line of the
/// helper's tree containment, on its clean response exit and its watchdog
/// exit.
///
/// `setsid` moves a plugin's child out of the helper's process group, so
/// the group kills (this process's own on its watchdog exit, the tree
/// supervisor's after any exit) miss it; it does not move the child out of
/// the helper's parentage, which is what this walks. On Linux the helper is
/// also the subreaper of its tree ([`adopt_orphaned_descendants`]), so an
/// orphan stays in it.
///
/// Every exit this sweep cannot run on — the plugin calling `exit`, `_exit`
/// or `abort`, a fatal signal, a panic, a fork after the last pass, or the
/// helper killed outright — is the tree supervisor's to clean up
/// ([`supervise_helper_tree`]), which outlives the helper and is the
/// backstop for all of them. On macOS, with no subreaper, the supervisor
/// finds an orphan only through a walk it took while the orphan's parent
/// lived, so a descendant that is born and orphaned between two of its
/// walks ([`TREE_SUPERVISOR_TICK`]) reparents to launchd, as does one that
/// double-forks inside that window; the application's sweep by the scan's
/// tree token ends those ([`sweep_scan_tree`]). Plugin code runs with the
/// user's own rights in any case, so the bound contains accident and
/// carelessness, not a plugin set on escaping.
#[cfg(unix)]
fn kill_own_descendants() {
    // SAFETY: getpid has no preconditions and cannot fail.
    kill_descendants(unsafe { libc::getpid() });
}

#[cfg(not(unix))]
fn kill_own_descendants() {}

/// Stop and kill every descendant of `root`, in at most
/// [`DESCENDANT_SWEEP_PASSES`] sweeps.
#[cfg(unix)]
fn kill_descendants(root: libc::pid_t) {
    let mut killed = BTreeSet::new();
    for _ in 0..DESCENDANT_SWEEP_PASSES {
        let found = stop_unkilled_descendants(root, &killed);
        if found.is_empty() {
            return;
        }
        for pid in found {
            send_signal(pid, libc::SIGKILL);
            killed.insert(pid);
        }
    }
}

/// One sweep: walk `root`'s tree top-down, stopping each descendant not
/// already killed before reading its children, and return those.
#[cfg(unix)]
fn stop_unkilled_descendants(
    root: libc::pid_t,
    killed: &BTreeSet<libc::pid_t>,
) -> Vec<libc::pid_t> {
    let mut found = Vec::new();
    let mut visited = BTreeSet::from([root]);
    let mut pending = vec![root];
    while let Some(parent) = pending.pop() {
        for child in child_pids(parent) {
            if visited.len() >= DESCENDANT_SWEEP_MAX_PROCESSES {
                return found;
            }
            if !visited.insert(child) {
                continue;
            }
            if !killed.contains(&child) {
                send_signal(child, libc::SIGSTOP);
                found.push(child);
            }
            pending.push(child);
        }
    }
    found
}

/// Signal one process. Never a group: a pid that is not positive is refused
/// rather than read as one.
#[cfg(unix)]
fn send_signal(pid: libc::pid_t, signal: libc::c_int) {
    if pid <= 0 {
        return;
    }
    // SAFETY: kill takes plain values; a positive pid names one process.
    let _ = unsafe { libc::kill(pid, signal) };
}

/// The children of `parent`, from every one of its threads: a child is
/// listed under the thread that forked it.
#[cfg(target_os = "linux")]
fn child_pids(parent: libc::pid_t) -> Vec<libc::pid_t> {
    let Ok(tasks) = fs::read_dir(format!("/proc/{parent}/task")) else {
        return Vec::new();
    };
    tasks
        .flatten()
        .filter_map(|task| fs::read_to_string(task.path().join("children")).ok())
        .flat_map(|children| {
            children
                .split_ascii_whitespace()
                .filter_map(|pid| pid.parse().ok())
                .collect::<Vec<libc::pid_t>>()
        })
        .collect()
}

/// The children of `parent`. `proc_listchildpids` fills at most the buffer
/// and returns how many pids it wrote; a child past the buffer is left to
/// the next sweep.
#[cfg(target_os = "macos")]
fn child_pids(parent: libc::pid_t) -> Vec<libc::pid_t> {
    let mut pids: Vec<libc::pid_t> = vec![0; DESCENDANT_SWEEP_MAX_PROCESSES];
    let Ok(buffer_bytes) = libc::c_int::try_from(std::mem::size_of_val(pids.as_slice())) else {
        return Vec::new();
    };
    // SAFETY: `pids` is a writable buffer of exactly `buffer_bytes` bytes
    // that outlives the call.
    let written =
        unsafe { libc::proc_listchildpids(parent, pids.as_mut_ptr().cast(), buffer_bytes) };
    let Ok(written) = usize::try_from(written) else {
        return Vec::new();
    };
    pids.truncate(written.min(DESCENDANT_SWEEP_MAX_PROCESSES));
    pids.retain(|pid| *pid > 0 && *pid != parent);
    pids
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn child_pids(_parent: libc::pid_t) -> Vec<libc::pid_t> {
    Vec::new()
}

/// How often the tree supervisor looks at its helper, at the application's
/// socket and, on macOS, at the helper's descendants.
///
/// Ten milliseconds, the application's own reap poll ([`wait_bounded`]), so
/// a helper's exit reaches the application about as soon as it did when the
/// application polled the helper itself. On macOS it is also the window
/// named on [`kill_own_descendants`] that only the application's token
/// sweep covers ([`sweep_scan_tree`]); a walk costs one `proc_listchildpids` and one `proc_pidinfo` per live
/// descendant, which for any tree a plugin legitimately starts is a few
/// microseconds a tick.
#[cfg(unix)]
const TREE_SUPERVISOR_TICK: Duration = Duration::from_millis(10);

/// The tree supervisor's own bound on its helper. Past the helper's own
/// deadline, so it decides only when the helper's watchdog is held and the
/// application's socket stays open anyway.
#[cfg(unix)]
const TREE_SUPERVISOR_DEADLINE: Duration = Duration::from_secs(HELPER_DEADLINE.as_secs() + 2);

/// The wall-clock bound on the tree supervisor's final sweep, on a scan's
/// own sweep by tree token, and on all of a stop's token sweeps together. A
/// process the kernel cannot kill yet, such as one in uninterruptible sleep,
/// holds the sweep no longer than this: it has already been sent `SIGKILL`,
/// and dies when it wakes.
const TREE_SWEEP_BOUND: Duration = Duration::from_secs(1);

/// How long the application waits, after releasing a tree supervisor at the
/// scan's bound, for the supervisor to end its tree and exit before the
/// application kills what it can reach itself. Above [`TREE_SWEEP_BOUND`]
/// plus a tick, so a supervisor that is working is never preempted.
#[cfg(unix)]
const TREE_RELEASE_GRACE: Duration = Duration::from_millis(1500);

/// The tree supervisor's report to the application, written on the socket
/// they share as one record per line, each a kind byte and its text:
///
/// - [`TREE_REPORT_SPAWNING`], before the helper is spawned. From here on
///   plugin code may run, so a supervisor that dies with no further record
///   is a process failure, as a helper dying on its own always was.
/// - [`TREE_REPORT_SPAWN_REFUSED`] with the reason, when the spawn failed.
/// - [`TREE_REPORT_STARTED`] with the helper's pid, once it runs.
/// - [`TREE_REPORT_UNOBSERVABLE`] with the reason, when the supervisor lost
///   track of its helper.
/// - [`TREE_REPORT_DONE`], after the supervisor's own end path has killed
///   the tree; it is missing only when the supervisor died outside it.
///
/// Only the supervisor holds its end: the helper's standard input is null,
/// so no plugin process inherits it. The report lets the application tell
/// its own refusals, which never quarantine, from a helper's exit, which the
/// supervisor relays unchanged, and tells it when the tree is its to end
/// ([`kill_orphaned_helper_group`]).
#[cfg(unix)]
const TREE_REPORT_SPAWNING: u8 = b'P';
#[cfg(unix)]
const TREE_REPORT_SPAWN_REFUSED: u8 = b'F';
#[cfg(unix)]
const TREE_REPORT_STARTED: u8 = b'R';
#[cfg(unix)]
const TREE_REPORT_UNOBSERVABLE: u8 = b'U';
#[cfg(unix)]
const TREE_REPORT_DONE: u8 = b'D';
#[cfg(unix)]
const TREE_REPORT_MAX_BYTES: usize = 1024;

/// Test builds only: a tree supervisor whose environment names this dies of
/// `SIGKILL` right after spawning its helper, before it reports the start —
/// the death a plugin can cause by killing its parent.
#[cfg(test)]
const TEST_TREE_SUPERVISOR_DIES_AFTER_SPAWN_ENV: &str =
    "SOURDAW_TEST_TREE_SUPERVISOR_DIES_AFTER_SPAWN";

/// Test builds only: a tree supervisor whose environment names this dies of
/// `SIGKILL` when the application releases it, before its own end path —
/// the death a plugin or the OOM killer can cause inside the release grace.
#[cfg(test)]
const TEST_TREE_SUPERVISOR_DIES_ON_RELEASE_ENV: &str =
    "SOURDAW_TEST_TREE_SUPERVISOR_DIES_ON_RELEASE";

/// Test builds only: the helper's command line for this test binary's tree
/// supervisor entry, as JSON, because the test harness refuses the
/// supervisor marker as an unknown option.
#[cfg(test)]
const TEST_TREE_SUPERVISOR_ARGV_ENV: &str = "SOURDAW_TEST_TREE_SUPERVISOR_ARGV";

/// How the tree supervisor's watch over a running helper ended.
#[cfg(unix)]
enum TreeEnd {
    HelperExited,
    SpawnerGone,
    Deadline,
    Unobservable(std::io::Error),
}

/// Run one helper under supervision and end its whole tree, on every way
/// the helper or the application can end. Returns the exit code to end with;
/// a helper that died by a signal is relayed by dying of the same signal.
///
/// The contract the application relies on:
///
/// - The helper is started with every bound it had when the application
///   started it: its own process group, its watchdog with this process as
///   the parent it watches, and on Linux `PR_SET_PDEATHSIG` aimed at this
///   process ([`tie_to_spawner_death`]).
/// - The application's end of the socket on standard input is the
///   application's life. Its end-of-file — the application exited, was
///   killed, or released the tree at its bound — ends the helper's tree.
///   A plain read with a timeout watches it; no signal handler runs.
/// - After the helper exits, its group is killed while the helper is still
///   an unreaped zombie, then every process left of its tree, then the
///   helper is reaped. On Linux this process is the subreaper of the tree,
///   so every orphan, a `setsid` child of a helper that aborted included,
///   is its child; it kills and reaps until none is left
///   ([`reap_adopted_tree`]). On macOS it kills the descendants it
///   recorded while the helper ran ([`RecordedDescendants`]).
/// - The helper's exit status is relayed exactly: its code, or death by its
///   signal ([`relay_exit_status`]).
/// - Every step is reported to the application ([`TREE_REPORT_SPAWNING`]),
///   so a supervisor that dies outside this path still quarantines a plugin
///   that may have killed it ([`tree_report_refusal`]), and leaves the
///   helper's group to the application ([`kill_orphaned_helper_group`]).
/// - Whatever escapes this process — a `setsid` descendant of a supervisor
///   killed outside this path, or on macOS one orphaned between two walks —
///   still carries the scan's tree token, by which the application sweeps
///   after reaping this process ([`sweep_scan_tree`]).
#[cfg(unix)]
fn supervise_helper_tree(helper: &[OsString]) -> i32 {
    use std::os::unix::process::CommandExt;
    let Some((program, arguments)) = helper.split_first() else {
        return 2;
    };
    let Some(mut spawner) = spawner_socket() else {
        return 2;
    };
    adopt_orphaned_descendants();
    let mut command = Command::new(program);
    command
        .args(arguments)
        .env(SCAN_PARENT_PID_ENV, std::process::id().to_string())
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(test)]
    command.env_remove(TEST_TREE_SUPERVISOR_ARGV_ENV);
    #[cfg(target_os = "linux")]
    tie_to_spawner_death(&mut command);
    report_to_spawner(&mut spawner, TREE_REPORT_SPAWNING, "");
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            report_to_spawner(&mut spawner, TREE_REPORT_SPAWN_REFUSED, &error.to_string());
            return 2;
        }
    };
    // A helper that joins this supervisor's group turns the application's
    // death into a hangup: the group is orphaned, and once the end path has
    // stopped the helper the kernel sends the whole group SIGHUP. Ignored
    // here, after the spawn so the helper keeps the default, the end path
    // still runs to completion.
    // SAFETY: setting a signal's disposition to ignore takes plain values.
    let _ = unsafe { libc::signal(libc::SIGHUP, libc::SIG_IGN) };
    #[cfg(test)]
    if std::env::var_os(TEST_TREE_SUPERVISOR_DIES_AFTER_SPAWN_ENV).is_some() {
        die_by_signal(libc::SIGKILL);
    }
    let Ok(helper) = libc::pid_t::try_from(child.id()) else {
        report_to_spawner(
            &mut spawner,
            TREE_REPORT_UNOBSERVABLE,
            "helper pid out of range",
        );
        let _ = child.kill();
        let _ = child.wait();
        return 2;
    };
    report_to_spawner(&mut spawner, TREE_REPORT_STARTED, &helper.to_string());
    let mut recorded = RecordedDescendants::new();
    let end = watch_helper_tree(&mut spawner, child.id(), helper, &mut recorded);
    #[cfg(test)]
    if matches!(end, TreeEnd::SpawnerGone)
        && std::env::var_os(TEST_TREE_SUPERVISOR_DIES_ON_RELEASE_ENV).is_some()
    {
        die_by_signal(libc::SIGKILL);
    }
    let exit = end_helper_tree(&mut spawner, &mut child, helper, end, &mut recorded);
    report_to_spawner(&mut spawner, TREE_REPORT_DONE, "");
    match exit {
        TreeExit::Code(code) => code,
        TreeExit::Relay(status) => relay_exit_status(status),
    }
}

/// How the tree supervisor ends once its tree is gone.
#[cfg(unix)]
enum TreeExit {
    /// With its own code.
    Code(i32),
    /// The way the helper ended ([`relay_exit_status`]).
    Relay(ExitStatus),
}

#[cfg(not(unix))]
fn supervise_helper_tree(_helper: &[OsString]) -> i32 {
    2
}

/// The supervisor's end of the application's socket, handed over as
/// standard input. Anything else there — a terminal, a file, nothing — is
/// not the contract, and the role is refused rather than run unwatched.
#[cfg(unix)]
fn spawner_socket() -> Option<std::os::unix::net::UnixStream> {
    use std::os::fd::AsFd;
    let socket =
        std::os::unix::net::UnixStream::from(std::io::stdin().as_fd().try_clone_to_owned().ok()?);
    socket.local_addr().ok()?;
    socket.set_read_timeout(Some(TREE_SUPERVISOR_TICK)).ok()?;
    Some(socket)
}

/// Write one report record. Its text is cut short and kept on one line.
#[cfg(unix)]
fn report_to_spawner(spawner: &mut std::os::unix::net::UnixStream, kind: u8, text: &str) {
    let mut record = vec![kind];
    record.extend(text.bytes().take(TREE_REPORT_MAX_BYTES / 4).map(|byte| {
        if byte == b'\n' {
            b' '
        } else {
            byte
        }
    }));
    record.push(b'\n');
    let _ = spawner.write_all(&record);
}

/// Watch until the helper exits, the application goes, or the supervisor's
/// own deadline passes, walking the helper's descendants each tick.
#[cfg(unix)]
fn watch_helper_tree(
    spawner: &mut std::os::unix::net::UnixStream,
    helper_id: u32,
    helper: libc::pid_t,
    recorded: &mut RecordedDescendants,
) -> TreeEnd {
    let started = Instant::now();
    loop {
        match helper_has_exited(helper_id) {
            Ok(true) => return TreeEnd::HelperExited,
            Ok(false) => {}
            Err(error) => return TreeEnd::Unobservable(error),
        }
        recorded.walk(helper);
        if spawner_is_gone(spawner) {
            return TreeEnd::SpawnerGone;
        }
        if started.elapsed() >= TREE_SUPERVISOR_DEADLINE {
            return TreeEnd::Deadline;
        }
    }
}

/// One tick's wait on the application's socket. The application never
/// writes, so only end-of-file or a broken socket says it is gone.
#[cfg(unix)]
fn spawner_is_gone(spawner: &mut std::os::unix::net::UnixStream) -> bool {
    let mut byte = [0_u8; 1];
    match spawner.read(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(error) => !matches!(
            error.kind(),
            std::io::ErrorKind::WouldBlock
                | std::io::ErrorKind::TimedOut
                | std::io::ErrorKind::Interrupted
        ),
    }
}

/// End the helper's tree the way `end` calls for, and say how this
/// supervisor ends.
#[cfg(unix)]
fn end_helper_tree(
    spawner: &mut std::os::unix::net::UnixStream,
    child: &mut Child,
    helper: libc::pid_t,
    end: TreeEnd,
    recorded: &mut RecordedDescendants,
) -> TreeExit {
    if matches!(end, TreeEnd::HelperExited) {
        // The helper is an unreaped zombie: its pid, and with it its
        // group's id, cannot name another process yet.
        kill_led_group(helper);
        recorded.kill();
        let status = child.wait();
        reap_adopted_tree();
        return match status {
            Ok(status) => TreeExit::Relay(status),
            Err(error) => {
                report_to_spawner(spawner, TREE_REPORT_UNOBSERVABLE, &error.to_string());
                TreeExit::Code(1)
            }
        };
    }
    // Stopped first, so the helper can neither reap a descendant (freeing
    // its pid) nor fork during the walk.
    send_signal(helper, libc::SIGSTOP);
    recorded.walk(helper);
    kill_descendants(helper);
    kill_led_group(helper);
    recorded.kill();
    let _ = child.wait();
    reap_adopted_tree();
    TreeExit::Code(match end {
        TreeEnd::Deadline => HELPER_DEADLINE_EXIT_CODE,
        TreeEnd::Unobservable(error) => {
            report_to_spawner(spawner, TREE_REPORT_UNOBSERVABLE, &error.to_string());
            1
        }
        TreeEnd::HelperExited | TreeEnd::SpawnerGone => HELPER_PARENT_GONE_EXIT_CODE,
    })
}

/// Kill and reap every process this supervisor adopted, until it has no
/// child left or [`TREE_SWEEP_BOUND`] passes.
///
/// Every orphan of the helper's tree reparents to this subreaper, so all of
/// the tree that is left is this process's descendants. Each pass kills them
/// all ([`kill_descendants`]) and reaps what has died, so no zombie is
/// listed again and no process cap leaves a survivor: the loop ends when
/// `waitpid` reports no child. No pid it signals can be recycled: a direct
/// child stays its pid until this process reaps it, and a deeper descendant
/// is reached only through a parent the walk stopped first.
#[cfg(target_os = "linux")]
fn reap_adopted_tree() {
    let bound = Instant::now() + TREE_SWEEP_BOUND;
    // SAFETY: getpid has no preconditions and cannot fail.
    let supervisor = unsafe { libc::getpid() };
    loop {
        kill_descendants(supervisor);
        if !reap_exited_children() || Instant::now() >= bound {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

/// macOS has no subreaper, so nothing reparents here; the recorded
/// descendants are the sweep there.
#[cfg(all(unix, not(target_os = "linux")))]
fn reap_adopted_tree() {}

/// Reap every child that has exited. Returns whether any child is left.
#[cfg(target_os = "linux")]
fn reap_exited_children() -> bool {
    loop {
        let mut status = 0;
        // SAFETY: waitpid with WNOHANG takes plain values and a valid
        // out-pointer, and never blocks.
        let reaped = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        if reaped > 0 {
            continue;
        }
        if reaped == 0 {
            return true;
        }
        if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return false;
        }
    }
}

/// End this process the way the helper ended, so the application reads the
/// status it would have read from the helper itself: the same code, or
/// death by the same signal. Only a status that is neither, which `wait`
/// never returns, or a signal this process somehow survives, falls back to
/// an exit code: 1, or the shell's `128 + signal`.
#[cfg(unix)]
fn relay_exit_status(status: ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    if let Some(code) = status.code() {
        return code;
    }
    let Some(signal) = status.signal() else {
        return 1;
    };
    die_by_signal(signal);
    128 + signal
}

/// Die of `signal`. Its default action is restored first, because the Rust
/// runtime handles `SIGSEGV` and `SIGBUS` itself, and core dumps are turned
/// off, because the crash was the helper's, not this process's.
#[cfg(unix)]
fn die_by_signal(signal: libc::c_int) {
    let no_core = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: setrlimit only reads `no_core`, which outlives the call.
    let _ = unsafe { libc::setrlimit(libc::RLIMIT_CORE, &no_core) };
    // SAFETY: restoring a signal's default disposition takes plain values.
    let _ = unsafe { libc::signal(signal, libc::SIG_DFL) };
    // SAFETY: raise takes a plain value; with the default disposition the
    // signal ends this process.
    let _ = unsafe { libc::raise(signal) };
}

/// Signal one process group. A group id not above 1 is refused rather than
/// read as this process's own group or as every process.
#[cfg(unix)]
fn send_group_signal(group: libc::pid_t, signal: libc::c_int) {
    if group <= 1 {
        return;
    }
    // SAFETY: kill takes plain values; a pid below -1 names one group.
    let _ = unsafe { libc::kill(-group, signal) };
}

/// Kill a process that started as the leader of its own group, and that
/// group: the group holds the children it forked, and the process itself
/// may have moved to another group since. Safe only while `leader` is
/// unreaped, which pins both its pid and its group's id.
#[cfg(unix)]
fn kill_led_group(leader: libc::pid_t) {
    send_group_signal(leader, libc::SIGKILL);
    send_signal(leader, libc::SIGKILL);
}

/// A process's identity across pid reuse: its start time, as seconds and
/// microseconds.
#[cfg(target_os = "macos")]
type ProcessStart = (u64, u64);

/// Every descendant of the helper the supervisor has seen, with its start
/// time, so one that was orphaned to launchd — out of every later walk —
/// can still be killed, and a pid launchd reaped and the system reused for
/// an unrelated process never is.
///
/// Recording only reads: it stops nothing, so a working plugin runs
/// undisturbed. A descendant born and orphaned between two walks is never
/// recorded; the application's sweep by the scan's tree token ends it
/// ([`sweep_scan_tree`]). The residual race is a recorded process that dies,
/// and whose pid is reused, between the start-time check and the signal: a
/// window of microseconds against macOS's sequential pid allocation.
#[cfg(target_os = "macos")]
struct RecordedDescendants(BTreeMap<libc::pid_t, ProcessStart>);

#[cfg(target_os = "macos")]
impl RecordedDescendants {
    fn new() -> Self {
        Self(BTreeMap::new())
    }

    fn walk(&mut self, root: libc::pid_t) {
        let mut visited = BTreeSet::from([root]);
        let mut pending = vec![root];
        while let Some(parent) = pending.pop() {
            for child in child_pids(parent) {
                if visited.len() >= DESCENDANT_SWEEP_MAX_PROCESSES {
                    return;
                }
                if !visited.insert(child) {
                    continue;
                }
                if let Some(start) = process_start(child) {
                    self.0.insert(child, start);
                }
                pending.push(child);
            }
        }
    }

    /// Stop every recorded process still the one recorded, then kill each
    /// one's live descendants and the process itself — the final live walk
    /// that reaches what it forked after the last recording.
    fn kill(&self) {
        let bound = Instant::now() + TREE_SWEEP_BOUND;
        let alive: Vec<libc::pid_t> = self
            .0
            .iter()
            .filter(|(pid, start)| process_start(**pid) == Some(**start))
            .map(|(pid, _)| *pid)
            .collect();
        for pid in &alive {
            send_signal(*pid, libc::SIGSTOP);
        }
        for pid in alive {
            if Instant::now() < bound {
                kill_descendants(pid);
            }
            send_signal(pid, libc::SIGKILL);
        }
    }
}

/// Linux needs no record: the supervisor is its tree's subreaper, so every
/// orphan stays its descendant ([`reap_adopted_tree`]). Elsewhere there is
/// no child listing to record from.
#[cfg(all(unix, not(target_os = "macos")))]
struct RecordedDescendants;

#[cfg(all(unix, not(target_os = "macos")))]
impl RecordedDescendants {
    fn new() -> Self {
        Self
    }

    fn walk(&mut self, _root: libc::pid_t) {}

    fn kill(&self) {}
}

#[cfg(target_os = "macos")]
fn process_start(pid: libc::pid_t) -> Option<ProcessStart> {
    let info = bsd_info(pid)?;
    Some((info.pbi_start_tvsec, info.pbi_start_tvusec))
}

/// The kernel's BSD record of `pid`: its owner and start time among others.
#[cfg(target_os = "macos")]
fn bsd_info(pid: libc::pid_t) -> Option<libc::proc_bsdinfo> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = libc::c_int::try_from(std::mem::size_of::<libc::proc_bsdinfo>()).ok()?;
    // SAFETY: `info` is a writable proc_bsdinfo of exactly `size` bytes
    // that outlives the call.
    let written = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if written != size {
        return None;
    }
    // SAFETY: an all-zero proc_bsdinfo is a valid value, and proc_pidinfo
    // filled every byte of it.
    Some(unsafe { info.assume_init() })
}

/// Write the helper's answer, returning `Err` only when the response file
/// itself cannot be created or written — the one failure
/// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] reports and the supervisor can check.
///
/// The two answers the helper cannot write in full still leave a file, so
/// neither reaches that exit code. A response that does not serialize is
/// replaced by an `Err` naming why, which the supervisor reads as a data-level
/// refusal. A response past [`MAX_RESPONSE_BYTES`] is stated as its length
/// alone: the file is extended to the serialized size without its bytes
/// (sparse where the filesystem allows), and the supervisor's own size check
/// reads that as [`ScanFailure::ResponseOverLimit`] with the true size.
fn write_response<T: Serialize>(
    path: &Path,
    response: &WorkerResponse<T>,
) -> Result<(), ResponseWriteError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(ResponseWriteError::Uncreatable)?;
    let bytes = match serde_json::to_vec(response) {
        Ok(bytes) => bytes,
        Err(error) => unserializable_response(response.worker_pid, &error)?,
    };
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return file
            .set_len(bytes.len() as u64)
            .map_err(ResponseWriteError::Unwritable);
    }
    file.write_all(&bytes)
        .map_err(ResponseWriteError::Unwritable)
}

/// Why the helper could not write its response: the one failure
/// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] reports.
#[derive(Debug)]
enum ResponseWriteError {
    Uncreatable(std::io::Error),
    Unwritable(std::io::Error),
    Unserializable(serde_json::Error),
}

impl std::fmt::Display for ResponseWriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Uncreatable(error) => {
                write!(formatter, "Cannot create plugin scan response: {error}")
            }
            Self::Unwritable(error) => {
                write!(formatter, "Cannot write plugin scan response: {error}")
            }
            Self::Unserializable(error) => {
                write!(formatter, "Cannot serialize plugin scan response: {error}")
            }
        }
    }
}

impl std::error::Error for ResponseWriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Uncreatable(error) | Self::Unwritable(error) => Some(error),
            Self::Unserializable(error) => Some(error),
        }
    }
}

/// The response that stands in for one that would not serialize. Its `Err`
/// is the worker protocol's wire text, read back as [`ScanFailure::Refused`].
fn unserializable_response(
    worker_pid: u32,
    error: &serde_json::Error,
) -> Result<Vec<u8>, ResponseWriteError> {
    serde_json::to_vec(&WorkerResponse::<()> {
        worker_pid,
        result: Err(format!("Cannot serialize plugin scan response: {error}")),
    })
    .map_err(ResponseWriteError::Unserializable)
}
/// One helper run's answer, and how much free space its response volume lost
/// between the spawn and the helper's exit.
///
/// The consumption travels back so the caller can remember it against the
/// binary: [`process_failure`] attributes a later full disk to a binary whose
/// earlier run consumed [`CONSUMPTION_FOR_HELPER_ATTRIBUTION`] (#6943), and
/// only the caller knows which binary a run was for and where readings are
/// kept. `None` when no helper was spawned or either reading failed.
pub struct ScanAttempt<T> {
    pub result: Result<T, ScanFailure>,
    pub consumed_bytes: Option<u64>,
}

impl<T> ScanAttempt<T> {
    fn without_spawn(failure: ScanFailure) -> Self {
        Self {
            result: Err(failure),
            consumed_bytes: None,
        }
    }
}

/// Read every plugin descriptor a file declares through that format's
/// registered backend, in a bounded child process.
///
/// `recorded_consumption` is the most free space a recent earlier run of the
/// same binary consumed, or `None`; see [`ScanAttempt`].
pub fn scan_descriptor_metadata(
    format: PluginFormat,
    path: &Path,
    timeout: Duration,
    recorded_consumption: Option<u64>,
) -> ScanAttempt<Vec<ScannedDescriptor>> {
    let request = HelperRequest {
        format,
        path,
        plugin_id: None,
        worker_argument: WORKER_ARGUMENT,
    };
    scan_worker(&request, timeout, recorded_consumption)
}

/// Inspect one live instance of the plugin `plugin_id` names in the file,
/// through that format's registered backend, in a bounded child process.
///
/// `recorded_consumption` is as for [`scan_descriptor_metadata`].
pub fn scan_instance_metadata(
    format: PluginFormat,
    path: &Path,
    plugin_id: &str,
    timeout: Duration,
    recorded_consumption: Option<u64>,
) -> ScanAttempt<ScannedInstance> {
    let request = HelperRequest {
        format,
        path,
        plugin_id: Some(plugin_id),
        worker_argument: INSTANCE_WORKER_ARGUMENT,
    };
    scan_worker(&request, timeout, recorded_consumption)
}

/// What one helper is asked to read.
struct HelperRequest<'a> {
    format: PluginFormat,
    path: &'a Path,
    /// Which plugin of a multi-plugin bundle to instantiate; the descriptor
    /// pass has none.
    plugin_id: Option<&'a str>,
    worker_argument: &'a str,
}

/// The refusal `scan_worker` reports for a helper that exited unsuccessfully.
///
/// Every non-zero exit is [`ScanFailure::ExitedUnsuccessfully`], which
/// quarantines, unless the helper exited [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`]
/// *and* `probe_write` — the supervisor's own write into the same response
/// directory — fails with a storage fault. Only then is it
/// [`ScanFailure::ResponseWriteRefused`], which never quarantines.
///
/// Anything the helper writes or exits with, the plugin running inside it can
/// write or exit with too, so the helper's word decides nothing (#6662). The
/// probe is evidence from outside the helper: a storage fault is a property of
/// the filesystem, which a plugin can produce only by making it true — and a
/// disk that is genuinely full is exactly the systemic fault this class exists
/// to keep from quarantining every candidate. A permission refusal is not
/// such evidence: the supervisor created the directory writable moments ago,
/// so a directory that refuses it now was changed by a process of this user,
/// and the plugin is one.
///
/// A full disk is the one storage fault a plugin can make true, by writing
/// until the volume runs out, so [`helper_filled_the_volume`] attributes it to
/// the helper on either of two readings in `evidence`. The volume had room for
/// a whole response and headroom before this helper started (#6936), or a
/// recent earlier run of the same binary itself consumed
/// [`CONSUMPTION_FOR_HELPER_ATTRIBUTION`], which is how a plugin splitting the
/// fill across scans shows: most of the volume on one that exits 0, the rest
/// on the next (#6943). A volume that was short before this spawn, for a
/// binary with no such run recorded, keeps the refusal. When this spawn's free
/// space could not be read, attribution rests on the recorded consumption
/// alone.
///
/// The probe runs only for exit 3, after the helper is gone, so a storage
/// fault that clears in between reads as a process failure; a full rescan
/// clears that quarantine.
fn process_failure(
    path: &Path,
    status: &ExitStatus,
    evidence: FillEvidence,
    probe_write: impl FnOnce() -> std::io::Result<()>,
) -> ScanFailure {
    let path = path.to_path_buf();
    if status.code() == Some(RESPONSE_WRITE_REFUSAL_EXIT_CODE)
        && probe_write().is_err_and(|error| {
            is_storage_fault(&error) && !helper_filled_the_volume(&error, evidence)
        })
    {
        return ScanFailure::ResponseWriteRefused { path };
    }
    ScanFailure::ExitedUnsuccessfully { path }
}

/// The free space a volume needs before the helper starts for a full disk
/// afterwards to be the helper's doing: one maximal response plus 1 GiB.
const ROOM_FOR_HELPER_ATTRIBUTION: u64 = MAX_RESPONSE_BYTES + 1024 * 1024 * 1024;

/// How much free space one run of a binary must have consumed for a later
/// full disk to be that binary's doing: 1 GiB.
///
/// A scan helper writes one response of at most [`MAX_RESPONSE_BYTES`], and
/// a plugin's scan entry points have no reason to write files at all, so a
/// run that took a gibibyte from the volume wrote far more than any scan
/// needs. A user filling the disk between scans is never measured against a
/// binary, because no helper of it was running.
const CONSUMPTION_FOR_HELPER_ATTRIBUTION: u64 = 1024 * 1024 * 1024;

/// The readings [`helper_filled_the_volume`] decides a full disk from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FillEvidence {
    /// The volume's free space before this helper spawned.
    room_before_spawn: Option<u64>,
    /// The most free space a recent earlier run of the same binary consumed
    /// between its spawn and its exit.
    recorded_consumption: Option<u64>,
}

/// Whether the probe's full disk is one the helper made: the volume had
/// [`ROOM_FOR_HELPER_ATTRIBUTION`] before this spawn and none after it, or a
/// recent run of the binary consumed [`CONSUMPTION_FOR_HELPER_ATTRIBUTION`].
///
/// Both readings span a helper's run and nothing outside it, so the one
/// wrong quarantine they admit comes from another process writing during
/// that run: more than the headroom inside this helper's deadline, or more
/// than the consumption bound inside an earlier run's, recorded against that
/// binary for the window the registry keeps it. That cost is bounded: the
/// quarantine is persisted with its reason, named in every scan response, and
/// cleared by the user's retry-quarantined rescan. A plugin that instead
/// escapes needs a volume already within the headroom of full, where filling
/// it costs the user little more, or must fill it in runs of under a gibibyte
/// each, one helper run per scan that rereads its changed file. A plugin cannot make a filesystem read-only
/// or a device fail, so only `StorageFull` is attributed.
///
/// `QuotaExceeded` stays unattributed (#6942) because no pre-spawn reading can
/// say whose limit a later EDQUOT hit. `statvfs` reports the volume, not a
/// quota. macOS APFS has no user quotas and the `libc` crate binds no
/// `quotactl` there. On Linux, `quotactl(Q_GETQUOTA)` needs the block device
/// behind the response directory, which only a `/proc/self/mountinfo` parse
/// finds, and `quotactl_fd` needs kernel 5.14 and a raw syscall. Either reads
/// one user quota, while EDQUOT also comes from group quotas, project quotas
/// on ext4 and XFS, btrfs qgroups and NFS server quotas, none of which it
/// sees. Attributing against user headroom alone would quarantine a good
/// plugin whenever one of those is the limit hit.
fn helper_filled_the_volume(error: &std::io::Error, evidence: FillEvidence) -> bool {
    let had_room = evidence
        .room_before_spawn
        .is_some_and(|room| room >= ROOM_FOR_HELPER_ATTRIBUTION);
    let consumed_before = evidence
        .recorded_consumption
        .is_some_and(|consumed| consumed >= CONSUMPTION_FOR_HELPER_ATTRIBUTION);
    error.kind() == std::io::ErrorKind::StorageFull && (had_room || consumed_before)
}

/// The free space a run consumed: the fall from the reading before its spawn
/// to the reading after its exit. Space freed meanwhile reads as none.
fn consumed_during_run(
    room_before_spawn: Option<u64>,
    room_after_exit: Option<u64>,
) -> Option<u64> {
    Some(room_before_spawn?.saturating_sub(room_after_exit?))
}

/// Whether a write failed because of the storage itself rather than anything
/// a same-user process can set on a file or directory: a full disk, an
/// exhausted quota, a read-only filesystem, or a device I/O error. A
/// permission or missing-entry error is never one; see [`process_failure`].
fn is_storage_fault(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::StorageFull
            | std::io::ErrorKind::QuotaExceeded
            | std::io::ErrorKind::ReadOnlyFilesystem
    ) || is_device_io_error(error)
}

/// A failing disk. Matched by OS code because std leaves it uncategorized.
#[cfg(unix)]
fn is_device_io_error(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(libc::EIO)
}

#[cfg(windows)]
fn is_device_io_error(error: &std::io::Error) -> bool {
    const ERROR_IO_DEVICE: i32 = 1117;
    error.raw_os_error() == Some(ERROR_IO_DEVICE)
}

#[cfg(not(any(unix, windows)))]
fn is_device_io_error(_error: &std::io::Error) -> bool {
    false
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
    request: &HelperRequest<'_>,
    timeout: Duration,
    recorded_consumption: Option<u64>,
) -> ScanAttempt<T> {
    // Refused here as well as in the child: launching a process to be told the
    // format is unhostable spends a spawn and a deadline to reach the same
    // answer, and the child's refusal is an exit code with no reason in it.
    if scan_backend(request.format).is_none() {
        return ScanAttempt::without_spawn(ScanFailure::NoBackend {
            format: request.format,
        });
    }
    let launcher = match ScanWorkerCommand::resolve() {
        Ok(launcher) => launcher,
        Err(failure) => return ScanAttempt::without_spawn(failure),
    };
    scan_worker_with(
        &launcher,
        &TreeSupervisorLaunch::Helper(&launcher),
        &PinnedResponseStorage,
        request,
        timeout,
        recorded_consumption,
    )
}

/// What the supervisor learns about the storage under a response directory:
/// the volume's free space before the helper starts and after it exits, and
/// whether its own write succeeds after the helper exits.
trait ResponseStorage {
    fn available_bytes(&self, directory: &ResponseDirectory) -> Option<u64>;
    fn probe_write(&self, directory: &ResponseDirectory) -> std::io::Result<()>;
}

/// The readings production takes, through the directory's pinned handle.
struct PinnedResponseStorage;

impl ResponseStorage for PinnedResponseStorage {
    fn available_bytes(&self, directory: &ResponseDirectory) -> Option<u64> {
        directory.available_bytes()
    }

    fn probe_write(&self, directory: &ResponseDirectory) -> std::io::Result<()> {
        directory.probe_write()
    }
}

fn scan_worker_with<T: DeserializeOwned>(
    launcher: &ScanWorkerCommand,
    supervisor: &TreeSupervisorLaunch<'_>,
    storage: &impl ResponseStorage,
    request: &HelperRequest<'_>,
    timeout: Duration,
    recorded_consumption: Option<u64>,
) -> ScanAttempt<T> {
    let response_directory = match ResponseDirectory::create() {
        Ok(directory) => directory,
        Err(failure) => return ScanAttempt::without_spawn(failure),
    };
    let response_path = response_directory.path.join("metadata.json");
    let mut command = helper_command(launcher, request, &response_path);
    let room_before_spawn = storage.available_bytes(&response_directory);
    let exit = run_bounded_in(
        &HELPER_REGISTRY,
        supervisor,
        &mut command,
        timeout.min(WORKER_TIMEOUT),
    );
    // Read on every way out, a clean exit included: the run a plugin fills
    // the volume in can be one that answers the scan.
    let room_after_exit = storage.available_bytes(&response_directory);
    let evidence = FillEvidence {
        room_before_spawn,
        recorded_consumption,
    };
    let result = exit.and_then(|status| {
        read_helper_answer(
            storage,
            &response_directory,
            &response_path,
            request.path,
            &status,
            evidence,
        )
    });
    ScanAttempt {
        result,
        consumed_bytes: consumed_during_run(room_before_spawn, room_after_exit),
    }
}

fn helper_command(
    launcher: &ScanWorkerCommand,
    request: &HelperRequest<'_>,
    response_path: &Path,
) -> Command {
    let mut command = Command::new(&launcher.program);
    command
        .args(&launcher.args)
        .arg(request.worker_argument)
        .arg(request.format.wire_name())
        .arg(request.path);
    if let Some(plugin_id) = request.plugin_id {
        command.arg(plugin_id);
    }
    command
        .arg(response_path)
        .envs(&launcher.env)
        .env(SCAN_PARENT_PID_ENV, std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn read_helper_answer<T: DeserializeOwned>(
    storage: &impl ResponseStorage,
    response_directory: &ResponseDirectory,
    response_path: &Path,
    path: &Path,
    status: &ExitStatus,
    evidence: FillEvidence,
) -> Result<T, ScanFailure> {
    if !status.success() {
        return Err(process_failure(path, status, evidence, || {
            storage.probe_write(response_directory)
        }));
    }
    let bytes = read_response_bytes(response_path, path)?;
    let response: WorkerResponse<T> =
        serde_json::from_slice(&bytes).map_err(|error| ScanFailure::ResponseInvalid {
            cause: error.to_string(),
        })?;
    if response.worker_pid == std::process::id() {
        return Err(ScanFailure::SameProcess);
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
    ScanFailure::ResponseUnreadable {
        cause: error.to_string(),
    }
}

fn returned_no_metadata(error: &std::io::Error) -> ScanFailure {
    ScanFailure::NoResponse {
        cause: error.to_string(),
    }
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
    /// The tree token of every scan whose own sweep has not yet returned
    /// ([`SCAN_TREE_TOKEN_ENV`]). A token outlives its supervisor's entry in
    /// `live`: the scan sweeps only after the supervisor is reaped, and a
    /// stop that lands in between must still sweep for it.
    tree_tokens: BTreeSet<String>,
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
                tree_tokens: BTreeSet::new(),
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

    /// Spawn and register a helper, with the tree token its scan set on
    /// `command`, so a stop can sweep what escaped the helper's parentage.
    fn spawn(&self, command: &mut Command, tree_token: Option<&str>) -> Result<Child, ScanFailure> {
        let mut state = self.lock_unless_stopped();
        let child = command
            .spawn()
            .map_err(|error| ScanFailure::HelperUnstartable {
                cause: error.to_string(),
            })?;
        state.live.insert(child.id());
        if let Some(tree_token) = tree_token {
            state.tree_tokens.insert(tree_token.to_owned());
        }
        Ok(child)
    }

    /// Drop a scan's tree token once its own sweep has returned. Once
    /// stopped, the caller parks instead, as on every other entry point.
    #[cfg(unix)]
    fn release_tree_token(&self, tree_token: &str) {
        let mut state = self.lock_unless_stopped();
        state.tree_tokens.remove(tree_token);
    }

    /// Reap the helper if it has exited, deregistering it under the same lock.
    /// Whatever the plugin left running in the helper's tree is killed first,
    /// on a clean exit as on any other (see [`reap_exited_helper`]).
    fn try_reap(&self, child: &mut Child) -> std::io::Result<Option<ExitStatus>> {
        let mut state = self.lock_unless_stopped();
        let Some(status) = reap_exited_helper(child)? else {
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
    /// stopped scan never answers. A parked scan never finishes its own sweep
    /// by tree token ([`sweep_scan_tree`]), so the stop sweeps, after the
    /// kills by parentage, for every token still registered. The sweeps
    /// share one [`TREE_SWEEP_BOUND`], so a stop with many scans live delays
    /// the process's exit by that bound, plus one pass for each later token,
    /// rather than by one bound per scan. A scan thread sweeping the same
    /// token at the same time kills the same processes.
    fn stop(&self) {
        let mut state = self.lock();
        state.stopping = true;
        for pid in &state.live {
            kill_helper_tree(*pid);
        }
        let deadline = Instant::now() + TREE_SWEEP_BOUND;
        for tree_token in &state.tree_tokens {
            sweep_scan_tree(tree_token, deadline);
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

/// How the application starts the tree supervisor for one helper.
#[cfg_attr(
    not(unix),
    allow(
        dead_code,
        reason = "Windows bounds each helper's tree with a kill-on-close job and starts no tree supervisor"
    )
)]
enum TreeSupervisorLaunch<'a> {
    /// The helper's own launch command, re-entered with
    /// [`TREE_SUPERVISOR_ARGUMENT`].
    Helper(&'a ScanWorkerCommand),
    /// This test binary's supervisor entry, handed the helper's command line
    /// through [`TEST_TREE_SUPERVISOR_ARGV_ENV`].
    #[cfg(test)]
    TestEntry,
}

impl TreeSupervisorLaunch<'_> {
    /// The supervisor's command for `helper`: the helper's whole command
    /// line after the marker, and the helper's environment, which the helper
    /// inherits through the supervisor.
    #[cfg(unix)]
    fn command_for(&self, helper: &Command) -> Command {
        let helper_line = std::iter::once(helper.get_program()).chain(helper.get_args());
        let mut command = match self {
            Self::Helper(launcher) => {
                let mut command = Command::new(&launcher.program);
                command
                    .args(&launcher.args)
                    .arg(TREE_SUPERVISOR_ARGUMENT)
                    .args(helper_line);
                command
            }
            #[cfg(test)]
            Self::TestEntry => {
                let line: Vec<String> = helper_line
                    .map(|argument| argument.to_string_lossy().into_owned())
                    .collect();
                let mut command =
                    Command::new(std::env::current_exe().expect("test executable should exist"));
                command
                    .args([
                        "--exact",
                        "host::plugin_scan_worker::tests::tree_supervisor_child",
                    ])
                    .env(
                        TEST_TREE_SUPERVISOR_ARGV_ENV,
                        serde_json::to_string(&line).expect("a string list serializes"),
                    );
                command
            }
        };
        for (key, value) in helper.get_envs() {
            match value {
                Some(value) => command.env(key, value),
                None => command.env_remove(key),
            };
        }
        command
    }
}

/// The application's end of one tree supervisor's socket. Holding it keeps
/// the supervisor watching; closing it, on purpose or by the application's
/// death, ends the helper's tree.
struct TreeTie {
    #[cfg(unix)]
    socket: Option<std::os::unix::net::UnixStream>,
}

impl TreeTie {
    /// Release the supervisor at the scan's bound and give it
    /// [`TREE_RELEASE_GRACE`] to end its tree and exit. Returns whether it
    /// did and was reaped; otherwise the caller kills what it can reach.
    ///
    /// Shutting down the application's writing half is end-of-file to the
    /// supervisor, while the socket stays open for its [`Self::report`].
    #[cfg(unix)]
    fn release_and_reap(&mut self, registry: &HelperRegistry, child: &mut Child) -> bool {
        let Some(socket) = self.socket.as_ref() else {
            return false;
        };
        // An error means the supervisor's end is already closed, which is
        // the same end-of-file.
        let _ = socket.shutdown(std::net::Shutdown::Write);
        let deadline = Instant::now() + TREE_RELEASE_GRACE;
        while Instant::now() < deadline {
            match registry.try_reap(child) {
                Ok(Some(_)) => return true,
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(_) => return false,
            }
        }
        false
    }

    #[cfg(not(unix))]
    fn release_and_reap(&mut self, _registry: &HelperRegistry, _child: &mut Child) -> bool {
        false
    }

    /// What the exited supervisor reported. Read without blocking: the
    /// supervisor has exited, and nothing else holds its end.
    #[cfg(unix)]
    fn report(&mut self) -> TreeReport {
        let Some(socket) = self.socket.as_mut() else {
            return TreeReport::default();
        };
        if socket.set_nonblocking(true).is_err() {
            return TreeReport::default();
        }
        let mut report = Vec::new();
        let mut buffer = [0_u8; 256];
        while report.len() < TREE_REPORT_MAX_BYTES {
            match socket.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => report.extend_from_slice(&buffer[..read]),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        parse_tree_report(&report)
    }
}

/// A tree supervisor's report, as the application read it after the
/// supervisor exited. See [`TREE_REPORT_SPAWNING`] for the records.
#[cfg(unix)]
#[derive(Debug, Default, PartialEq, Eq)]
struct TreeReport {
    spawning: bool,
    spawn_refused: Option<String>,
    helper: Option<libc::pid_t>,
    unobservable: Option<String>,
    done: bool,
}

#[cfg(unix)]
fn parse_tree_report(bytes: &[u8]) -> TreeReport {
    let mut report = TreeReport::default();
    for record in bytes.split(|byte| *byte == b'\n') {
        let Some((&kind, text)) = record.split_first() else {
            continue;
        };
        match kind {
            TREE_REPORT_SPAWNING => report.spawning = true,
            TREE_REPORT_SPAWN_REFUSED => {
                report.spawn_refused = Some(String::from_utf8_lossy(text).into_owned());
            }
            TREE_REPORT_STARTED => {
                report.helper = std::str::from_utf8(text)
                    .ok()
                    .and_then(|pid| pid.parse().ok())
                    .filter(|pid| *pid > 1);
            }
            TREE_REPORT_UNOBSERVABLE => {
                report.unobservable = Some(String::from_utf8_lossy(text).into_owned());
            }
            TREE_REPORT_DONE => report.done = true,
            _ => {}
        }
    }
    report
}

/// What a tree supervisor's report says about the exit the application
/// observed: nothing when the exit stands as the helper's, or the refusal
/// that replaces it.
///
/// Only a supervisor that never reached its helper's spawn is a refusal:
/// a failed spawn, or a supervisor that ended before saying it was about to
/// spawn. No plugin code can have run then. Once the spawning record is
/// written, a supervisor that dies before or after reporting the start — a
/// plugin killing its parent, say — leaves its own signal death as the exit,
/// which reads as the process failure a helper dying on its own always did,
/// and quarantines.
#[cfg(unix)]
fn tree_report_refusal(report: &TreeReport) -> Option<ScanFailure> {
    if let Some(reason) = &report.spawn_refused {
        return Some(ScanFailure::HelperUnstartable {
            cause: reason.clone(),
        });
    }
    if let Some(reason) = &report.unobservable {
        return Some(ScanFailure::HelperUnobservable {
            cause: reason.clone(),
        });
    }
    if !report.spawning {
        return Some(ScanFailure::SupervisorEndedEarly);
    }
    None
}

/// End the group of a helper whose tree supervisor died outside its own end
/// path, which is what the report's missing done record says. The helper
/// itself dies with the supervisor on Linux (`PR_SET_PDEATHSIG`) and by its
/// parent watch on macOS, but neither reaches the rest of its group, and
/// before supervision the application killed that group itself.
///
/// The helper leads its group, so the group's id is the helper's pid, and
/// that id stays allocated while any member of the group lives: neither
/// Linux nor macOS hands out a pid that is still a live group's id. So
/// while the group has members, `kill(-pid)` reaches exactly the helper's
/// group, and an empty group leaves nothing to kill. The one case it could
/// miss is the group emptying, its id being handed to a new process, and
/// that process leading a group of its own, all between the supervisor's
/// reap and this call: a window of microseconds against a pid space that
/// must wrap around first. The helper's own pid is never signalled here, so
/// [`kill_led_group`] does not apply: nothing pins a pid whose process
/// another reaper may already have freed.
///
/// A descendant that left the group with `setsid` is out of this kill's
/// reach: its parent chain ran through the dead supervisor, so it has
/// reparented to init or launchd, and no walk from the application finds
/// it. The sweep by the scan's tree token that follows ends it
/// ([`sweep_scan_tree`]).
#[cfg(unix)]
fn kill_orphaned_helper_group(report: &TreeReport) {
    if report.done {
        return;
    }
    if let Some(helper) = report.helper {
        send_group_signal(helper, libc::SIGKILL);
    }
}

/// The environment variable carrying one scan's tree token. The application
/// sets it on the helper's command, so the supervisor, the helper and every
/// process the plugin forks or execs with its environment inherit it.
#[cfg(unix)]
const SCAN_TREE_TOKEN_ENV: &str = "SOURDAW_SCAN_TREE_TOKEN";

/// Kill every process left of one scan's tree, found by the token it
/// inherited ([`SCAN_TREE_TOKEN_ENV`]) rather than by parentage: the
/// application's last line of tree containment, run once the supervisor is
/// reaped and the helper's group killed, on every way out of the scan.
///
/// Parentage cannot reach two kinds of escaped descendant: a `setsid` child
/// of a tree whose supervisor was killed from outside its end path (an
/// outside `SIGKILL`, the OOM killer, a plugin killing its parent), which
/// reparented past the dead supervisor; and, on macOS, a `setsid` child its
/// plugin orphaned to launchd between two of the supervisor's walks
/// ([`RecordedDescendants`]). Both still carry the token in the environment
/// they started with. Jenkins' ProcessTreeKiller finds escaped build
/// processes the same way, by an environment cookie they inherited.
///
/// Each pass reads, one process at a time, the initial environment of every
/// process of this effective user other than this one, and stops each one
/// it has not already killed whose environment holds exactly `NAME=token`
/// as soon as it has read it; once the pass is done it kills them all. A
/// stopped process cannot fork before its kill. The sweep ends after a pass
/// that finds nothing new, at [`DESCENDANT_SWEEP_PASSES`] passes, or after
/// the first pass that ends past `deadline`. A killed process is a zombie whose environment no
/// longer reads, so it drops out of later passes.
///
/// Residual limits:
///
/// - A descendant that execs with an environment stripped of the token is
///   out of reach. That is deliberate evasion, outside the threat model on
///   [`kill_own_descendants`].
/// - On Linux, a non-dumpable descendant (one that set `PR_SET_DUMPABLE` to
///   0, or exec'd a setuid or file-capability binary) has a root-owned
///   `/proc/<pid>` and an unreadable environment, so the sweep cannot see
///   it.
/// - On macOS, `KERN_PROCARGS2` returns no environment for a process
///   running an Apple platform binary (`/bin/sh`, `/bin/sleep`, `perl`), so
///   a descendant that execs one is invisible to the sweep. A plugin's own
///   forks, and anything it execs that is not Apple-signed, are seen.
/// - A process that dies, and whose pid is reused, between the read of its
///   environment and its stop: a window of microseconds, the same race
///   accepted on [`RecordedDescendants`]. Once stopped, a process can end
///   only by another's kill.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn sweep_scan_tree(token: &str, deadline: Instant) {
    let entry = format!("{SCAN_TREE_TOKEN_ENV}={token}");
    let mut killed = BTreeSet::new();
    for _ in 0..DESCENDANT_SWEEP_PASSES {
        let stopped = stop_processes_carrying(entry.as_bytes(), &killed);
        if stopped.is_empty() {
            return;
        }
        for pid in stopped {
            send_signal(pid, libc::SIGKILL);
            killed.insert(pid);
        }
        if Instant::now() >= deadline {
            return;
        }
    }
}

/// Elsewhere there is no listing of another process's environment to sweep
/// by: on other Unix systems containment is the tree supervisor's alone, and
/// on Windows the kill-on-close job bounds the whole tree.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn sweep_scan_tree(_token: &str, _deadline: Instant) {}

/// One pass of [`sweep_scan_tree`]: stop every process of this effective
/// user, other than this one and those in `killed`, whose initial
/// environment holds `entry`, right after reading it, and return them. A
/// process whose owner or environment cannot be read is skipped.
#[cfg(target_os = "linux")]
fn stop_processes_carrying(entry: &[u8], killed: &BTreeSet<libc::pid_t>) -> Vec<libc::pid_t> {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: getpid has no preconditions and cannot fail.
    let own = unsafe { libc::getpid() };
    // SAFETY: geteuid has no preconditions and cannot fail.
    let user = unsafe { libc::geteuid() };
    let Ok(processes) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut stopped = Vec::new();
    for process in processes.flatten() {
        let Some(pid) = process
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<libc::pid_t>().ok())
        else {
            continue;
        };
        if pid <= 0 || pid == own || killed.contains(&pid) {
            continue;
        }
        if !fs::metadata(format!("/proc/{pid}")).is_ok_and(|owner| owner.uid() == user) {
            continue;
        }
        let carries = fs::read(format!("/proc/{pid}/environ")).is_ok_and(|environment| {
            environment
                .split(|byte| *byte == 0)
                .any(|variable| variable == entry)
        });
        if carries {
            send_signal(pid, libc::SIGSTOP);
            stopped.push(pid);
        }
    }
    stopped
}

/// One pass of [`sweep_scan_tree`]: stop every process of this effective
/// user, other than this one and those in `killed`, whose initial
/// environment holds `entry`, right after reading it, and return them. A
/// process whose owner or environment cannot be read is skipped.
#[cfg(target_os = "macos")]
fn stop_processes_carrying(entry: &[u8], killed: &BTreeSet<libc::pid_t>) -> Vec<libc::pid_t> {
    // SAFETY: getpid has no preconditions and cannot fail.
    let own = unsafe { libc::getpid() };
    // SAFETY: geteuid has no preconditions and cannot fail.
    let user = unsafe { libc::geteuid() };
    let Some(mut arguments) = process_arguments_buffer() else {
        return Vec::new();
    };
    let mut stopped = Vec::new();
    for pid in all_pids() {
        if pid <= 0 || pid == own || killed.contains(&pid) {
            continue;
        }
        if bsd_info(pid).is_none_or(|info| info.pbi_uid != user) {
            continue;
        }
        let carries = process_arguments(pid, &mut arguments)
            .and_then(procargs_environment)
            .is_some_and(|environment| environment.contains(&entry));
        if carries {
            send_signal(pid, libc::SIGSTOP);
            stopped.push(pid);
        }
    }
    stopped
}

/// Every pid on the system. `proc_listallpids` sizes its answer when handed
/// no buffer; the room above that count takes processes started since.
#[cfg(target_os = "macos")]
fn all_pids() -> Vec<libc::pid_t> {
    // SAFETY: a null buffer of zero bytes asks only for the count.
    let counted = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    let Ok(counted) = usize::try_from(counted) else {
        return Vec::new();
    };
    let mut pids: Vec<libc::pid_t> = vec![0; counted + 64];
    let Ok(buffer_bytes) = libc::c_int::try_from(std::mem::size_of_val(pids.as_slice())) else {
        return Vec::new();
    };
    // SAFETY: `pids` is a writable buffer of exactly `buffer_bytes` bytes
    // that outlives the call.
    let written = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), buffer_bytes) };
    let Ok(written) = usize::try_from(written) else {
        return Vec::new();
    };
    pids.truncate(written.min(pids.len()));
    pids
}

/// A buffer the size of the system's argument limit, which bounds what
/// `KERN_PROCARGS2` returns for any process.
#[cfg(target_os = "macos")]
fn process_arguments_buffer() -> Option<Vec<u8>> {
    let mut mib = [libc::CTL_KERN, libc::KERN_ARGMAX];
    let mut limit: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    // SAFETY: `mib` names a two-level integer sysctl, and `limit` is a
    // writable c_int of exactly `size` bytes; both outlive the call.
    let read = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            2,
            std::ptr::from_mut(&mut limit).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    Some(vec![0; usize::try_from(limit).ok()?])
}

/// The raw `KERN_PROCARGS2` record of `pid`, read into `buffer`.
#[cfg(target_os = "macos")]
fn process_arguments(pid: libc::pid_t, buffer: &mut [u8]) -> Option<&[u8]> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size = buffer.len();
    // SAFETY: `mib` names a three-level sysctl, and `buffer` is writable for
    // `size` bytes; the kernel writes no more and updates `size` to what it
    // wrote. All three outlive the call.
    let read = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buffer.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if read != 0 {
        return None;
    }
    buffer.get(..size)
}

/// The environment strings of a `KERN_PROCARGS2` record: a native-endian
/// `i32` argument count, the executable path, its NUL padding, that many
/// argument strings, then the environment strings up to an empty one. A
/// record too short for what it declares has no environment.
#[cfg(any(target_os = "macos", test))]
fn procargs_environment(record: &[u8]) -> Option<Vec<&[u8]>> {
    let (count, rest) = record.split_first_chunk::<4>()?;
    let count = usize::try_from(i32::from_ne_bytes(*count)).ok()?;
    let mut strings = rest.split(|byte| *byte == 0);
    strings.next()?;
    let mut strings = strings.skip_while(|padding| padding.is_empty());
    for _ in 0..count {
        strings.next()?;
    }
    Some(strings.take_while(|string| !string.is_empty()).collect())
}

/// Start the helper under a tree supervisor and wait for it within
/// `timeout`.
///
/// The supervisor leads its own process group; the helper it starts leads
/// another. The application holds one end of a socket pair, the supervisor
/// the other as its standard input, so the application's death in any form
/// reaches the supervisor as end-of-file. Exit status and response file
/// reach the application exactly as the helper left them.
#[cfg(unix)]
fn run_bounded_in(
    registry: &HelperRegistry,
    supervisor: &TreeSupervisorLaunch<'_>,
    command: &mut Command,
    timeout: Duration,
) -> Result<ExitStatus, ScanFailure> {
    use std::os::unix::process::CommandExt;
    let (application_end, supervisor_end) =
        std::os::unix::net::UnixStream::pair().map_err(|error| ScanFailure::HelperUnstartable {
            cause: error.to_string(),
        })?;
    let tree_token = uuid::Uuid::new_v4().to_string();
    command.env(SCAN_TREE_TOKEN_ENV, &tree_token);
    let mut supervised = supervisor.command_for(command);
    supervised
        .process_group(0)
        .stdin(Stdio::from(std::os::fd::OwnedFd::from(supervisor_end)))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = registry.spawn(&mut supervised, Some(&tree_token))?;
    // Drops the application's copy of the supervisor's end.
    drop(supervised);
    let mut tie = TreeTie {
        socket: Some(application_end),
    };
    let waited = wait_bounded(registry, &mut child, timeout, &mut tie);
    // Every way out of the wait, the bound and a lost observation included,
    // has reaped the supervisor; one that died before its done record left
    // the helper's group to the application. Whatever of the tree escaped
    // both still carries the scan's token.
    let report = tie.report();
    kill_orphaned_helper_group(&report);
    sweep_scan_tree(&tree_token, Instant::now() + TREE_SWEEP_BOUND);
    registry.release_tree_token(&tree_token);
    let status = waited?;
    match tree_report_refusal(&report) {
        Some(refusal) => Err(refusal),
        None => Ok(status),
    }
}

#[cfg(not(unix))]
fn run_bounded_in(
    registry: &HelperRegistry,
    _supervisor: &TreeSupervisorLaunch<'_>,
    command: &mut Command,
    timeout: Duration,
) -> Result<ExitStatus, ScanFailure> {
    // The kill-on-close job bounds the whole tree; no token is needed.
    let mut child = registry.spawn(command, None)?;
    #[cfg(windows)]
    let _job = KillOnCloseJob::assign(&child);
    wait_bounded(registry, &mut child, timeout, &mut TreeTie {})
}

/// Have the kernel kill the helper when the tree supervisor that spawned it
/// dies.
///
/// `PR_SET_PDEATHSIG` fires when the *thread* that forked the child exits,
/// not the process. That is safe here because the supervisor spawns the
/// helper and watches it on one thread, which therefore outlives the helper.
/// The parent check after it closes the race with a supervisor that died
/// before the signal was armed. Only async-signal-safe calls run between
/// fork and exec.
///
/// The signal reaches the helper alone, not its group, and only the
/// supervisor's death fires it. The application's stop and its kill at the
/// scan's bound kill the helper's group and live tree themselves
/// ([`kill_helper_tree`]). Any other death of the supervisor — an outside
/// `SIGKILL`, the OOM killer, a plugin killing its parent — leaves no done
/// record in its report, and the application kills the helper's group when
/// it reaps the supervisor ([`kill_orphaned_helper_group`]), then sweeps a
/// `setsid` descendant of such a tree by its tree token
/// ([`sweep_scan_tree`]). The application's
/// own death is the supervisor's socket end-of-file, after which the
/// supervisor ends the whole tree ([`supervise_helper_tree`]).
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
    tie: &mut TreeTie,
) -> Result<ExitStatus, ScanFailure> {
    let deadline = Instant::now() + timeout;
    loop {
        match registry.try_reap(child) {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                terminate_process_tree(registry, child, tie);
                return Err(ScanFailure::TimedOut);
            }
            Err(error) => {
                terminate_process_tree(registry, child, tie);
                return Err(ScanFailure::HelperUnobservable {
                    cause: error.to_string(),
                });
            }
        }
    }
}

/// Kill and reap the helper's tree: on Unix by releasing its tree
/// supervisor, which can reach what the application cannot, and by the
/// application's own kill when the supervisor does not end in time.
fn terminate_process_tree(registry: &HelperRegistry, child: &mut Child, tie: &mut TreeTie) {
    if tie.release_and_reap(registry, child) {
        return;
    }
    registry.forget(child);
    kill_helper_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

/// Reap the application's child once it has exited — on Unix the tree
/// supervisor, which ran its helper — after killing its tree.
///
/// The group is killed while the helper is still an unreaped zombie: a zombie
/// keeps its pid, so the group id cannot yet belong to an unrelated process.
/// Killing after the reap would race the pid's reuse. `waitid` with `WNOWAIT`
/// observes the exit without reaping, and `try_wait` then reaps it.
#[cfg(unix)]
fn reap_exited_helper(child: &mut Child) -> std::io::Result<Option<ExitStatus>> {
    if !helper_has_exited(child.id())? {
        return Ok(None);
    }
    kill_helper_tree(child.id());
    child.try_wait()
}

#[cfg(not(unix))]
fn reap_exited_helper(child: &mut Child) -> std::io::Result<Option<ExitStatus>> {
    child.try_wait()
}

/// Whether the helper has exited, leaving it waitable.
#[cfg(unix)]
fn helper_has_exited(pid: u32) -> std::io::Result<bool> {
    let mut info = std::mem::MaybeUninit::<libc::siginfo_t>::zeroed();
    // SAFETY: `info` is a writable siginfo_t that outlives the call, and
    // WNOHANG keeps the call from blocking; WNOWAIT leaves the child unreaped.
    let observed = unsafe {
        libc::waitid(
            libc::P_PID,
            pid,
            info.as_mut_ptr(),
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if observed == -1 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::Interrupted {
            return Ok(false);
        }
        return Err(error);
    }
    // SAFETY: an all-zero siginfo_t is a valid value, and waitid either left
    // it so (nothing has exited yet) or filled it in.
    let info = unsafe { info.assume_init() };
    Ok(siginfo_pid(&info) != 0)
}

/// Kill the tree under the application's child, the tree supervisor. Both
/// the supervisor and the helper it starts begin as the leaders of the
/// process groups named by their pids.
///
/// The supervisor is stopped first, so it can reap nothing — no child's pid
/// can be freed — during the kill. Every descendant is then swept while
/// each is alive and stopped: a descendant that called `setsid`, or a helper
/// that moved to another group, has left the group but not the tree, and on
/// macOS, with no subreaper, a helper killed before the sweep would hand
/// its children to launchd, out of every walk. Each of the supervisor's
/// children's groups is killed next, with the child itself (the helper's,
/// and on Linux the group of any `setsid` orphan it adopted;
/// [`kill_led_group`]): the children were listed before the sweep and stay
/// unreaped, so their pids still name them. The supervisor's own group and
/// the supervisor go last. ESRCH from any of the signals means that process
/// or group is already gone.
#[cfg(unix)]
fn kill_helper_tree(pid: u32) {
    let Ok(group) = libc::pid_t::try_from(pid) else {
        return;
    };
    send_signal(group, libc::SIGSTOP);
    let children = child_pids(group);
    kill_descendants(group);
    for &child in &children {
        kill_led_group(child);
    }
    #[cfg(all(test, target_os = "macos"))]
    await_children_released(&children);
    kill_led_group(group);
}

/// Test builds only, macOS: wait, within a second, until each killed child
/// of the supervisor has finished exiting and so holds no children, which
/// launchd then holds instead. It pins the kill's order against the timing
/// of an exit: whatever runs after it sees the helper already gone, as a
/// slower walk on a loaded machine would.
#[cfg(all(test, target_os = "macos"))]
fn await_children_released(children: &[libc::pid_t]) {
    let deadline = Instant::now() + Duration::from_secs(1);
    while children.iter().any(|child| !child_pids(*child).is_empty()) {
        if Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(all(unix, target_os = "linux"))]
fn siginfo_pid(info: &libc::siginfo_t) -> libc::pid_t {
    // SAFETY: waitid filled the SIGCHLD member, or left it zeroed.
    unsafe { info.si_pid() }
}

#[cfg(all(unix, not(target_os = "linux")))]
fn siginfo_pid(info: &libc::siginfo_t) -> libc::pid_t {
    info.si_pid
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

    /// The production bounded spawn, through this test binary's tree
    /// supervisor entry.
    fn run_bounded(command: &mut Command, timeout: Duration) -> Result<ExitStatus, ScanFailure> {
        run_bounded_in(
            &HELPER_REGISTRY,
            &TreeSupervisorLaunch::TestEntry,
            command,
            timeout,
        )
    }

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
            None,
        )
        .result
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
#[cfg(unix)] unsafe extern "C" { fn fork()->i32; fn setsid()->i32; fn _exit(code:i32)->!; fn kill(pid:i32,signal:i32)->i32; fn getppid()->i32; fn getpid()->i32; fn getsid(pid:i32)->i32; fn execve(path:*const c_char,argv:*const *const c_char,envp:*const *const c_char)->i32; }
#[cfg(unix)] fn fork_a_lingering_child(pid_file:std::ffi::OsString){
 let marker=std::env::var_os("SOURDAW_TEST_PLUGIN_LINGER_MARKER");
 let leaves_group=std::env::var_os("SOURDAW_TEST_PLUGIN_LINGER_SETSID").is_some();
 let child=unsafe{fork()};
 if child==0{
  if leaves_group{unsafe{setsid();}}
  std::thread::sleep(std::time::Duration::from_secs(30));
  if let Some(marker)=marker{let _=std::fs::File::create(marker);}
  unsafe{_exit(0)}
 }
 if leaves_group{
  let deadline=std::time::Instant::now()+std::time::Duration::from_secs(2);
  while unsafe{getsid(child)==getsid(0)}&&std::time::Instant::now()<deadline{std::thread::sleep(std::time::Duration::from_millis(1));}
 }
 let _=std::fs::write(pid_file,child.to_string());
}
#[cfg(unix)] fn end_after_lingering(){
 let Ok(then)=std::env::var("SOURDAW_TEST_PLUGIN_LINGER_THEN") else {return;};
 let end=match then.strip_prefix("now-"){Some(end)=>end,None=>{std::thread::sleep(std::time::Duration::from_millis(200));then.as_str()}};
 match end{
  "abort"=>std::process::abort(),
  "hang"=>loop{std::thread::sleep(std::time::Duration::from_secs(1));},
  "kill-parent"=>{unsafe{kill(getppid(),9);}loop{std::thread::sleep(std::time::Duration::from_secs(1));}},
  code=>std::process::exit(code.parse().unwrap_or(1)),
 }
}
#[cfg(unix)] fn orphan_a_grandchild_then_hang(pid_file:std::ffi::OsString){
 if unsafe{fork()}==0{
  let intermediate=unsafe{getpid()};
  if unsafe{fork()}==0{
   unsafe{setsid();}
   while unsafe{getppid()}==intermediate{std::thread::sleep(std::time::Duration::from_millis(5));}
   let _=std::fs::write(pid_file,unsafe{getpid()}.to_string());
   std::thread::sleep(std::time::Duration::from_secs(30));
   unsafe{_exit(0)}
  }
  unsafe{_exit(0)}
 }
 loop{std::thread::sleep(std::time::Duration::from_secs(1));}
}
#[cfg(unix)] fn fork_bare_children(pid_file:std::ffi::OsString){
 let count:usize=std::env::var("SOURDAW_TEST_PLUGIN_BARE_CHILDREN").ok().and_then(|count|count.parse().ok()).unwrap_or(0);
 let program=std::ffi::CString::new("/bin/sleep").unwrap();
 let seconds=std::ffi::CString::new("30").unwrap();
 let argv=[program.as_ptr(),seconds.as_ptr(),std::ptr::null()];
 let envp=[std::ptr::null::<c_char>()];
 let mut pids=String::new();
 for _ in 0..count{
  let child=unsafe{fork()};
  if child==0{unsafe{setsid();execve(program.as_ptr(),argv.as_ptr(),envp.as_ptr());_exit(127)}}
  if child>0{pids.push_str(&child.to_string());pids.push('\n');}
 }
 let _=std::fs::write(pid_file,pids);
 std::process::abort();
}
#[cfg(unix)] fn fork_a_spinning_child(pid_file:std::ffi::OsString){
 let child=unsafe{fork()};
 if child==0{loop{std::hint::spin_loop();}}
 let _=std::fs::write(pid_file,child.to_string());
}
unsafe extern "C" fn init(_: *const c_char)->bool{
 #[cfg(unix)] if let Some(pid_file)=std::env::var_os("SOURDAW_TEST_PLUGIN_FORK_PID_FILE"){
  fork_a_spinning_child(pid_file);
  if std::env::var_os("SOURDAW_TEST_PLUGIN_FORK_THEN_RETURN").is_some(){return true;}
  loop{std::thread::sleep(std::time::Duration::from_secs(1));}
 }
 #[cfg(unix)] if let Some(pid_file)=std::env::var_os("SOURDAW_TEST_PLUGIN_BARE_CHILDREN_PID_FILE"){fork_bare_children(pid_file);}
 #[cfg(unix)] if let Some(pid_file)=std::env::var_os("SOURDAW_TEST_PLUGIN_ORPHAN_PID_FILE"){orphan_a_grandchild_then_hang(pid_file);}
 #[cfg(unix)] if let Some(pid_file)=std::env::var_os("SOURDAW_TEST_PLUGIN_LINGER_PID_FILE"){fork_a_lingering_child(pid_file);end_after_lingering();return false;}
 if std::env::var_os("SOURDAW_TEST_PLUGIN_HANG").is_some(){loop{std::thread::sleep(std::time::Duration::from_secs(1));}}
 if let Some(code)=std::env::var("SOURDAW_TEST_PLUGIN_EXIT_CODE").ok().and_then(|code|code.parse().ok()){std::process::exit(code);}
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
                .and_then(|text| text.trim().parse::<i32>().ok())
                .filter(|pid| *pid > 0)
            {
                return Some(pid);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    #[test]
    fn pid_files_admit_only_positive_process_ids() {
        let path = std::env::temp_dir().join(format!("sourdaw-test-pid-{}", uuid::Uuid::new_v4()));
        let _cleanup = Stragglers::cleaning(vec![path.clone()]);
        for (text, expected) in [
            ("42\n", Some(42)),
            ("-1", None),
            ("0", None),
            ("invalid", None),
        ] {
            fs::write(&path, text).expect("the pid fixture should be written");
            assert_eq!(read_pid_within(&path, Duration::ZERO), expected, "{text:?}");
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
                    send_signal(*pid, libc::SIGKILL);
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
    const PLAIN_SPAWNER_HELPER_LEAVES_GROUP_ENV: &str = "SOURDAW_TEST_PLAIN_SPAWNER_LEAVES_GROUP";
    /// The [`PLAIN_SPAWNER_HELPER_LEAVES_GROUP_ENV`] value for a helper that
    /// also holds a stopped member in the supervisor's group.
    const STOPPED_MEMBER: &str = "stopped-member";

    /// The stand-in spawner for the Linux kernel tie: runs a plain `sh`
    /// helper, which arms no watchdog, through the real bounded spawn. The
    /// test kills this process.
    #[test]
    fn plain_helper_spawner_child() {
        let Some(pid_file) = std::env::var_os(PLAIN_SPAWNER_PID_FILE_ENV) else {
            return;
        };
        let mut command = match std::env::var(PLAIN_SPAWNER_HELPER_LEAVES_GROUP_ENV).as_deref() {
            Ok(STOPPED_MEMBER) => {
                let mut perl = Command::new("perl");
                // As below, and before its pid is written it holds a forked
                // member of the supervisor's group stopped, so killing the
                // spawner orphans a group with a stopped member and the
                // kernel hangs the whole group up.
                perl.args([
                    "-MPOSIX",
                    "-e",
                    "$SIG{HUP} = 'IGNORE'; setpgrp(0, getppid()) or die; \
                     my $m = fork; if (!$m) { kill('STOP', $$); sleep 30; exit 0 } \
                     waitpid($m, POSIX::WUNTRACED) == $m or die; \
                     open(F, '>', \"$ARGV[0].member\"); print F $m; close(F); \
                     open(F, '>', $ARGV[0]); print F $$; close(F); sleep 30",
                ]);
                perl
            }
            Ok(_) => {
                let mut perl = Command::new("perl");
                // Joins the supervisor's group, so only its own pid still
                // names it. It ignores SIGHUP, as a plugin can: killing the
                // spawner orphans that group, and a member already stopped
                // would otherwise bring the kernel's hangup down on the
                // helper.
                perl.args([
                    "-e",
                    "$SIG{HUP} = 'IGNORE'; setpgrp(0, getppid()) or die; open(F, '>', $ARGV[0]); print F $$; close(F); sleep 30",
                ]);
                perl
            }
            Err(_) => {
                let mut sh = Command::new("sh");
                sh.args(["-c", "echo $$ > \"$0\"; exec sleep 30"]);
                sh
            }
        };
        command.arg(pid_file);
        let _ = run_bounded_in(
            &HelperRegistry::new(),
            &TreeSupervisorLaunch::TestEntry,
            &mut command,
            WORKER_TIMEOUT,
        );
    }

    /// Only the tree supervisor can end this helper inside the window, on its
    /// socket's end-of-file: the helper runs no watchdog, the spawner's own
    /// bound dies with the spawner, and the supervisor, the helper's parent,
    /// is alive, so no parent-death signal fires.
    #[cfg(unix)]
    #[test]
    fn a_killed_spawner_takes_a_plain_helper_with_it() {
        let (helper, _stragglers) = plain_helper_of_a_killed_spawner(None);

        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "plain helper {helper} outlived its killed spawner"
        );
    }

    /// The helper's group no longer names it, so only a signal to its own
    /// pid ends it, and until it ends the supervisor cannot reap it.
    #[cfg(unix)]
    #[test]
    fn a_killed_spawner_takes_a_helper_that_left_its_group_with_it() {
        let (helper, _stragglers) = plain_helper_of_a_killed_spawner(Some("1"));

        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "helper {helper} that left its group outlived its killed spawner"
        );
    }

    /// Killing the spawner orphans the supervisor's group while a member of
    /// it is stopped, so the kernel sends the whole group SIGHUP and
    /// SIGCONT. The supervisor must survive the hangup to end the helper,
    /// which ignores it.
    #[cfg(unix)]
    #[test]
    fn a_hangup_of_the_supervisors_group_still_ends_the_helper() {
        let (helper, _stragglers) = plain_helper_of_a_killed_spawner(Some(STOPPED_MEMBER));

        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "helper {helper} outlived a hangup of its supervisor's group"
        );
    }

    /// Start [`plain_helper_spawner_child`], wait for its helper, kill the
    /// spawner and return the helper's pid with the cleanup that still ends
    /// the helper if an assertion fails; the caller holds it past its
    /// assertions.
    #[cfg(unix)]
    fn plain_helper_of_a_killed_spawner(leaves_group: Option<&str>) -> (i32, Stragglers) {
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-plain-helper-{}", uuid::Uuid::new_v4()));
        let member_file = PathBuf::from(format!("{}.member", pid_file.display()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone(), member_file.clone()]);
        let mut spawner =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        spawner
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::plain_helper_spawner_child")
            .env(PLAIN_SPAWNER_PID_FILE_ENV, &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(mode) = leaves_group {
            spawner.env(PLAIN_SPAWNER_HELPER_LEAVES_GROUP_ENV, mode);
        }
        let spawner = spawner.spawn().expect("the stand-in spawner should start");
        let spawner_pid = i32::try_from(spawner.id()).expect("a pid fits an i32");
        stragglers.children.push(spawner);

        let helper = read_pid_within(&pid_file, Duration::from_secs(10))
            .expect("the plain helper should start and write its pid");
        stragglers.pids.push(helper);
        // Written before the helper's own pid, when the helper forked one.
        if let Some(member) = read_pid_within(&member_file, Duration::ZERO) {
            stragglers.pids.push(member);
        }

        // SAFETY: kill takes plain values; the spawner is this test's child.
        assert_eq!(unsafe { libc::kill(spawner_pid, libc::SIGKILL) }, 0);
        for child in &mut stragglers.children {
            let _ = child.wait();
        }
        (helper, stragglers)
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
        let request = HelperRequest {
            format: PluginFormat::Clap,
            path: Path::new(&plugin_path),
            plugin_id: None,
            worker_argument: WORKER_ARGUMENT,
        };
        let _ = scan_worker_with::<Vec<ScannedDescriptor>>(
            &launcher,
            &TreeSupervisorLaunch::TestEntry,
            &PinnedResponseStorage,
            &request,
            WORKER_TIMEOUT,
            None,
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
    /// end the helper inside it. What does is the tree supervisor's socket,
    /// pinned on its own by `a_killed_spawner_takes_a_plain_helper_with_it`;
    /// the supervisor's own death is pinned by
    /// `a_killed_tree_supervisor_takes_its_helpers_group_with_it`.
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

    const RETURNING_HELPER_MARKER_ENV: &str = "SOURDAW_TEST_RETURNING_HELPER";

    /// The stand-in helper for a plugin that forks a spinning child and then
    /// returns: the real worker entry, ended by its own exit code.
    #[test]
    fn returning_helper_child() {
        if std::env::var_os(RETURNING_HELPER_MARKER_ENV).is_none() {
            return;
        }
        let code = run_from_process_args().expect("the worker arguments name an extraction");
        std::process::exit(code);
    }

    /// A helper that exits on its own, with no timeout and no stop, still
    /// takes its process group with it: the spawner kills the group when it
    /// observes the exit, before it reaps the helper.
    #[cfg(unix)]
    #[test]
    fn a_helper_that_returns_leaves_no_forked_child_behind() {
        let fixture = build_hostile_clap("fork-return");
        let fork_pid_file =
            std::env::temp_dir().join(format!("sourdaw-returned-child-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![fork_pid_file.clone()]);
        let launcher = ScanWorkerCommand {
            program: std::env::current_exe().expect("test executable should exist"),
            // `--` hands the worker arguments to libtest as extra filters,
            // which match no test, rather than as unknown options.
            args: vec![
                "--exact".to_string(),
                "host::plugin_scan_worker::tests::returning_helper_child".to_string(),
                "--".to_string(),
            ],
            env: BTreeMap::from([
                (RETURNING_HELPER_MARKER_ENV.to_string(), "1".to_string()),
                (
                    "SOURDAW_TEST_PLUGIN_FORK_PID_FILE".to_string(),
                    fork_pid_file.display().to_string(),
                ),
                (
                    "SOURDAW_TEST_PLUGIN_FORK_THEN_RETURN".to_string(),
                    "1".to_string(),
                ),
            ]),
        };

        let _ = scan_descriptor_through(launcher, &fixture.plugin_path);

        let forked = read_pid_within(&fork_pid_file, Duration::from_secs(1))
            .expect("the plugin should have forked its child and recorded its pid");
        stragglers.pids.push(forked);
        assert!(
            process_has_exited_within(forked, Duration::from_secs(3)),
            "the plugin's forked child {forked} outlived the helper that returned"
        );
    }

    #[cfg(unix)]
    const MOVED_HELPER_TARGET_GROUP_ENV: &str = "SOURDAW_TEST_MOVED_HELPER_GROUP";

    /// Wait for the original group to gain a member, arm the real watchdog,
    /// then simulate a plugin moving this helper into another group.
    #[cfg(unix)]
    #[test]
    fn moved_out_helper_child() {
        let Ok(target) = std::env::var(MOVED_HELPER_TARGET_GROUP_ENV) else {
            return;
        };
        let target: libc::pid_t = target
            .parse()
            .expect("the helper needs a group to move into");
        std::io::stdin()
            .read_exact(&mut [0])
            .expect("the runner should release the helper after the group member starts");
        arm_helper_watchdog(Duration::from_secs(1));
        assert_eq!(
            // SAFETY: setpgid takes plain values.
            unsafe { libc::setpgid(0, target) },
            0,
            "the move must succeed"
        );
        loop {
            std::hint::spin_loop();
        }
    }

    /// A process in the original group but outside the helper's descendant
    /// tree can be reached only by the watchdog's remembered group kill.
    #[cfg(unix)]
    #[test]
    fn a_helper_moved_out_of_its_group_still_ends_the_group_it_led() {
        use std::os::unix::process::{CommandExt, ExitStatusExt};

        let mut stragglers = Stragglers::cleaning(Vec::new());
        // SAFETY: getpgrp has no preconditions and cannot fail.
        let runner_group = unsafe { libc::getpgrp() };
        let mut helper =
            Command::new(std::env::current_exe().expect("test executable should exist"))
                .arg("--exact")
                .arg("host::plugin_scan_worker::tests::moved_out_helper_child")
                .env(MOVED_HELPER_TARGET_GROUP_ENV, runner_group.to_string())
                .env_remove(SCAN_PARENT_PID_ENV)
                .process_group(0)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("the stand-in helper should start");
        let helper_group = libc::pid_t::try_from(helper.id()).expect("the helper has a valid pid");
        let mut release = helper.stdin.take().expect("the helper stdin is piped");
        stragglers.children.push(helper);
        let group_member = Command::new("sleep")
            .arg("30")
            .process_group(helper_group)
            .spawn()
            .expect("the runner's child should join the helper's original group");
        stragglers.children.push(group_member);
        release.write_all(b"1").expect("the helper should begin");

        let helper_status = exit_status_within(&mut stragglers.children[0], Duration::from_secs(5));
        assert_eq!(
            helper_status.and_then(|status| status.code()),
            Some(HELPER_DEADLINE_EXIT_CODE),
            "the moved helper must end by its watchdog exit: {helper_status:?}"
        );
        let member_status = exit_status_within(&mut stragglers.children[1], Duration::from_secs(2));
        assert_eq!(
            member_status.and_then(|status| status.signal()),
            Some(libc::SIGKILL),
            "the original group member must end by SIGKILL: {member_status:?}"
        );
    }

    /// A helper that moved itself out of its group is beyond `kill(-pid)`;
    /// stop reaches it through its own pid.
    #[cfg(unix)]
    #[test]
    fn a_stopped_scan_kills_a_helper_that_left_its_group() {
        let registry = std::sync::Arc::new(HelperRegistry::new());
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-left-group-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        // SAFETY: getpgrp has no preconditions and cannot fail.
        let runner_group = unsafe { libc::getpgrp() };
        let scanning = std::sync::Arc::clone(&registry);
        let hanging_pid_file = pid_file.clone();
        std::thread::spawn(move || {
            let mut command = Command::new("perl");
            command
                .args([
                    "-e",
                    "setpgrp(0, $ARGV[1]) or die; open(F, '>', $ARGV[0]); print F $$; close(F); sleep 30",
                ])
                .arg(&hanging_pid_file)
                .arg(runner_group.to_string());
            let _ = run_bounded_in(
                &scanning,
                &TreeSupervisorLaunch::TestEntry,
                &mut command,
                WORKER_TIMEOUT,
            );
        });
        // The pid is written only after the helper has left its group.
        let helper = read_pid_within(&pid_file, Duration::from_secs(5))
            .expect("the helper should leave its group and write its pid");
        stragglers.pids.push(helper);

        registry.stop();

        assert!(
            process_has_exited_within(helper, Duration::from_secs(2)),
            "the stopped helper {helper} survived because it left its group"
        );
        stragglers.pids.retain(|pid| *pid != helper);
    }

    /// A stopped scan's helper forked a child that left every group with
    /// `setsid`. Only the walk of the stopped tree reaches that child, and
    /// only while the helper lives: on macOS a helper killed first hands it
    /// to launchd, out of every walk.
    #[cfg(unix)]
    #[test]
    fn a_stopped_scan_kills_a_setsid_child_of_its_helper() {
        let registry = std::sync::Arc::new(HelperRegistry::new());
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-stopped-setsid-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        let scanning = std::sync::Arc::clone(&registry);
        let child_pid_file = pid_file.clone();
        std::thread::spawn(move || {
            let mut command = Command::new("perl");
            command
                .args([
                    "-MPOSIX",
                    "-e",
                    "if (!fork) { POSIX::setsid() > 0 or die; \
                     open(F, '>', $ARGV[0]); print F $$; close(F); sleep 30; exit 0 } \
                     sleep 30",
                ])
                .arg(&child_pid_file);
            let _ = run_bounded_in(
                &scanning,
                &TreeSupervisorLaunch::TestEntry,
                &mut command,
                WORKER_TIMEOUT,
            );
        });
        let child = read_pid_within(&pid_file, Duration::from_secs(5))
            .expect("the helper's child should leave every group and write its pid");
        stragglers.pids.push(child);

        registry.stop();

        assert!(
            process_has_exited_within(child, Duration::from_secs(2)),
            "the setsid child {child} of a stopped scan's helper survived"
        );
    }

    /// #7122: a stopped scan's helper double-forked, and the intermediate
    /// exited at once, so its `setsid` grandchild is out of the helper's
    /// parentage before the stop. The stop's kill walks parentage, and the
    /// stopped scan's thread parks before its own sweep, so only the stop's
    /// sweep by the scan's tree token reaches the grandchild. On Linux the
    /// orphan reparents to the supervisor, its subreaper, and parentage still
    /// reaches it: this case discriminates on macOS only.
    #[cfg(unix)]
    #[test]
    fn a_stopped_scan_kills_a_grandchild_orphaned_out_of_its_tree() {
        let registry = std::sync::Arc::new(HelperRegistry::new());
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-stopped-orphan-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        let fixture = build_hostile_clap("stopped-orphan");
        let mut command = hostile_command(&fixture.plugin_path);
        command.env("SOURDAW_TEST_PLUGIN_ORPHAN_PID_FILE", &pid_file);
        let scanning = std::sync::Arc::clone(&registry);
        std::thread::spawn(move || {
            let _ = run_bounded_in(
                &scanning,
                &TreeSupervisorLaunch::TestEntry,
                &mut command,
                WORKER_TIMEOUT,
            );
        });
        // The pid is written only once the grandchild is orphaned.
        let grandchild = read_pid_within(&pid_file, Duration::from_secs(5))
            .expect("the orphaned grandchild should write its pid");
        stragglers.pids.push(grandchild);

        registry.stop();

        assert!(
            process_has_exited_within(grandchild, Duration::from_secs(2)),
            "the orphaned grandchild {grandchild} of a stopped scan survived"
        );
    }

    #[cfg(unix)]
    const TOKEN_CARRIER_ENV: &str = "SOURDAW_TEST_TOKEN_CARRIER";

    /// A process that carries a scan's tree token and nothing else of its
    /// tree: this test binary, so the token is readable on macOS, where an
    /// Apple platform binary's environment is not.
    #[cfg(unix)]
    #[test]
    fn token_carrier_child() {
        if std::env::var_os(TOKEN_CARRIER_ENV).is_none() {
            return;
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    /// How a scan's supervisor leaves the registry's live set before the
    /// scan's own sweep by tree token runs.
    #[cfg(unix)]
    enum SupervisorExit {
        /// `try_reap` reaps it: the scan ended on its own.
        Reaped,
        /// `forget` drops it and the scan reaps it itself: the scan's bound.
        Forgotten,
    }

    /// #7122: a scan sweeps by its tree token only after its supervisor has
    /// left the registry's live set, through `try_reap` when the scan ends
    /// and through `forget` at its bound. A stop that lands in that gap parks
    /// the scan before its sweep, so the token must still be registered for
    /// the stop to sweep it. A short-lived stand-in supervisor leaves by
    /// `exit`, while a carrier outside the registry holds the same token in
    /// its environment; the stop must kill the carrier.
    #[cfg(unix)]
    fn stop_after_the_supervisor_leaves(exit: SupervisorExit) {
        use std::os::unix::process::CommandExt;
        let registry = HelperRegistry::new();
        let tree_token = uuid::Uuid::new_v4().to_string();
        let mut stragglers = Stragglers::cleaning(Vec::new());
        let mut carrier =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        carrier
            .args([
                "--exact",
                "host::plugin_scan_worker::tests::token_carrier_child",
            ])
            .env(TOKEN_CARRIER_ENV, "1")
            .env(SCAN_TREE_TOKEN_ENV, &tree_token)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        stragglers
            .children
            .push(carrier.spawn().expect("the token carrier should start"));
        let mut supervisor = Command::new("true");
        supervisor.process_group(0);
        let mut supervisor = registry
            .spawn(&mut supervisor, Some(&tree_token))
            .expect("the stand-in supervisor should start");
        match exit {
            SupervisorExit::Reaped => {
                let deadline = Instant::now() + Duration::from_secs(2);
                let reaped = loop {
                    if let Some(status) = registry
                        .try_reap(&mut supervisor)
                        .expect("the stand-in supervisor stays observable")
                    {
                        break Some(status);
                    }
                    if Instant::now() >= deadline {
                        break None;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                };
                assert!(
                    reaped.is_some(),
                    "the stand-in supervisor should exit at once"
                );
            }
            SupervisorExit::Forgotten => {
                registry.forget(&supervisor);
                let _ = supervisor.wait();
            }
        }

        registry.stop();

        let status = exit_status_within(&mut stragglers.children[0], Duration::from_secs(2));
        assert_eq!(
            status.and_then(|status| std::os::unix::process::ExitStatusExt::signal(&status)),
            Some(libc::SIGKILL),
            "the escaped process of a scan whose supervisor left survived the stop: {status:?}"
        );
    }

    /// Mutation this catches: the token released when `try_reap`
    /// deregisters the supervisor, rather than after the scan's sweep.
    #[cfg(unix)]
    #[test]
    fn a_stop_sweeps_the_token_of_a_scan_whose_supervisor_is_already_reaped() {
        stop_after_the_supervisor_leaves(SupervisorExit::Reaped);
    }

    /// Mutation this catches: the token released when `forget` drops the
    /// supervisor at the scan's bound, rather than after the scan's sweep.
    #[cfg(unix)]
    #[test]
    fn a_stop_sweeps_the_token_of_a_scan_whose_supervisor_was_forgotten() {
        stop_after_the_supervisor_leaves(SupervisorExit::Forgotten);
    }

    /// A helper that answers and exits 0 still takes the child it left in its
    /// process group with it: the spawner kills the group on a clean exit too.
    #[cfg(unix)]
    #[test]
    fn a_clean_helper_exit_also_ends_the_child_left_in_its_group() {
        let pid_file =
            std::env::temp_dir().join(format!("sourdaw-clean-helper-{}", uuid::Uuid::new_v4()));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        let mut command = Command::new("sh");
        command
            .args(["-c", "sleep 30 & echo $! > \"$0\"; exit 0"])
            .arg(&pid_file);

        let status = run_bounded_in(
            &HelperRegistry::new(),
            &TreeSupervisorLaunch::TestEntry,
            &mut command,
            WORKER_TIMEOUT,
        )
        .expect("the helper should exit within its bound");
        let lingering = read_pid_within(&pid_file, Duration::ZERO)
            .expect("the helper writes its child's pid before it exits");
        stragglers.pids.push(lingering);

        assert!(status.success(), "the helper must exit cleanly: {status:?}");
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the child {lingering} outlived its cleanly exited helper"
        );
    }

    /// A plugin's child that left the helper's process group with `setsid`
    /// is out of reach of every group kill; the helper's own descendant kill
    /// on its clean exit is what ends it.
    #[cfg(unix)]
    #[test]
    fn a_clean_helper_exit_also_ends_a_child_that_left_its_group() {
        let fixture = build_hostile_clap("linger-setsid");
        let scratch =
            std::env::temp_dir().join(format!("sourdaw-setsid-child-{}", uuid::Uuid::new_v4()));
        let pid_file = scratch.with_extension("pid");
        let response_path = scratch.with_extension("json");
        let marker = scratch.with_extension("marker");
        let mut stragglers = Stragglers::cleaning(vec![
            pid_file.clone(),
            response_path.clone(),
            marker.clone(),
        ]);
        let mut command =
            Command::new(std::env::current_exe().expect("test executable should exist"));
        command
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::real_worker_entry_child")
            .env(REAL_WORKER_PLUGIN_ENV, &fixture.plugin_path)
            .env(REAL_WORKER_RESPONSE_ENV, &response_path)
            .env("SOURDAW_TEST_PLUGIN_LINGER_PID_FILE", &pid_file)
            .env("SOURDAW_TEST_PLUGIN_LINGER_SETSID", "1")
            .env("SOURDAW_TEST_PLUGIN_LINGER_MARKER", &marker)
            .env_remove(SCAN_PARENT_PID_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let status = run_bounded_in(
            &HelperRegistry::new(),
            &TreeSupervisorLaunch::TestEntry,
            &mut command,
            WORKER_TIMEOUT,
        )
        .expect("the helper should exit within its bound");
        let lingering = read_pid_within(&pid_file, Duration::ZERO)
            .expect("the plugin writes its child's pid before the helper answers");
        stragglers.pids.push(lingering);

        assert_eq!(status.code(), Some(0), "the helper must exit cleanly");
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its cleanly exited helper"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// This test binary's tree supervisor: the real supervisor entry, handed
    /// the helper's command line by environment because the test harness
    /// would refuse the supervisor marker as an unknown option.
    #[test]
    fn tree_supervisor_child() {
        let Some(line) = std::env::var_os(TEST_TREE_SUPERVISOR_ARGV_ENV) else {
            return;
        };
        let line: Vec<String> = serde_json::from_str(&line.to_string_lossy())
            .expect("the helper's command line is a JSON string list");
        let arguments = [
            OsString::from("sourdaw-tree-supervisor-child"),
            OsString::from(TREE_SUPERVISOR_ARGUMENT),
        ]
        .into_iter()
        .chain(line.into_iter().map(OsString::from));
        std::process::exit(run_from_args(arguments).unwrap_or(2));
    }

    #[test]
    fn the_tree_supervisor_marker_takes_the_helpers_whole_command_line() {
        let arguments = args(&[
            "/helper",
            TREE_SUPERVISOR_ARGUMENT,
            "/helper",
            WORKER_ARGUMENT,
            "clap",
            "/p.clap",
            "/out.json",
        ]);
        assert_eq!(
            worker_role(&arguments),
            Some(WorkerRole::SuperviseTree {
                helper: &arguments[2..]
            })
        );
        assert_eq!(
            worker_role(&args(&["/helper", TREE_SUPERVISOR_ARGUMENT])),
            Some(WorkerRole::Malformed)
        );
        let named_like_the_marker = args(&[
            "/helper",
            WORKER_ARGUMENT,
            "clap",
            TREE_SUPERVISOR_ARGUMENT,
            "/out.json",
        ]);
        assert!(
            matches!(
                worker_role(&named_like_the_marker),
                Some(WorkerRole::Extract { .. })
            ),
            "a plugin path spelling the marker must not turn a helper into a supervisor"
        );
    }

    /// The exit the application reads is the helper's own, code or signal,
    /// and a helper the supervisor could not start is the application's
    /// refusal, as it was when the application started helpers itself.
    #[cfg(unix)]
    #[test]
    fn the_tree_supervisor_relays_its_helpers_exit_exactly() {
        use std::os::unix::process::ExitStatusExt;

        let mut exits = Command::new("sh");
        exits.args(["-c", "exit 7"]);
        let status = run_bounded(&mut exits, WORKER_TIMEOUT).expect("the helper should exit");
        assert_eq!(status.code(), Some(7));

        let mut aborts = Command::new("sh");
        aborts.args(["-c", "kill -ABRT $$"]);
        let status = run_bounded(&mut aborts, WORKER_TIMEOUT).expect("the helper should die");
        assert_eq!(status.signal(), Some(libc::SIGABRT), "{status:?}");

        let mut missing = Command::new("/nonexistent/sourdaw-scan-helper");
        let refusal = run_bounded(&mut missing, WORKER_TIMEOUT)
            .expect_err("a helper that cannot start is refused");
        assert!(
            matches!(&refusal, ScanFailure::HelperUnstartable { .. }),
            "{refusal}"
        );
        assert!(
            refusal
                .to_string()
                .starts_with("Cannot start plugin scan helper: "),
            "{refusal}"
        );
        assert!(!refusal.is_process_failure(), "{refusal}");
        assert!(!refusal.is_response_limit_refusal(), "{refusal}");
    }

    #[cfg(unix)]
    #[test]
    fn only_a_supervisor_that_never_reached_its_spawn_refuses() {
        for report in [&b"P\n"[..], b"P\nR4242\n", b"P\nR4242\nD\n"] {
            assert_eq!(
                tree_report_refusal(&parse_tree_report(report)),
                None,
                "{}",
                String::from_utf8_lossy(report)
            );
        }
        let cases: [(&[u8], &str, ScanFailure); 4] = [
            (
                b"",
                "Plugin scan tree supervisor ended before it started a helper",
                ScanFailure::SupervisorEndedEarly,
            ),
            (
                b"X\n",
                "Plugin scan tree supervisor ended before it started a helper",
                ScanFailure::SupervisorEndedEarly,
            ),
            (
                b"P\nFno such file\n",
                "Cannot start plugin scan helper: no such file",
                ScanFailure::HelperUnstartable {
                    cause: "no such file".to_string(),
                },
            ),
            (
                b"P\nR4242\nUgone\nD\n",
                "Cannot observe plugin scan helper: gone",
                ScanFailure::HelperUnobservable {
                    cause: "gone".to_string(),
                },
            ),
        ];
        for (report, message, variant) in cases {
            let refusal = tree_report_refusal(&parse_tree_report(report))
                .expect("a supervisor that never reached its spawn refuses");
            assert_eq!(refusal, variant);
            assert_eq!(refusal.to_string(), message);
            assert!(!refusal.is_process_failure(), "{message}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_report_names_its_helper_and_whether_the_supervisor_finished() {
        assert_eq!(
            parse_tree_report(b"P\nR4242\n"),
            TreeReport {
                spawning: true,
                helper: Some(4242),
                ..TreeReport::default()
            }
        );
        assert!(parse_tree_report(b"P\nR4242\nD\n").done);
        assert_eq!(parse_tree_report(b"P\nR1\n").helper, None);
        assert_eq!(parse_tree_report(b"P\nRx\n").helper, None);
    }

    /// A plugin that kills its tree supervisor before the supervisor reports
    /// the start must still quarantine, as a helper killed on its own always
    /// did: the supervisor's death after its spawning record is the plugin's
    /// process failure, never the application's refusal.
    #[cfg(unix)]
    #[test]
    fn a_supervisor_killed_right_after_its_spawn_quarantines() {
        let env = BTreeMap::from([(
            TEST_TREE_SUPERVISOR_DIES_AFTER_SPAWN_ENV.to_string(),
            "1".to_string(),
        )]);
        let error = scan_descriptor_through(
            real_worker_launcher(env),
            Path::new("/nonexistent/sourdaw-killed-supervisor.clap"),
        )
        .expect_err("a scan whose supervisor died cannot answer");

        assert!(
            matches!(error, ScanFailure::ExitedUnsuccessfully { .. }),
            "{error}"
        );
        assert!(error.is_process_failure());
    }

    /// A plugin forks a child, the child leaves the helper's group with
    /// `setsid`, and the plugin then ends the helper by `then` before the
    /// helper's own sweep can run. Returns the scan's answer and the child.
    #[cfg(unix)]
    fn scan_leaving_a_setsid_child(
        test_name: &str,
        then: &str,
    ) -> (
        Result<Vec<ScannedDescriptor>, ScanFailure>,
        i32,
        Stragglers,
        PathBuf,
    ) {
        let fixture = build_hostile_clap(test_name);
        let scratch =
            std::env::temp_dir().join(format!("sourdaw-{test_name}-{}", uuid::Uuid::new_v4()));
        let pid_file = scratch.with_extension("pid");
        let marker = scratch.with_extension("marker");
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone(), marker.clone()]);
        let env = BTreeMap::from([
            (
                "SOURDAW_TEST_PLUGIN_LINGER_PID_FILE".to_string(),
                pid_file.display().to_string(),
            ),
            (
                "SOURDAW_TEST_PLUGIN_LINGER_SETSID".to_string(),
                "1".to_string(),
            ),
            (
                "SOURDAW_TEST_PLUGIN_LINGER_MARKER".to_string(),
                marker.display().to_string(),
            ),
            (
                "SOURDAW_TEST_PLUGIN_LINGER_THEN".to_string(),
                then.to_string(),
            ),
        ]);
        let result = scan_descriptor_through(real_worker_launcher(env), &fixture.plugin_path);
        let lingering = read_pid_within(&pid_file, Duration::ZERO)
            .expect("the plugin writes its child's pid before it ends the helper");
        stragglers.pids.push(lingering);
        (result, lingering, stragglers, marker)
    }

    /// The helper's own sweep never runs when the plugin aborts it; the tree
    /// supervisor's sweep after the helper's exit is what ends the child.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_aborts_leaves_no_setsid_child_behind() {
        let (result, lingering, _stragglers, marker) =
            scan_leaving_a_setsid_child("abort-setsid", "abort");

        assert!(
            matches!(result, Err(ScanFailure::ExitedUnsuccessfully { .. })),
            "an aborting plugin is a crash: {:?}",
            result.as_ref().err()
        );
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its aborted helper"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// The same for a plugin that exits 0 from inside its entry point: the
    /// helper leaves no response, which reads as it always has.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_exits_leaves_no_setsid_child_behind() {
        let (result, lingering, _stragglers, marker) =
            scan_leaving_a_setsid_child("exit-setsid", "0");

        assert!(
            matches!(&result, Err(failure @ ScanFailure::NoResponse { .. })
                if failure.to_string().starts_with("Plugin scan helper returned no metadata: ")),
            "a helper that exits 0 without answering returned nothing: {:?}",
            result.as_ref().err()
        );
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its exited helper"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// #7122: a plugin that dies right after forking its `setsid` child
    /// leaves no tick for the macOS supervisor's walk to record the child
    /// in, and with no subreaper there the child is out of every later walk.
    /// The application's sweep by the scan's tree token is what ends it.
    /// This case discriminates on macOS only: on Linux the supervisor is the
    /// tree's subreaper and reaps the child itself, and only
    /// `a_plugin_that_kills_its_supervisor_leaves_no_setsid_child_behind`
    /// needs the sweep there.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_aborts_at_once_leaves_no_setsid_child_behind() {
        let (result, lingering, _stragglers, marker) =
            scan_leaving_a_setsid_child("abort-now-setsid", "now-abort");

        assert!(
            matches!(result, Err(ScanFailure::ExitedUnsuccessfully { .. })),
            "an aborting plugin is a crash: {:?}",
            result.as_ref().err()
        );
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its helper, aborted at once"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// The same for a plugin that exits 0 at once from its entry point, and
    /// likewise discriminating on macOS only.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_exits_at_once_leaves_no_setsid_child_behind() {
        let (result, lingering, _stragglers, marker) =
            scan_leaving_a_setsid_child("exit-now-setsid", "now-0");

        assert!(
            matches!(&result, Err(ScanFailure::NoResponse { .. })),
            "a helper that exits 0 without answering returned nothing: {:?}",
            result.as_ref().err()
        );
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its helper, exited at once"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// #7122: a plugin that kills its tree supervisor takes the supervisor's
    /// end path with it, and its `setsid` child has reparented past the dead
    /// supervisor, out of the application's group kill. The scan still
    /// quarantines, and the application's sweep by the scan's tree token
    /// ends the child.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_kills_its_supervisor_leaves_no_setsid_child_behind() {
        let (result, lingering, _stragglers, marker) =
            scan_leaving_a_setsid_child("kill-parent-setsid", "now-kill-parent");

        assert!(
            result.as_ref().is_err_and(ScanFailure::is_process_failure),
            "a plugin that kills its supervisor is a process failure: {:?}",
            result.as_ref().err()
        );
        assert!(
            process_has_exited_within(lingering, Duration::from_secs(2)),
            "the setsid child {lingering} outlived its killed supervisor"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// The environment is read past the argument count the record declares,
    /// so an argument shaped like the token is never taken for it, and a
    /// record shorter than it declares has none.
    #[test]
    fn a_process_argument_record_yields_only_its_environment() {
        let mut record = 2_i32.to_ne_bytes().to_vec();
        record.extend_from_slice(b"/bin/helper\0\0\0\0helper\0A=argument\0A=1\0B=2\0\0junk\0");
        assert_eq!(
            procargs_environment(&record),
            Some(vec![&b"A=1"[..], &b"B=2"[..]])
        );

        let mut short = 3_i32.to_ne_bytes().to_vec();
        short.extend_from_slice(b"/bin/helper\0\0helper\0A=1");
        assert_eq!(procargs_environment(&short), None);
        assert_eq!(procargs_environment(b"\x01\0"), None);
        assert_eq!(procargs_environment(&(-1_i32).to_ne_bytes()), None);
    }

    /// #7122: an orphaned tree wider than one sweep's process cap is still
    /// killed to its last process, because the supervisor repeats its sweep,
    /// reaping between passes, until no child is left. Every child execs
    /// with an empty environment, so it carries no tree token and only the
    /// supervisor's subreaper loop can reach it. Mutation this catches:
    /// [`reap_adopted_tree`] sweeping once.
    #[cfg(target_os = "linux")]
    #[test]
    fn an_orphaned_tree_past_the_sweep_cap_is_killed_to_its_last_process() {
        let fixture = build_hostile_clap("past-sweep-cap");
        let pid_file = std::env::temp_dir().join(format!(
            "sourdaw-past-sweep-cap-{}.pids",
            uuid::Uuid::new_v4()
        ));
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone()]);
        let count = DESCENDANT_SWEEP_MAX_PROCESSES * 3;
        let env = BTreeMap::from([
            (
                "SOURDAW_TEST_PLUGIN_BARE_CHILDREN_PID_FILE".to_string(),
                pid_file.display().to_string(),
            ),
            (
                "SOURDAW_TEST_PLUGIN_BARE_CHILDREN".to_string(),
                count.to_string(),
            ),
        ]);
        let result = scan_descriptor_through(real_worker_launcher(env), &fixture.plugin_path);
        let children: Vec<i32> = fs::read_to_string(&pid_file)
            .expect("the plugin writes its children's pids before it aborts")
            .lines()
            .filter_map(|pid| pid.parse().ok())
            .filter(|pid| *pid > 0)
            .collect();
        stragglers.pids.extend(&children);

        assert!(
            matches!(result, Err(ScanFailure::ExitedUnsuccessfully { .. })),
            "an aborting plugin is a crash: {:?}",
            result.as_ref().err()
        );
        assert_eq!(children.len(), count, "every fork must succeed");
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut survivors = children;
        loop {
            survivors.retain(|pid| !process_has_exited_within(*pid, Duration::ZERO));
            if survivors.is_empty() || Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            survivors.is_empty(),
            "{} of {count} orphans outlived the supervisor's sweep",
            survivors.len()
        );
    }

    #[cfg(unix)]
    const LINGERING_SPAWNER_PLUGIN_ENV: &str = "SOURDAW_TEST_LINGERING_SPAWNER_PLUGIN";

    /// The stand-in spawner for a scan whose plugin leaves a `setsid` child
    /// and hangs. The test kills this process.
    #[cfg(unix)]
    #[test]
    fn lingering_spawner_child() {
        let Some(plugin_path) = std::env::var_os(LINGERING_SPAWNER_PLUGIN_ENV) else {
            return;
        };
        let _ = scan_descriptor_through(
            real_worker_launcher(BTreeMap::new()),
            Path::new(&plugin_path),
        );
    }

    /// The application killed outright mid-scan: the helper hangs and its
    /// parent, the tree supervisor, is alive, so the helper's own ties hold
    /// until its deadline, far past the window. The supervisor's socket
    /// end-of-file is what ends the helper and its `setsid` child.
    #[cfg(unix)]
    #[test]
    fn a_killed_spawner_leaves_no_setsid_child_behind() {
        let fixture = build_hostile_clap("spawner-setsid");
        let scratch =
            std::env::temp_dir().join(format!("sourdaw-spawner-setsid-{}", uuid::Uuid::new_v4()));
        let pid_file = scratch.with_extension("pid");
        let marker = scratch.with_extension("marker");
        let mut stragglers = Stragglers::cleaning(vec![pid_file.clone(), marker.clone()]);
        let spawner = Command::new(std::env::current_exe().expect("test executable should exist"))
            .arg("--exact")
            .arg("host::plugin_scan_worker::tests::lingering_spawner_child")
            .env(LINGERING_SPAWNER_PLUGIN_ENV, &fixture.plugin_path)
            .env("SOURDAW_TEST_PLUGIN_LINGER_PID_FILE", &pid_file)
            .env("SOURDAW_TEST_PLUGIN_LINGER_SETSID", "1")
            .env("SOURDAW_TEST_PLUGIN_LINGER_MARKER", &marker)
            .env("SOURDAW_TEST_PLUGIN_LINGER_THEN", "hang")
            .env_remove(SCAN_PARENT_PID_ENV)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("the stand-in spawner should start");
        let spawner_pid = i32::try_from(spawner.id()).expect("a pid fits an i32");
        stragglers.children.push(spawner);

        let lingering = read_pid_within(&pid_file, Duration::from_secs(10))
            .expect("the plugin should fork its setsid child and record its pid");
        stragglers.pids.push(lingering);
        assert!(
            !process_is_gone_within(lingering, Duration::from_millis(300)),
            "the setsid child {lingering} must be running before its spawner dies"
        );

        // SAFETY: kill takes plain values; the spawner is this test's child.
        assert_eq!(unsafe { libc::kill(spawner_pid, libc::SIGKILL) }, 0);
        for child in &mut stragglers.children {
            let _ = child.wait();
        }

        assert!(
            process_has_exited_within(lingering, Duration::from_secs(3)),
            "the setsid child {lingering} outlived its killed spawner"
        );
        assert!(!marker.exists(), "the setsid child ran to completion");
    }

    /// A tree supervisor killed from outside the application's control — an
    /// outside `SIGKILL`, the OOM killer, a plugin killing its parent — takes
    /// the helper's whole group with it: the helper runs no watchdog, and
    /// the child it forked into its group is reached only by the
    /// application's group kill on reaping a supervisor that never finished
    /// ([`kill_orphaned_helper_group`]). A `setsid` child of such a tree is
    /// the token sweep's to end
    /// (`a_plugin_that_kills_its_supervisor_leaves_no_setsid_child_behind`).
    #[cfg(unix)]
    #[test]
    fn a_killed_tree_supervisor_takes_its_helpers_group_with_it() {
        let scratch =
            std::env::temp_dir().join(format!("sourdaw-killed-tree-{}", uuid::Uuid::new_v4()));
        let parent_file = scratch.with_extension("parent");
        let helper_file = scratch.with_extension("helper");
        let grouped_file = scratch.with_extension("grouped");
        let mut stragglers = Stragglers::cleaning(vec![
            parent_file.clone(),
            helper_file.clone(),
            grouped_file.clone(),
        ]);
        let (parent_path, helper_path, grouped_path) = (
            parent_file.clone(),
            helper_file.clone(),
            grouped_file.clone(),
        );
        std::thread::spawn(move || {
            let mut command = Command::new("sh");
            command
                .args([
                    "-c",
                    "sleep 30 & echo $! > \"$2\"; echo $PPID > \"$0\"; echo $$ > \"$1\"; \
                     exec sleep 30",
                ])
                .arg(&parent_path)
                .arg(&helper_path)
                .arg(&grouped_path);
            let _ = run_bounded_in(
                &HelperRegistry::new(),
                &TreeSupervisorLaunch::TestEntry,
                &mut command,
                WORKER_TIMEOUT,
            );
        });
        let helper = read_pid_within(&helper_file, Duration::from_secs(10))
            .expect("the plain helper should start and write its pid");
        stragglers.pids.push(helper);
        let grouped = read_pid_within(&grouped_file, Duration::from_secs(1))
            .expect("the plain helper writes its grouped child's pid first");
        stragglers.pids.push(grouped);
        let supervisor = read_pid_within(&parent_file, Duration::from_secs(1))
            .expect("the plain helper writes its parent's pid before its own");

        // SAFETY: kill takes plain values; the supervisor is this test's
        // child, unreaped until the scan thread reaps it.
        assert_eq!(unsafe { libc::kill(supervisor, libc::SIGKILL) }, 0);

        assert!(
            process_has_exited_within(grouped, Duration::from_secs(3)),
            "the helper's grouped child {grouped} outlived its killed tree supervisor"
        );
        assert!(
            process_has_exited_within(helper, Duration::from_secs(3)),
            "plain helper {helper} outlived its killed tree supervisor"
        );
    }

    /// A tree supervisor that dies inside the release grace, before its own
    /// end path, leaves the helper's group to the application on the
    /// timeout path too; the scan still answers that it timed out.
    #[cfg(unix)]
    #[test]
    fn a_supervisor_killed_while_released_at_the_bound_takes_its_helpers_group_with_it() {
        let scratch =
            std::env::temp_dir().join(format!("sourdaw-released-tree-{}", uuid::Uuid::new_v4()));
        let helper_file = scratch.with_extension("helper");
        let grouped_file = scratch.with_extension("grouped");
        let mut stragglers = Stragglers::cleaning(vec![helper_file.clone(), grouped_file.clone()]);
        let mut command = Command::new("sh");
        command
            .args([
                "-c",
                "sleep 30 & echo $! > \"$1\"; echo $$ > \"$0\"; exec sleep 30",
            ])
            .arg(&helper_file)
            .arg(&grouped_file)
            .env(TEST_TREE_SUPERVISOR_DIES_ON_RELEASE_ENV, "1");

        let result = run_bounded(&mut command, Duration::from_secs(1));

        if let Some(helper) = read_pid_within(&helper_file, Duration::ZERO) {
            stragglers.pids.push(helper);
        }
        let grouped = read_pid_within(&grouped_file, Duration::ZERO)
            .expect("the helper writes its grouped child's pid within the bound");
        stragglers.pids.push(grouped);
        assert!(
            matches!(result, Err(ScanFailure::TimedOut)),
            "a scan that reached its bound timed out: {result:?}"
        );
        assert!(
            process_has_exited_within(grouped, Duration::from_secs(2)),
            "the helper's grouped child {grouped} outlived its supervisor's death at the bound"
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
            let _ = sender.send(run_bounded_in(
                &scanning,
                &TreeSupervisorLaunch::TestEntry,
                &mut command,
                WORKER_TIMEOUT,
            ));
        });
        let helper = read_pid_within(&pid_file, Duration::from_secs(5))
            .expect("the hanging helper should start and write its pid");
        stragglers.pids.push(helper);

        registry.stop();

        assert!(
            process_has_exited_within(helper, Duration::from_secs(2)),
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
            let _ = later_sender.send(run_bounded_in(
                &later_registry,
                &TreeSupervisorLaunch::TestEntry,
                &mut later,
                WORKER_TIMEOUT,
            ));
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
                before_spawn(SHORT_VOLUME),
                storage_full_probe,
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
    }

    /// Every failure this module generates beside the classified ones, each
    /// with the full text it carried as a `String` before it had a variant.
    fn generated_data_level_failures() -> Vec<(ScanFailure, &'static str)> {
        let cause = || "denied".to_string();
        vec![
            (
                ScanFailure::NoBackend {
                    format: PluginFormat::Vst2,
                },
                "No plugin scan backend for format vst2",
            ),
            (
                ScanFailure::LauncherUnresolvable { cause: cause() },
                "Cannot resolve plugin scan helper executable: denied",
            ),
            (
                ScanFailure::LauncherInvalid { cause: cause() },
                "SOURDAW_PLUGIN_SCAN_WORKER_COMMAND is not a valid command: denied",
            ),
            (
                ScanFailure::LauncherNamesNoProgram,
                "SOURDAW_PLUGIN_SCAN_WORKER_COMMAND names no program",
            ),
            (
                ScanFailure::LauncherNotUtf8,
                "SOURDAW_PLUGIN_SCAN_WORKER_COMMAND is not valid UTF-8",
            ),
            (
                ScanFailure::Scope(RuntimeScopeRefusal::Invalid),
                "Native runtime scope must be an existing canonical UUID directory in the reserved namespace",
            ),
            (
                ScanFailure::ResponseDirectoryUncreatable { cause: cause() },
                "Cannot create plugin scan response directory: denied",
            ),
            (
                ScanFailure::ResponseDirectoryUnopenable { cause: cause() },
                "Cannot open plugin scan response directory: denied",
            ),
            (
                ScanFailure::HelperUnstartable { cause: cause() },
                "Cannot start plugin scan helper: denied",
            ),
            (
                ScanFailure::HelperUnobservable { cause: cause() },
                "Cannot observe plugin scan helper: denied",
            ),
            (
                ScanFailure::SupervisorEndedEarly,
                "Plugin scan tree supervisor ended before it started a helper",
            ),
            (
                ScanFailure::ResponseUnreadable { cause: cause() },
                "Cannot read plugin scan helper response: denied",
            ),
            (
                ScanFailure::NoResponse { cause: cause() },
                "Plugin scan helper returned no metadata: denied",
            ),
            (
                ScanFailure::ResponseInvalid { cause: cause() },
                "Plugin scan helper returned invalid metadata: denied",
            ),
            (
                ScanFailure::SameProcess,
                "Plugin metadata extraction did not cross a process boundary",
            ),
        ]
    }

    #[test]
    fn generated_data_level_failures_keep_their_historical_text() {
        for (failure, text) in generated_data_level_failures() {
            assert_eq!(failure.to_string(), text);
        }
    }

    /// Mutation this catches: adding any generated data-level variant to
    /// either classification, which would quarantine a binary over a read
    /// failure or blame a row on the helper's limit.
    #[test]
    fn generated_data_level_failures_are_neither_classification() {
        for (failure, text) in generated_data_level_failures() {
            assert!(!failure.is_process_failure(), "{text}");
            assert!(!failure.is_response_limit_refusal(), "{text}");
        }
    }

    /// The launcher declaration's refusals are their variants, not text.
    #[test]
    fn launcher_declaration_refusals_are_typed() {
        assert!(matches!(
            ScanWorkerCommand::from_json("not json"),
            Err(ScanFailure::LauncherInvalid { .. })
        ));
        assert_eq!(
            ScanWorkerCommand::from_json(r#"{"program":""}"#),
            Err(ScanFailure::LauncherNamesNoProgram)
        );
    }

    /// A format with no backend is refused by its variant before any spawn.
    #[test]
    fn a_format_without_a_backend_is_refused_as_no_backend() {
        let attempt: ScanAttempt<Vec<ScannedDescriptor>> = scan_descriptor_metadata(
            PluginFormat::Vst2,
            Path::new("/plugins/Legacy.dll"),
            WORKER_TIMEOUT,
            None,
        );
        let failure = attempt.result.expect_err("vst2 has no scan backend");
        assert_eq!(
            failure,
            ScanFailure::NoBackend {
                format: PluginFormat::Vst2
            }
        );
        assert_eq!(
            failure.to_string(),
            "No plugin scan backend for format vst2"
        );
        assert_eq!(attempt.consumed_bytes, None);
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
        scan_descriptor_through(
            stand_in_launcher(script, BTreeMap::new()),
            Path::new("/plugins/Stand-in.clap"),
        )
    }

    #[cfg(unix)]
    fn stand_in_launcher(script: String, env: BTreeMap<String, String>) -> ScanWorkerCommand {
        ScanWorkerCommand {
            program: PathBuf::from("/bin/sh"),
            args: vec![
                "-c".to_string(),
                format!("eval \"out=\\${{$#}}\"\n{script}"),
                "sh".to_string(),
            ],
            env,
        }
    }

    /// One descriptor pass through the real `scan_worker_with`, bounded on
    /// its own thread so a read that blocks fails the test.
    #[cfg(unix)]
    fn scan_descriptor_through(
        launcher: ScanWorkerCommand,
        plugin_path: &Path,
    ) -> Result<Vec<ScannedDescriptor>, ScanFailure> {
        scan_descriptor_observing(launcher, PinnedResponseStorage, plugin_path, None).result
    }

    /// [`scan_descriptor_through`] with the supervisor's storage readings
    /// taken by `storage`, and `recorded_consumption` as an earlier scan of the
    /// binary left it.
    #[cfg(unix)]
    fn scan_descriptor_observing(
        launcher: ScanWorkerCommand,
        storage: impl ResponseStorage + Send + 'static,
        plugin_path: &Path,
        recorded_consumption: Option<u64>,
    ) -> ScanAttempt<Vec<ScannedDescriptor>> {
        let plugin_path = plugin_path.to_path_buf();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let request = HelperRequest {
                format: PluginFormat::Clap,
                path: &plugin_path,
                plugin_id: None,
                worker_argument: WORKER_ARGUMENT,
            };
            let _ = sender.send(scan_worker_with::<Vec<ScannedDescriptor>>(
                &launcher,
                &TreeSupervisorLaunch::TestEntry,
                &storage,
                &request,
                WORKER_TIMEOUT,
                recorded_consumption,
            ));
        });
        receiver
            .recv_timeout(WORKER_TIMEOUT + Duration::from_secs(5))
            .expect("the scan must return instead of blocking on the response")
    }

    #[cfg(unix)]
    const REAL_WORKER_EXE_ENV: &str = "SOURDAW_TEST_REAL_WORKER_EXE";
    const REAL_WORKER_PLUGIN_ENV: &str = "SOURDAW_TEST_REAL_WORKER_PLUGIN";
    const REAL_WORKER_RESPONSE_ENV: &str = "SOURDAW_TEST_REAL_WORKER_RESPONSE";

    /// The real worker entry, re-entered from this test binary with the
    /// descriptor pass's arguments handed over by environment, because the
    /// test harness would refuse the worker marker as an unknown option.
    #[test]
    fn real_worker_entry_child() {
        let (Some(plugin_path), Some(response_path)) = (
            std::env::var_os(REAL_WORKER_PLUGIN_ENV),
            std::env::var_os(REAL_WORKER_RESPONSE_ENV),
        ) else {
            return;
        };
        let code = run_from_args([
            OsString::from("sourdaw-real-worker-child"),
            OsString::from(WORKER_ARGUMENT),
            OsString::from(PluginFormat::Clap.wire_name()),
            plugin_path,
            response_path,
        ]);
        std::process::exit(code.unwrap_or(2));
    }

    /// A launcher that runs [`real_worker_entry_child`] for the descriptor
    /// pass the supervisor asks for: `$3` is the plugin, `$4` the response.
    #[cfg(unix)]
    fn real_worker_launcher(mut env: BTreeMap<String, String>) -> ScanWorkerCommand {
        env.insert(
            REAL_WORKER_EXE_ENV.to_string(),
            std::env::current_exe()
                .expect("test executable should exist")
                .display()
                .to_string(),
        );
        stand_in_launcher(
            format!(
                "export {REAL_WORKER_PLUGIN_ENV}=\"$3\" {REAL_WORKER_RESPONSE_ENV}=\"$out\"\n\
                 exec \"${REAL_WORKER_EXE_ENV}\" --exact \
                 host::plugin_scan_worker::tests::real_worker_entry_child"
            ),
            env,
        )
    }

    /// #6662, end to end: a plugin whose `init` calls `exit(3)` picks the
    /// helper's write-refusal exit code, but the response directory the
    /// supervisor probes is writable, so the scan reports a process failure —
    /// what quarantines the binary. Mutation this catches: classifying exit 3
    /// without the supervisor's own probe.
    #[cfg(unix)]
    #[test]
    fn a_plugin_that_exits_3_from_init_is_a_process_failure() {
        let fixture = build_hostile_clap("exit3");
        let env = BTreeMap::from([(
            "SOURDAW_TEST_PLUGIN_EXIT_CODE".to_string(),
            RESPONSE_WRITE_REFUSAL_EXIT_CODE.to_string(),
        )]);

        let error = scan_descriptor_through(real_worker_launcher(env), &fixture.plugin_path)
            .expect_err("a plugin that exits from init must fail its scan");

        assert_eq!(
            error,
            ScanFailure::ExitedUnsuccessfully {
                path: fixture.plugin_path.clone()
            }
        );
        assert!(error.is_process_failure(), "{error}");
    }

    /// The launcher reaches the real entry and the entry writes its answer,
    /// so the test above observes the plugin's exit code and not a launcher
    /// that failed to start: a launch failure would also read as a process
    /// failure, but never as this data-level refusal.
    #[cfg(unix)]
    #[test]
    fn the_real_worker_launcher_runs_the_worker_entry() {
        let error = scan_descriptor_through(
            real_worker_launcher(BTreeMap::new()),
            Path::new("/nonexistent/sourdaw-missing.clap"),
        )
        .expect_err("a missing plugin cannot be described");

        assert!(
            matches!(error, ScanFailure::Refused(_)),
            "the worker entry must have answered: {error}"
        );
    }

    /// The forgeries a plugin can arrange before exiting 3, each of which
    /// must still quarantine: no fault at all, a directory it made
    /// unwritable, and the directory moved aside for a symlink to a
    /// read-only volume. The last is what the supervisor's pinned handle is
    /// for: probing by path would follow the link and meet a genuine
    /// read-only filesystem.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_a_plugin_arranged_still_quarantines() {
        let moved_aside = RemovedOnDrop(
            std::env::temp_dir().join(format!("sourdaw-moved-response-{}", uuid::Uuid::new_v4())),
        );
        let moved = moved_aside.0.display();
        for (forgery, script) in [
            ("plain exit 3", "exit 3".to_string()),
            (
                "unwritable directory",
                "chmod 500 \"$(dirname \"$out\")\"\nexit 3".to_string(),
            ),
            (
                "directory swapped for a symlink",
                format!("d=\"$(dirname \"$out\")\"\nmv \"$d\" \"{moved}\"\nln -s / \"$d\"\nexit 3"),
            ),
        ] {
            let error =
                scan_with_stand_in_helper(script).expect_err("an exit 3 must fail the scan");

            assert!(error.is_process_failure(), "{forgery}: {error}");
        }
        assert!(
            moved_aside.0.is_dir(),
            "the symlink case must have run: the moved directory is its proof"
        );
    }

    /// A directory a test's helper creates outside any response directory,
    /// removed however the test ends.
    #[cfg(unix)]
    struct RemovedOnDrop(PathBuf);

    #[cfg(unix)]
    impl Drop for RemovedOnDrop {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A response past the limit is written as its length alone and read
    /// back as the helper's limit with the true size — never exit 3, which
    /// would now quarantine a plugin for being large (#3866).
    #[test]
    fn an_oversized_answer_reaches_the_supervisor_as_a_limit_refusal() {
        let directory =
            ResponseDirectory::create().expect("the response directory should be created");
        let response_path = directory.path.join("metadata.json");
        let response = WorkerResponse {
            worker_pid: std::process::id().wrapping_add(1),
            result: Ok::<_, String>("a".repeat(MAX_RESPONSE_BYTES as usize + 1)),
        };
        let serialized = serde_json::to_vec(&response)
            .expect("the response should serialize")
            .len();

        write_response(&response_path, &response)
            .expect("an oversized answer must still leave a response, not refuse");

        assert_eq!(
            read_response_bytes(&response_path, Path::new("/plugins/Large.clap")),
            Err(ScanFailure::ResponseOverLimit { bytes: serialized })
        );
    }

    struct Unserializable;

    impl Serialize for Unserializable {
        fn serialize<S: serde::Serializer>(&self, _serializer: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("refused by the fixture"))
        }
    }

    /// A response that will not serialize is replaced by an `Err` the
    /// supervisor reads as data, never exit 3.
    #[test]
    fn an_unserializable_answer_is_written_as_a_data_level_error() {
        let directory =
            ResponseDirectory::create().expect("the response directory should be created");
        let response_path = directory.path.join("metadata.json");

        write_response(
            &response_path,
            &WorkerResponse {
                worker_pid: std::process::id().wrapping_add(1),
                result: Ok::<_, String>(Unserializable),
            },
        )
        .expect("an unserializable answer must still leave a response");

        let bytes = read_response_bytes(&response_path, Path::new("/plugins/Odd.clap"))
            .expect("the stand-in response should be readable");
        let response: WorkerResponse<Vec<ScannedDescriptor>> =
            serde_json::from_slice(&bytes).expect("the stand-in response should parse");
        assert_eq!(
            response.result,
            Err("Cannot serialize plugin scan response: refused by the fixture".to_string())
        );
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

    /// A supervisor probe that met a full disk, as the OS reports one.
    #[cfg(unix)]
    fn storage_full_probe() -> std::io::Result<()> {
        Err(std::io::Error::from_raw_os_error(libc::ENOSPC))
    }

    /// The hardening this exit code exists for (#2911): a systemic fault that
    /// stops the worker from writing *any* response must not read as a
    /// crashing plugin, or a single bad environment quarantines every
    /// candidate the process ever touches on one scan. Each fault is the OS
    /// error the supervisor's own probe meets, so the platform's mapping of it
    /// is what is under test. Mutation this catches: dropping a kind from
    /// `is_storage_fault`, or ignoring the probe's verdict.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_the_supervisors_probe_confirms_is_a_write_refusal() {
        let path = Path::new("/plugins/Innocent.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        for (fault, errno) in [
            ("full disk", libc::ENOSPC),
            ("exhausted quota", libc::EDQUOT),
            ("read-only filesystem", libc::EROFS),
            ("failing disk", libc::EIO),
        ] {
            let message = process_failure(path, &status, before_spawn(SHORT_VOLUME), || {
                Err(std::io::Error::from_raw_os_error(errno))
            });

            assert_eq!(message, write_refused("/plugins/Innocent.clap"), "{fault}");
            assert!(!message.is_process_failure(), "{fault}: {message}");
        }
    }

    /// Free space below [`ROOM_FOR_HELPER_ATTRIBUTION`] by one byte: a volume
    /// already short before the helper started.
    #[cfg(unix)]
    const SHORT_VOLUME: Option<u64> = Some(ROOM_FOR_HELPER_ATTRIBUTION - 1);

    /// Exactly [`ROOM_FOR_HELPER_ATTRIBUTION`] free: the least room for which
    /// a full disk afterwards is the helper's doing.
    #[cfg(unix)]
    const ROOMY_VOLUME: Option<u64> = Some(ROOM_FOR_HELPER_ATTRIBUTION);

    /// This spawn's free-space reading alone, for a binary with no earlier
    /// run recorded.
    #[cfg(unix)]
    fn before_spawn(room_before_spawn: Option<u64>) -> FillEvidence {
        FillEvidence {
            room_before_spawn,
            recorded_consumption: None,
        }
    }

    /// #6936: a plugin can fill the volume and then exit 3, so a full disk
    /// after a spawn onto a volume with room is the helper's own doing and
    /// quarantines. Mutation this catches: dropping the free-space
    /// attribution, or comparing with `>` so the boundary admits the plugin.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_that_filled_a_volume_with_room_quarantines() {
        let path = Path::new("/plugins/Filler.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        for (volume, room) in [
            ("room exactly at the bound", ROOMY_VOLUME),
            ("ample room", Some(u64::MAX)),
        ] {
            let message = process_failure(path, &status, before_spawn(room), storage_full_probe);

            assert_eq!(
                message,
                exited_unsuccessfully("/plugins/Filler.clap"),
                "{volume}"
            );
            assert!(message.is_process_failure(), "{volume}: {message}");
        }
    }

    /// The other side of #6936: a good plugin whose response meets a volume
    /// that was already short before its helper started, or whose free space
    /// could not be read, keeps the non-quarantining refusal. Mutation this
    /// catches: attributing every full disk to the helper, or treating an
    /// unreadable volume as one with room.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_on_a_volume_already_short_keeps_the_refusal() {
        let path = Path::new("/plugins/Innocent.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        for (volume, room) in [
            ("one byte short", SHORT_VOLUME),
            ("no room at all", Some(0)),
            ("unreadable free space", None),
        ] {
            let message = process_failure(path, &status, before_spawn(room), storage_full_probe);

            assert_eq!(message, write_refused("/plugins/Innocent.clap"), "{volume}");
            assert!(!message.is_process_failure(), "{volume}: {message}");
        }
    }

    /// The storage faults a plugin cannot produce, or that the free-space
    /// reading cannot see, keep the refusal however much room the volume
    /// had. Mutation this catches: attributing by free space for every
    /// storage fault rather than for a full disk alone.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_storage_fault_free_space_cannot_explain_keeps_the_refusal_on_a_roomy_volume() {
        let path = Path::new("/plugins/Innocent.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        for (fault, errno) in [
            ("exhausted quota", libc::EDQUOT),
            ("read-only filesystem", libc::EROFS),
            ("failing disk", libc::EIO),
        ] {
            let message = process_failure(path, &status, before_spawn(ROOMY_VOLUME), || {
                Err(std::io::Error::from_raw_os_error(errno))
            });

            assert_eq!(message, write_refused("/plugins/Innocent.clap"), "{fault}");
            assert!(!message.is_process_failure(), "{fault}: {message}");
        }
    }

    /// The supervisor reads real free space through its pinned handle: the
    /// reading is nonzero and agrees, within concurrent disk activity, with an
    /// independent path-based `statvfs` of the same directory. Mutations this
    /// catches: a constant reading, or dropping the block-size factor.
    #[cfg(unix)]
    #[test]
    fn a_pinned_response_directory_reads_its_volumes_free_space() {
        crate::host::runtime_scope::RuntimeScope::test_in_process(
            concat!(
                module_path!(),
                "::a_pinned_response_directory_reads_its_volumes_free_space"
            ),
            |_root| {
                let directory = ResponseDirectory::create().unwrap();

                let pinned = directory.available_bytes().expect("a pinned reading");
                let by_path = available_bytes_by_path(&directory.path);

                assert!(pinned > 0, "a live volume has free space");
                assert!(
                    pinned.abs_diff(by_path) <= 64 * 1024 * 1024,
                    "pinned {pinned} bytes against {by_path} by path"
                );
            },
        );
    }

    /// `f_bavail * f_frsize` for `path`, read by path rather than through a
    /// pinned descriptor.
    #[cfg(unix)]
    fn available_bytes_by_path(path: &Path) -> u64 {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: `path` is NUL-terminated and outlives the call, and `stats`
        // is writable storage for one `statvfs`.
        let status = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
        assert_eq!(status, 0);
        // SAFETY: `statvfs` returned 0, so it filled `stats`.
        let stats = unsafe { stats.assume_init() };
        widened(stats.f_bavail) * widened(stats.f_frsize)
    }

    /// The marker the stand-in helper leaves in its response directory, so a
    /// storage reading can tell whether the helper has run yet.
    #[cfg(unix)]
    const HELPER_RAN_MARKER: &str = "helper-ran";

    /// A volume with `room_before` free until the stand-in helper has run and
    /// `room_after` once it has, whose disk is full by the time the supervisor
    /// probes. Each reading records whether the helper had already run when it
    /// was taken.
    #[cfg(unix)]
    struct FullDiskAfterSpawn {
        room_before: Option<u64>,
        room_after: Option<u64>,
        readings: std::sync::Arc<std::sync::Mutex<Vec<(&'static str, bool)>>>,
    }

    #[cfg(unix)]
    impl FullDiskAfterSpawn {
        fn record(&self, reading: &'static str, directory: &ResponseDirectory) -> bool {
            let helper_ran = directory.path.join(HELPER_RAN_MARKER).exists();
            self.readings.lock().unwrap().push((reading, helper_ran));
            helper_ran
        }
    }

    #[cfg(unix)]
    impl ResponseStorage for FullDiskAfterSpawn {
        fn available_bytes(&self, directory: &ResponseDirectory) -> Option<u64> {
            if self.record("free space", directory) {
                return self.room_after;
            }
            self.room_before
        }

        fn probe_write(&self, directory: &ResponseDirectory) -> std::io::Result<()> {
            self.record("probe", directory);
            storage_full_probe()
        }
    }

    /// A stand-in helper that marks its response directory and exits 3.
    #[cfg(unix)]
    fn exit_3_script() -> String {
        format!(": > \"$(dirname \"$out\")/{HELPER_RAN_MARKER}\"\nexit 3")
    }

    /// A stand-in helper that marks its response directory and answers.
    #[cfg(unix)]
    fn exit_0_script() -> String {
        format!(
            ": > \"$(dirname \"$out\")/{HELPER_RAN_MARKER}\"\nprintf '%s' '{VALID_RESPONSE}' > \"$out\"\nexit 0"
        )
    }

    /// One scan of `script` through the real spawn path onto `storage`'s
    /// volume, for a binary whose earlier runs recorded
    /// `recorded_consumption`. Returns the attempt and the order the
    /// supervisor took its readings in.
    #[cfg(unix)]
    fn scan_onto(
        script: String,
        room_before: Option<u64>,
        room_after: Option<u64>,
        recorded_consumption: Option<u64>,
    ) -> (
        ScanAttempt<Vec<ScannedDescriptor>>,
        Vec<(&'static str, bool)>,
    ) {
        let readings = std::sync::Arc::default();
        let storage = FullDiskAfterSpawn {
            room_before,
            room_after,
            readings: std::sync::Arc::clone(&readings),
        };
        let attempt = scan_descriptor_observing(
            stand_in_launcher(script, BTreeMap::new()),
            storage,
            Path::new("/plugins/Stand-in.clap"),
            recorded_consumption,
        );
        let readings = readings.lock().unwrap().clone();
        (attempt, readings)
    }

    /// One exit 3 onto a disk that is full afterwards, with `room` free before
    /// the spawn and no earlier run recorded.
    #[cfg(unix)]
    fn scan_exit_3_onto_full_disk(room: Option<u64>) -> (ScanFailure, Vec<(&'static str, bool)>) {
        let (attempt, readings) = scan_onto(exit_3_script(), room, Some(0), None);
        let error = attempt.result.expect_err("an exit 3 must fail the scan");
        (error, readings)
    }

    /// The readings an exit 3 takes: free space before the helper runs and
    /// after it exits, then the probe.
    #[cfg(unix)]
    const EXIT_3_READINGS: [(&str, bool); 3] =
        [("free space", false), ("free space", true), ("probe", true)];

    /// #6936 through the spawn path: the free space is read before the helper
    /// runs, the probe after it, and a roomy volume the helper filled
    /// quarantines. Mutations this catches: dropping the spawn-site reading,
    /// or taking it after the helper has run.
    #[cfg(unix)]
    #[test]
    fn a_helper_that_exits_3_onto_a_disk_it_filled_quarantines_through_the_spawn_path() {
        let (error, readings) = scan_exit_3_onto_full_disk(ROOMY_VOLUME);

        assert_eq!(readings, EXIT_3_READINGS);
        assert_eq!(error, exited_unsuccessfully("/plugins/Stand-in.clap"));
    }

    /// The sibling: the same exit onto a volume already short before the
    /// spawn keeps the non-quarantining refusal.
    #[cfg(unix)]
    #[test]
    fn a_helper_that_exits_3_onto_an_already_short_volume_keeps_the_refusal_through_the_spawn_path()
    {
        let (error, readings) = scan_exit_3_onto_full_disk(SHORT_VOLUME);

        assert_eq!(readings, EXIT_3_READINGS);
        assert_eq!(error, write_refused("/plugins/Stand-in.clap"));
    }

    /// A run that answers the scan is measured too: free space is read before
    /// the spawn and again after the exit, and the fall between them is the
    /// run's consumption. Mutation this catches: taking the after-exit
    /// reading only on a failed exit, or not at all.
    #[cfg(unix)]
    #[test]
    fn a_helper_that_exits_0_has_its_consumption_measured_after_it_exits() {
        let (attempt, readings) = scan_onto(exit_0_script(), Some(5_000), Some(4_000), None);

        assert_eq!(readings, [("free space", false), ("free space", true)]);
        assert_eq!(attempt.consumed_bytes, Some(1_000));
        assert_eq!(attempt.result.ok(), Some(Vec::new()));
    }

    /// #6943, the split fill: one run answers the scan after taking most of a
    /// roomy volume, and the next exits 3 onto the short volume it left. The
    /// first run's consumption, handed to the second, attributes the full
    /// disk. Mutation this catches: ignoring the recorded consumption.
    #[cfg(unix)]
    #[test]
    fn a_binary_that_filled_the_volume_on_an_earlier_run_quarantines_on_a_short_volume() {
        let (filled, _) = scan_onto(exit_0_script(), ROOMY_VOLUME, Some(0), None);
        assert!(filled.result.is_ok(), "the filling run answers the scan");

        let (attempt, _) = scan_onto(exit_3_script(), Some(0), Some(0), filled.consumed_bytes);

        assert_eq!(
            attempt.result.err(),
            Some(exited_unsuccessfully("/plugins/Stand-in.clap"))
        );
    }

    /// The regression pin for the user's own fill: an earlier run on a roomy
    /// volume that consumed little, then an exit 3 onto a volume the user
    /// filled between scans, keeps the refusal, as does one just under the
    /// consumption bound. Mutation this catches: attributing by any earlier
    /// room or any recorded consumption rather than by a run's own fill.
    #[cfg(unix)]
    #[test]
    fn a_binary_scanned_on_a_roomy_volume_the_user_then_filled_keeps_the_refusal() {
        let (earlier, _) = scan_onto(
            exit_0_script(),
            ROOMY_VOLUME,
            ROOMY_VOLUME.map(|room| room - 1),
            None,
        );
        assert_eq!(earlier.consumed_bytes, Some(1));

        for (history, recorded_consumption) in [
            ("a small earlier run", earlier.consumed_bytes),
            (
                "just under the bound",
                Some(CONSUMPTION_FOR_HELPER_ATTRIBUTION - 1),
            ),
            ("no history", None),
        ] {
            let (attempt, _) = scan_onto(exit_3_script(), Some(0), Some(0), recorded_consumption);

            assert_eq!(
                attempt.result.err(),
                Some(write_refused("/plugins/Stand-in.clap")),
                "{history}"
            );
        }
    }

    /// Which probe errors keep the non-quarantining refusal. Systemic storage
    /// faults, including a failing disk's EIO, refuse: quarantining there
    /// would blame every good plugin. Permission and missing-entry errors are
    /// what a same-user plugin can arrange on the supervisor's 0700
    /// directory, so they must stay rejected. Mutation this catches: dropping
    /// the EIO match, or admitting `PermissionDenied`.
    #[cfg(unix)]
    #[test]
    fn only_storage_faults_count_as_genuine_write_refusals() {
        use std::io::{Error, ErrorKind};
        let cases = [
            ("StorageFull", Error::from(ErrorKind::StorageFull), true),
            ("QuotaExceeded", Error::from(ErrorKind::QuotaExceeded), true),
            (
                "ReadOnlyFilesystem",
                Error::from(ErrorKind::ReadOnlyFilesystem),
                true,
            ),
            ("EIO", Error::from_raw_os_error(libc::EIO), true),
            (
                "PermissionDenied",
                Error::from(ErrorKind::PermissionDenied),
                false,
            ),
            ("EACCES", Error::from_raw_os_error(libc::EACCES), false),
            ("NotFound", Error::from(ErrorKind::NotFound), false),
            ("ENOENT", Error::from_raw_os_error(libc::ENOENT), false),
        ];
        for (name, error, refuses) in cases {
            assert_eq!(is_storage_fault(&error), refuses, "{name}: {error}");
        }
    }

    /// #6662: the plugin runs inside the helper and can exit 3 itself. An exit
    /// 3 the supervisor's own write contradicts — it succeeds, or fails in a
    /// way a same-user process can arrange on the directory — is the plugin's,
    /// and quarantines. Mutation this catches: trusting the exit code alone.
    #[cfg(unix)]
    #[test]
    fn an_exit_3_the_supervisors_probe_contradicts_is_a_process_failure() {
        let path = Path::new("/plugins/Hostile.clap");
        let status = exit_status_for_code(RESPONSE_WRITE_REFUSAL_EXIT_CODE);

        for (probe, errno) in [
            ("writable", None),
            ("permission denied", Some(libc::EACCES)),
            ("operation not permitted", Some(libc::EPERM)),
            ("probe already present", Some(libc::EEXIST)),
        ] {
            for room in [SHORT_VOLUME, ROOMY_VOLUME] {
                let message = process_failure(path, &status, before_spawn(room), || {
                    errno.map_or(Ok(()), |errno| {
                        Err(std::io::Error::from_raw_os_error(errno))
                    })
                });

                assert_eq!(
                    message,
                    exited_unsuccessfully("/plugins/Hostile.clap"),
                    "{probe} on {room:?}"
                );
                assert!(message.is_process_failure(), "{probe}: {message}");
            }
        }
    }

    /// The other half: every other non-zero exit — a crash, `Malformed`, no
    /// backend — must keep classifying as a process failure exactly as
    /// before this exit code existed, whatever the probe would have said.
    #[cfg(unix)]
    #[test]
    fn any_other_nonzero_exit_still_reads_as_a_process_failure() {
        let path = Path::new("/plugins/Hostile.clap");
        let status = exit_status_for_code(2);

        let message = process_failure(
            path,
            &status,
            before_spawn(SHORT_VOLUME),
            storage_full_probe,
        );

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
        let response_path = directory.path.join("metadata.json");

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

        let message = process_failure(
            path,
            &status,
            before_spawn(SHORT_VOLUME),
            storage_full_probe,
        );

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
