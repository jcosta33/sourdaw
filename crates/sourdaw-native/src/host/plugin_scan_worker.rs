use daw_plugin_host::scanner::{
    extract_clap_instance_metadata, extract_clap_metadata, ClapDescriptorMetadata, PluginFormat,
    ScannedDescriptor, ScannedInstance,
};
use daw_plugin_host::vst3_scanner::{extract_vst3_instance_metadata, extract_vst3_metadata};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
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
const MAX_RESPONSE_BYTES: u64 = 256 * 1024;

/// The refusal `scan_worker` returns when the helper child exited with a
/// non-zero status, minus the path it is formatted with. See
/// [`is_process_failure`].
const HELPER_EXITED_UNSUCCESSFULLY_PREFIX: &str = "Plugin scan helper exited unsuccessfully for ";
/// The refusal `wait_bounded` returns when the helper child ran past its
/// bound and was killed.
const HELPER_TIMED_OUT: &str = "Plugin scan helper timed out";

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
/// [`process_failure_message`], which is what keeps it out of
/// [`is_process_failure`].
///
/// The inverse residual is accepted, not closed: a plugin whose own static
/// initializer happens to call `exit(3)` reads as a self-diagnosed write
/// refusal and escapes quarantine. That plugin still costs no more than one
/// bounded spawn per scan — nothing near the deadline-exhausting repeat
/// spawns an unquarantined *hang* would cost — because a plugin that hangs
/// instead is still caught by `wait_bounded`'s timeout, which classifies
/// entirely on elapsed time and never looks at an exit code at all.
const RESPONSE_WRITE_REFUSAL_EXIT_CODE: i32 = 3;

/// Whether an error from [`scan_descriptor_metadata`] or
/// [`scan_instance_metadata`] is the process-level failure crash quarantine
/// exists to catch: the helper child exited unsuccessfully, or ran past its
/// bound and was killed.
///
/// Distinct from a data-level refusal — a malformed response, an oversized
/// payload, an unregistered format — which says the *read* failed, not that
/// the binary itself is dangerous to keep re-running. Only a process failure
/// is evidence worth quarantining a binary over (#2911).
pub fn is_process_failure(error: &str) -> bool {
    error.starts_with(HELPER_EXITED_UNSUCCESSFULLY_PREFIX) || error == HELPER_TIMED_OUT
}

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
impl ResponseDirectory {
    fn create() -> Result<Self, String> {
        let path =
            std::env::temp_dir().join(format!("sourdaw-plugin-scan-{}", uuid::Uuid::new_v4()));
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
fn write_response<T: Serialize>(path: &Path, response: &WorkerResponse<T>) -> Result<(), String> {
    let bytes = serde_json::to_vec(response)
        .map_err(|error| format!("Cannot serialize plugin scan response: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Plugin scan response exceeded its byte limit".to_string());
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
) -> Result<Vec<ScannedDescriptor>, String> {
    scan_worker(format, path, None, timeout, WORKER_ARGUMENT)
}

/// Inspect one live instance of the plugin `plugin_id` names in the file,
/// through that format's registered backend, in a bounded child process.
pub fn scan_instance_metadata(
    format: PluginFormat,
    path: &Path,
    plugin_id: &str,
    timeout: Duration,
) -> Result<ScannedInstance, String> {
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
/// [`RESPONSE_WRITE_REFUSAL_EXIT_CODE`] gets a message that does not match
/// [`HELPER_EXITED_UNSUCCESSFULLY_PREFIX`] — deliberately, so
/// [`is_process_failure`] never classifies it as evidence worth quarantining
/// a binary over. Every other non-zero exit — a crash, `WorkerRole::Malformed`,
/// no backend for the format — keeps the existing message, which
/// `is_process_failure` does recognize.
fn process_failure_message(path: &Path, status: &ExitStatus) -> String {
    if status.code() == Some(RESPONSE_WRITE_REFUSAL_EXIT_CODE) {
        return format!(
            "Plugin scan helper could not write its response for {}",
            path.display()
        );
    }
    format!("{HELPER_EXITED_UNSUCCESSFULLY_PREFIX}{}", path.display())
}

fn scan_worker<T: DeserializeOwned>(
    format: PluginFormat,
    path: &Path,
    plugin_id: Option<&str>,
    timeout: Duration,
    worker_argument: &str,
) -> Result<T, String> {
    // Refused here as well as in the child: launching a process to be told the
    // format is unhostable spends a spawn and a deadline to reach the same
    // answer, and the child's refusal is an exit code with no reason in it.
    if scan_backend(format).is_none() {
        return Err(no_scan_backend(format));
    }
    let launcher = ScanWorkerCommand::resolve()?;
    let response_directory = ResponseDirectory::create()?;
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
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let status = run_bounded(&mut command, timeout.min(WORKER_TIMEOUT))?;
    if !status.success() {
        return Err(process_failure_message(path, &status));
    }
    let mut bytes = Vec::new();
    OpenOptions::new()
        .read(true)
        .open(&response_path)
        .map_err(|error| format!("Plugin scan helper returned no metadata: {error}"))?
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read plugin scan helper response: {error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("Plugin scan helper response exceeded its byte limit".to_string());
    }
    let response: WorkerResponse<T> = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Plugin scan helper returned invalid metadata: {error}"))?;
    if response.worker_pid == std::process::id() {
        return Err("Plugin metadata extraction did not cross a process boundary".to_string());
    }
    response.result
}
fn run_bounded(command: &mut Command, timeout: Duration) -> Result<ExitStatus, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start plugin scan helper: {error}"))?;
    wait_bounded(&mut child, timeout)
}
fn wait_bounded(child: &mut Child, timeout: Duration) -> Result<ExitStatus, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                terminate_process_tree(child);
                return Err(HELPER_TIMED_OUT.to_string());
            }
            Err(error) => {
                terminate_process_tree(child);
                return Err(format!("Cannot observe plugin scan helper: {error}"));
            }
        }
    }
}
#[cfg(unix)]
fn terminate_process_tree(child: &mut Child) {
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe {
        let _ = kill(-(child.id() as i32), 9);
    }
    let _ = child.kill();
    let _ = child.wait();
}
#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.kill();
    let _ = child.wait();
}
#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}
#[cfg(test)]
mod tests {
    use super::*;
    use daw_plugin_host::scanner::FormatScanSupport;

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

