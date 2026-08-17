use daw_plugin_host::scanner::{
    extract_clap_metadata, extract_clap_parameter_metadata, ClapDescriptorMetadata,
    ClapParameterDescriptor,
};
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
pub const PARAMETER_WORKER_ARGUMENT: &str = "--sourdaw-plugin-parameter-scan-worker";
const WORKER_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESPONSE_BYTES: u64 = 256 * 1024;

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
    /// Re-execute this process. The contract the Tauri binary always used.
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
pub fn run_from_process_args() -> Option<i32> {
    run_from_args(std::env::args_os())
}
/// What a set of process arguments asks this process to be.
#[derive(Debug, PartialEq, Eq)]
enum WorkerRole<'args> {
    /// Extract one plugin's descriptor, or its parameters, into a response file.
    Extract {
        scans_parameters: bool,
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
/// followed by exactly two arguments and nothing after them, so an invocation
/// with a stray extra argument is refused rather than half-interpreted.
fn worker_role(args: &[OsString]) -> Option<WorkerRole<'_>> {
    let marker_index = args.iter().skip(1).position(|argument| {
        argument == std::ffi::OsStr::new(WORKER_ARGUMENT)
            || argument == std::ffi::OsStr::new(PARAMETER_WORKER_ARGUMENT)
    })? + 1;
    if args.len() != marker_index + 3 {
        return Some(WorkerRole::Malformed);
    }
    Some(WorkerRole::Extract {
        scans_parameters: args[marker_index] == std::ffi::OsStr::new(PARAMETER_WORKER_ARGUMENT),
        plugin_path: &args[marker_index + 1],
        response_path: &args[marker_index + 2],
    })
}

fn run_from_args(args: impl IntoIterator<Item = OsString>) -> Option<i32> {
    let args: Vec<OsString> = args.into_iter().collect();
    let (scans_parameters, plugin_path, response_path) = match worker_role(&args)? {
        WorkerRole::Malformed => return Some(2),
        WorkerRole::Extract {
            scans_parameters,
            plugin_path,
            response_path,
        } => (scans_parameters, plugin_path, response_path),
    };
    let result = if scans_parameters {
        write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: extract_clap_parameter_metadata(Path::new(plugin_path)),
            },
        )
    } else {
        write_response(
            Path::new(response_path),
            &WorkerResponse {
                worker_pid: std::process::id(),
                result: extract_clap_metadata(Path::new(plugin_path)),
            },
        )
    };
    Some(if result.is_ok() { 0 } else { 2 })
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
pub fn scan_clap_metadata(
    path: &Path,
    timeout: Duration,
) -> Result<ClapDescriptorMetadata, String> {
    scan_clap_worker(path, timeout, WORKER_ARGUMENT)
}

pub fn scan_clap_parameter_metadata(
    path: &Path,
    timeout: Duration,
) -> Result<Vec<ClapParameterDescriptor>, String> {
    scan_clap_worker(path, timeout, PARAMETER_WORKER_ARGUMENT)
}

fn scan_clap_worker<T: DeserializeOwned>(
    path: &Path,
    timeout: Duration,
    worker_argument: &str,
) -> Result<T, String> {
    let launcher = ScanWorkerCommand::resolve()?;
    let response_directory = ResponseDirectory::create()?;
    let response_path = response_directory.0.join("metadata.json");
    let mut command = Command::new(&launcher.program);
    command
        .args(&launcher.args)
        .arg(worker_argument)
        .arg(path)
        .arg(&response_path)
        .envs(&launcher.env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let status = run_bounded(&mut command, timeout.min(WORKER_TIMEOUT))?;
    if !status.success() {
        return Err(format!(
            "Plugin scan helper exited unsuccessfully for {}",
            path.display()
        ));
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
                return Err("Plugin scan helper timed out".to_string());
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

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    /// The Tauri form: the application binary scanning its own argv.
    #[test]
    fn the_marker_is_found_directly_after_the_executable() {
        assert_eq!(
            worker_role(&args(&["/app", WORKER_ARGUMENT, "/p.clap", "/out.json"])),
            Some(WorkerRole::Extract {
                scans_parameters: false,
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
                PARAMETER_WORKER_ARGUMENT,
                "/p.clap",
                "/out.json",
            ])),
            Some(WorkerRole::Extract {
                scans_parameters: true,
                plugin_path: &OsString::from("/p.clap"),
                response_path: &OsString::from("/out.json"),
            })
        );
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
            worker_role(&args(&[WORKER_ARGUMENT, "/p.clap", "/out.json"])),
            None
        );
    }

    #[test]
    fn a_worker_invocation_with_the_wrong_argument_count_is_malformed() {
        assert_eq!(
            worker_role(&args(&["/app", WORKER_ARGUMENT, "/p.clap"])),
            Some(WorkerRole::Malformed)
        );
        assert_eq!(
            worker_role(&args(&[
                "/app",
                WORKER_ARGUMENT,
                "/p.clap",
                "/out.json",
                "extra"
            ])),
            Some(WorkerRole::Malformed)
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
    #[test]
    fn timeout_kills_the_helper_process_group() {
        let pid_path =
            std::env::temp_dir().join(format!("sourdaw-scan-child-{}", std::process::id()));
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!("sleep 30 & echo $! > {}; wait", pid_path.display()),
        ]);
        assert!(run_bounded(&mut command, Duration::from_millis(50)).is_err());
        let pid = fs::read_to_string(&pid_path).unwrap();
        let _ = fs::remove_file(pid_path);
        assert!(!Command::new("kill")
            .args(["-0", pid.trim()])
            .status()
            .unwrap()
            .success());
    }
}