        assert_eq!(refusal, "No plugin scan backend for format vst2");
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

    fn build_hostile_clap(test_name: &str) -> (PathBuf, PathBuf) {
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
unsafe extern "C" fn init(_: *const c_char)->bool{
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
        (root, plugin_path)
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
    #[test]
    fn crashed_helper_does_not_take_down_the_supervisor() {
        let (fixture_root, plugin_path) = build_hostile_clap("crash");
        let mut command = hostile_command(&plugin_path);
        let status = run_bounded(&mut command, Duration::from_secs(1))
            .expect("the crashed child should still be observable");
        let _ = fs::remove_dir_all(fixture_root);
        assert!(!status.success());
    }
    #[test]
    fn hung_helper_is_killed_at_the_deadline() {
        let (fixture_root, plugin_path) = build_hostile_clap("hang");
        let mut command = hostile_command(&plugin_path);
        command.env("SOURDAW_TEST_PLUGIN_HANG", "1");
        let error = run_bounded(&mut command, Duration::from_millis(500))
            .expect_err("the hung child should exceed the deadline");
        let _ = fs::remove_dir_all(fixture_root);
        assert_eq!(error, "Plugin scan helper timed out");
    }
    #[cfg(unix)]
    /// A killed process stays visible to `kill(pid, 0)` until its parent
    /// reaps it, so "the group was killed" is only provable over a reap
    /// window: keep polling until the signal probe reports ESRCH.
    fn process_is_gone_within(pid: i32, window: Duration) -> bool {
        let deadline = Instant::now() + window;
        loop {
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

    /// The only two shapes crash quarantine exists to catch.
    #[test]
    fn is_process_failure_recognizes_exit_and_timeout_errors() {
        assert!(is_process_failure(
            "Plugin scan helper exited unsuccessfully for /plugins/Broken.clap"
        ));
        assert!(is_process_failure("Plugin scan helper timed out"));
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

        let message = process_failure_message(path, &status);

        assert!(
            !is_process_failure(&message),
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

        let message = process_failure_message(path, &status);

        assert!(
            is_process_failure(&message),
            "a crash's exit code must still quarantine the binary: {message}"
        );
    }

    /// A data-level refusal says the read failed, not that the process itself
    /// crashed or hung — never a reason to quarantine the binary.
    #[test]
    fn is_process_failure_rejects_data_level_refusals() {
        assert!(!is_process_failure(
            "No plugin scan backend for format vst2"
        ));
        assert!(!is_process_failure(
            "Plugin scan helper response exceeded its byte limit"
        ));
        assert!(!is_process_failure(
            "Plugin scan helper returned invalid metadata: EOF"
        ));
        assert!(!is_process_failure(
            "Cannot start plugin scan helper: denied"
        ));
    }
}
