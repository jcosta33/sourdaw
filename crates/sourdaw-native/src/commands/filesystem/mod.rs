//! The native file commands, and the grants that bound them.
//!
//! Every path the renderer names is resolved here and checked against a root
//! before any I/O happens. Two kinds of root exist and they are not
//! interchangeable: the built-in ones the application owns outright
//! ([`built_in_roots`]), and the individual paths a user picked in a native
//! dialog, held in [`grant_registry`]. Nothing else is reachable, whatever the
//! renderer sends.

pub mod grant_registry;

use grant_registry::{FileGrant, GrantMode};
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub(crate) const APP_DIR_NAME: &str = "com.sourdaw.app";
const IPC_TEMP_DIR_NAME: &str = "sourdaw_ipc";

/// The folder Sourdaw keeps its own projects in, under the user's documents.
///
/// A built-in root rather than a grant: it is the application's own storage,
/// the way the data and cache directories are, and a musician who saves a
/// project into the app's own project folder has not picked anything for the
/// app to remember.
const PROJECT_DIR_NAME: &str = "Sourdaw Projects";
const MAX_FILE_IPC_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RENDERER_PATH_BYTES: usize = 4096;

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioFileInfo {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub duration_ms: Option<u64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: u64,
}

pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    let file_path = resolve_existing_file_path(&path)?;
    std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

pub async fn write_audio_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let file_path = resolve_writable_file_path(&path)?;
    ensure_parent_directory(&file_path)?;
    write_bytes_atomically(&file_path, &data)
}

/// Write raw bytes to a file.
///
/// The payload arrives as bytes rather than as a JSON number array, so a
/// multi-megabyte export crosses at exactly its byte length. The destination
/// path is a separate argument for the same reason: the byte channel carries the
/// payload and nothing else.
///
/// Path resolution and directory creation match `write_audio_file` exactly, so
/// the same bytes land at the same location.
pub async fn write_file_bytes(path: String, data: &[u8]) -> Result<(), String> {
    ensure_file_ipc_size(data.len() as u64, "write_file_bytes")?;

    let file_path = resolve_writable_file_path(&path)?;
    ensure_parent_directory(&file_path)?;
    write_bytes_atomically(&file_path, data)
}

fn ensure_parent_directory(file_path: &Path) -> Result<(), String> {
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    Ok(())
}

fn write_bytes_atomically(file_path: &Path, data: &[u8]) -> Result<(), String> {
    replace_file_atomically(file_path, |file| {
        file.write_all(data)
            .map_err(|e| format!("Failed to write file: {}", e))
    })
}

/// Replace the file at `path` with whatever `write` produces, atomically.
///
/// Writing straight to `path` truncates it before the replacement bytes are
/// durable, so an I/O failure or process death mid-write leaves a previously
/// complete project, mixdown, or stem empty or partial. Every exported-file
/// write this crate routes — the byte and audio commands above, the
/// post-processed WAV render, and the pitch-edit commit — goes through this
/// helper so the guarantee holds the same way on each. The `.sdaw`
/// collaboration bundle save lives in another crate (`daw-collab`) and is
/// tracked as its own issue, not here:
///
/// * `write` fills a newly created sibling of `path` — same directory, hence
///   the same filesystem and the same allowed root. `create_new` plus a UUID
///   name guarantees the temp file is this writer's alone; a shared name would
///   let a concurrent writer truncate this one's half-written file and publish
///   the interleaving of both.
/// * The temp file is fsynced and closed, and only then renamed onto `path`:
///   the bytes moved over the destination are already durable, and a rename
///   within one filesystem never exposes a partially written file. std's
///   rename replaces an existing destination on every platform this addon
///   ships to (POSIX `rename(2)`; Windows `MOVEFILE_REPLACE_EXISTING`
///   semantics), so no remove-then-rename window is ever opened. Closing
///   before the rename matters on Windows, where renaming from a handle the
///   writer still holds can fail with a sharing violation.
/// * On Unix the parent directory is synced after the rename, best effort, so
///   the rename itself — not just the file's data — survives a crash.
/// * Any failure removes the temp file and leaves `path` exactly as it was.
pub(crate) fn replace_file_atomically(
    path: &Path,
    write: impl FnOnce(&mut std::fs::File) -> Result<(), String>,
) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Atomic write error: path has no file name".to_string())?;
    let temp_path = path.with_file_name(format!("{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    // The temp file is closed (by the end of this closure) before the rename
    // below runs; the scoping exists to guarantee that order on Windows.
    let write_result = (|| {
        let mut temp_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| format!("Failed to create temporary file: {}", e))?;
        write(&mut temp_file)?;
        temp_file
            .sync_all()
            .map_err(|e| format!("Failed to sync temporary file: {}", e))
    })();

    match write_result {
        Ok(()) => {
            std::fs::rename(&temp_path, path).map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                format!("Failed to move finished file into place: {}", e)
            })?;
            sync_parent_directory_best_effort(path);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

/// Sync the directory holding `path` after a successful replace, Unix only.
///
/// The file's bytes are already durable when this runs; syncing the directory
/// makes the rename — the replacement of the old inode's name — durable too.
/// Windows cannot open a directory through std for syncing and NTFS journals
/// the rename, so there is nothing to do there. Best effort, because at this
/// point the replacement is already complete and visible: a failure here only
/// weakens crash-durability back to the level of every unsynced rename, never
/// the file's contents.
#[cfg(unix)]
fn sync_parent_directory_best_effort(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
}

#[cfg(not(unix))]
fn sync_parent_directory_best_effort(_path: &Path) {}

/// Write a WAV so that `path` is replaced only by a complete, finalized file.
///
/// `WavWriter::create` truncates its target immediately, so writing straight
/// to `path` would destroy any pre-existing render there and — on a mid-write
/// or finalize failure such as disk full — leave a truncated, headerless WAV
/// that a later existence check mistakes for the render. This wrapper supplies
/// only the WAV-specific part of the replace: the hound writer over the temp
/// file `replace_file_atomically` hands it. `finalize` flushes the buffered
/// writer, so every sample and the corrected header are inside the fsync the
/// helper performs.
pub(crate) fn write_wav_atomically(
    path: &Path,
    spec: WavSpec,
    write_samples: impl FnOnce(
        &mut WavWriter<std::io::BufWriter<&mut std::fs::File>>,
    ) -> Result<(), String>,
) -> Result<(), String> {
    replace_file_atomically(path, |file| {
        let mut writer = WavWriter::new(std::io::BufWriter::new(file), spec)
            .map_err(|e| format!("WAV write error: {e}"))?;
        write_samples(&mut writer)?;
        writer
            .finalize()
            .map_err(|e| format!("Finalize error: {e}"))
    })
}

/// Read a file's bytes, returned verbatim rather than as a JSON number array.
///
/// Path resolution matches `read_audio_file` exactly; only the transport of the
/// result differs, and the shell decides that.
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let file_path = resolve_existing_file_path(&path)?;
    let file_size = std::fs::metadata(&file_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?
        .len();
    ensure_file_ipc_size(file_size, "read_file_bytes")?;
    std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

pub async fn list_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let dir_path = resolve_existing_directory_path(&path)?;

    let mut entries = Vec::new();
    let read_dir =
        std::fs::read_dir(&dir_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            size_bytes: metadata.len(),
        });
    }

    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.cmp(&b.name))
    });

    Ok(entries)
}

/// Grant the renderer access to one path the user picked.
///
/// The one production route into [`grant_registry`], and it is reachable only
/// from the desktop shell's main process: the command is withheld from the
/// renderer's command surface, so a page cannot widen its own reach by asking.
/// The shell calls it with the path a native dialog is about to return —
/// recursively writable for a directory pick, the single file for a save, that
/// file read-only for an open.
pub async fn grant_path(path: String, mode: String, recursive: bool) -> Result<(), String> {
    let mode = parse_grant_mode(&mode)?;
    let requested = normalize_absolute_path(Path::new(path.trim()))?;
    let canonical = grant_registry::resolve_grant_target(&requested)?;
    grant_registry::grant(FileGrant {
        canonical,
        mode,
        recursive,
    });
    Ok(())
}

fn parse_grant_mode(mode: &str) -> Result<GrantMode, String> {
    match mode {
        "read" => Ok(GrantMode::Read),
        "readwrite" => Ok(GrantMode::ReadWrite),
        other => Err(format!("Unknown file grant mode: {other}")),
    }
}

pub fn resolve_existing_file_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical, GrantMode::Read)?;
    if !canonical.is_file() {
        return Err("Path is not a file".to_string());
    }
    Ok(canonical)
}

pub fn resolve_existing_directory_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical, GrantMode::Read)?;
    if !canonical.is_dir() {
        return Err("Not a directory".to_string());
    }
    Ok(canonical)
}

pub fn resolve_writable_file_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    if let Ok(canonical) = canonicalize_existing_path(&resolved) {
        ensure_allowed_root(&canonical, GrantMode::ReadWrite)?;
        if canonical.is_dir() {
            return Err("Path is a directory".to_string());
        }
        return Ok(canonical);
    }

    // The destination does not exist yet, so the check runs against the whole
    // path with its existing part resolved — not against the nearest existing
    // ancestor alone. A grant, and the projects root, name a directory that may
    // itself be the missing part, and an ancestor-only check answers about the
    // directory *above* the root rather than about the destination.
    if resolved.parent().is_none() {
        return Err("Path must include a parent directory".to_string());
    }
    let destination = canonicalize_through_missing_tail(&resolved)?;
    ensure_allowed_root(&destination, GrantMode::ReadWrite)?;
    Ok(resolved)
}

pub fn require_extension(path: PathBuf, extension: &str, label: &str) -> Result<PathBuf, String> {
    let actual = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !actual.eq_ignore_ascii_case(extension) {
        return Err(format!("{label} path must use .{extension} extension"));
    }
    Ok(path)
}

fn resolve_renderer_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Renderer path must not be empty".to_string());
    }
    if trimmed.len() > MAX_RENDERER_PATH_BYTES {
        return Err(format!(
            "Native file path exceeds {MAX_RENDERER_PATH_BYTES}-byte IPC limit"
        ));
    }

    let input = Path::new(trimmed);
    if input.is_absolute() {
        return normalize_absolute_path(input);
    }

    reject_relative_parent_segments(input)?;
    Ok(ipc_temp_dir().join(input))
}

fn ensure_file_ipc_size(size: u64, command: &str) -> Result<(), String> {
    if size > MAX_FILE_IPC_BYTES {
        return Err(format!(
            "{command} payload exceeds {MAX_FILE_IPC_BYTES}-byte IPC limit"
        ));
    }
    Ok(())
}

fn ipc_temp_dir() -> PathBuf {
    std::env::temp_dir().join(IPC_TEMP_DIR_NAME)
}

fn reject_relative_parent_segments(path: &Path) -> Result<(), String> {
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err("Renderer path must not contain parent-directory traversal".to_string());
        }
    }
    Ok(())
}

fn normalize_absolute_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Renderer path must not escape the filesystem root".to_string());
                }
            }
        }
    }
    Ok(normalized)
}

fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|_| "File not found or not accessible".to_string())
}

/// Resolve `path` as far as the filesystem allows, keeping what is missing.
///
/// `canonicalize` refuses a path that does not exist, and both a save target
/// and an application directory on first launch are exactly that. This walks up
/// to the deepest ancestor that does exist, canonicalises it, and re-appends
/// the components below it. Those components do not exist, so they cannot be
/// symlinks; every link in the part that does exist has already been followed,
/// which is what makes the result comparable against another resolved path.
pub(crate) fn canonicalize_through_missing_tail(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }

    let mut missing: Vec<OsString> = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        let name = current
            .file_name()
            .ok_or_else(|| "No existing parent directory for path".to_string())?
            .to_os_string();
        let parent = current
            .parent()
            .ok_or_else(|| "No existing parent directory for path".to_string())?
            .to_path_buf();
        missing.push(name);

        if let Ok(canonical_parent) = parent.canonicalize() {
            let mut resolved = canonical_parent;
            for segment in missing.iter().rev() {
                resolved.push(segment);
            }
            return Ok(resolved);
        }
        current = parent;
    }
}

/// Refuse a path that is neither inside a built-in root nor granted.
///
/// Order matters only for cost: the built-in roots are the app's own storage
/// and admit both modes, so they answer first and the registry is consulted
/// for everything else. `starts_with` is component-wise, so a root never
/// admits a sibling directory whose name merely shares its prefix.
fn ensure_allowed_root(resolved_path: &Path, mode: GrantMode) -> Result<(), String> {
    for root in built_in_roots() {
        if let Ok(resolved_root) = canonicalize_through_missing_tail(&root) {
            if resolved_path.starts_with(resolved_root) {
                return Ok(());
            }
        }
    }
    if grant_registry::admits(resolved_path, mode) {
        return Ok(());
    }
    Err("Path is outside allowed native file roots".to_string())
}

/// The roots Sourdaw owns, readable and writable without a user pick.
///
/// Each one is storage the application itself created: the IPC scratch space
/// exports cross through, its data and cache directories, and the folder it
/// keeps projects in. The user's documents, downloads, desktop and music
/// folders were roots here once (#3313); they are the user's, not the app's,
/// and reach them now only through a grant the user made in a dialog.
fn built_in_roots() -> Vec<PathBuf> {
    let mut roots = vec![std::env::temp_dir()];

    if let Some(data_dir) = dirs::data_dir() {
        roots.push(data_dir.join(APP_DIR_NAME));
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        roots.push(cache_dir.join(APP_DIR_NAME));
    }
    if let Some(project_dir) = project_directory() {
        roots.push(project_dir);
    }

    roots
}

/// Where Sourdaw keeps its own projects.
fn project_directory() -> Option<PathBuf> {
    Some(dirs::document_dir()?.join(PROJECT_DIR_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_application_data_paths_share_one_directory_identity() {
        assert_eq!(APP_DIR_NAME, "com.sourdaw.app");

        let roots = built_in_roots();
        if let Some(data_dir) = dirs::data_dir() {
            assert!(roots.contains(&data_dir.join(APP_DIR_NAME)));
        }
        if let Some(cache_dir) = dirs::cache_dir() {
            assert!(roots.contains(&cache_dir.join(APP_DIR_NAME)));
        }

        for source in [
            include_str!("../verified_cached_model.rs"),
            include_str!("../../host/plugin_registry_store.rs"),
        ] {
            assert!(
                source.contains(".join(APP_DIR_NAME)"),
                "every native application-data path must join the shared identity"
            );
            assert!(
                !source.contains(".join(\"com.sourdaw.app\")"),
                "native application-data consumers must not own the directory identity"
            );
        }
    }

    #[test]
    fn should_resolve_relative_renderer_paths_inside_ipc_temp_root() {
        let resolved = resolve_renderer_path("__sourdaw_stems_input_1.wav").unwrap();

        assert!(resolved.starts_with(ipc_temp_dir()));
        assert!(resolved.ends_with("__sourdaw_stems_input_1.wav"));
    }

    #[test]
    fn should_reject_parent_segments_in_relative_renderer_paths() {
        let result = resolve_renderer_path("../outside.wav");

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Renderer path must not contain parent-directory traversal"
        );
    }

    #[test]
    fn webview_boundary_rejects_renderer_paths_over_ipc_limit() {
        let path = format!("/{}", "x".repeat(4096));

        let result = resolve_renderer_path(&path);

        assert_eq!(
            result.unwrap_err(),
            "Native file path exceeds 4096-byte IPC limit"
        );
    }

    #[test]
    fn webview_boundary_rejects_file_payloads_over_ipc_limit() {
        let result = ensure_file_ipc_size(1_073_741_825, "read_file_bytes");

        assert_eq!(
            result.unwrap_err(),
            "read_file_bytes payload exceeds 1073741824-byte IPC limit"
        );
    }

    #[cfg(unix)]
    #[test]
    fn should_reject_absolute_paths_outside_allowed_roots() {
        let result = resolve_existing_file_path("/etc/passwd");

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Path is outside allowed native file roots"
        );
    }

    /// A directory the user owns and Sourdaw does not: the documents folder,
    /// which was a blanket root before #3313 and is now reachable only through
    /// a grant. Resolved the same way the guard resolves a destination, so a
    /// grant written here and the path the resolver computes are comparable.
    fn user_documents_directory() -> PathBuf {
        let home = dirs::home_dir().expect("an account should have a home directory");
        canonicalize_through_missing_tail(&home.join("Documents"))
            .expect("the home directory should resolve")
    }

    fn grant_of(canonical: PathBuf, mode: GrantMode, recursive: bool) -> FileGrant {
        FileGrant {
            canonical,
            mode,
            recursive,
        }
    }

    fn writable(path: &Path) -> Result<PathBuf, String> {
        resolve_writable_file_path(&path.to_string_lossy())
    }

    /// The reproduction on #3313: a renderer that named a path in the user's
    /// documents folder could write there, because the folder itself was an
    /// allowed root. With no grant it must be refused.
    #[test]
    fn an_ungranted_user_document_is_not_writable() {
        let destination = user_documents_directory().join("sourdaw-grant-probe.txt");

        let error = grant_registry::with_grants_for_test(Vec::new(), || {
            writable(&destination).unwrap_err()
        });

        assert_eq!(error, "Path is outside allowed native file roots");
    }

    #[test]
    fn a_writable_directory_grant_admits_a_file_below_it() {
        let documents = user_documents_directory();
        let destination = documents.join("sourdaw-grant-probe.txt");

        let resolved = grant_registry::with_grants_for_test(
            vec![grant_of(documents, GrantMode::ReadWrite, true)],
            || writable(&destination),
        );

        assert_eq!(resolved.unwrap(), destination);
    }

    #[test]
    fn a_read_grant_refuses_a_writable_resolution() {
        let documents = user_documents_directory();
        let destination = documents.join("sourdaw-grant-probe.txt");

        let error = grant_registry::with_grants_for_test(
            vec![grant_of(documents, GrantMode::Read, true)],
            || writable(&destination).unwrap_err(),
        );

        assert_eq!(error, "Path is outside allowed native file roots");
    }

    #[test]
    fn a_single_file_grant_refuses_a_sibling() {
        let documents = user_documents_directory();
        let granted = documents.join("sourdaw-granted-save.txt");
        let sibling = documents.join("sourdaw-other-save.txt");

        let (granted_result, sibling_error) = grant_registry::with_grants_for_test(
            vec![grant_of(granted.clone(), GrantMode::ReadWrite, false)],
            || (writable(&granted), writable(&sibling).unwrap_err()),
        );

        assert_eq!(granted_result.unwrap(), granted);
        assert_eq!(sibling_error, "Path is outside allowed native file roots");
    }

    #[test]
    fn a_grant_resolves_the_path_it_was_asked_for_and_refuses_a_relative_one() {
        let documents = user_documents_directory();

        assert_eq!(
            grant_registry::resolve_grant_target(&documents.join("new-export.wav")).unwrap(),
            documents.join("new-export.wav"),
            "a save target that does not exist yet still resolves through its parent"
        );
        assert_eq!(
            grant_registry::resolve_grant_target(Path::new("relative/pick.wav")).unwrap_err(),
            "Granted path must be absolute"
        );
    }

    struct TempExportDir {
        root: PathBuf,
    }

    impl TempExportDir {
        fn create(test_name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "sourdaw-atomic-export-{test_name}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).expect("test export directory should be created");
            Self { root }
        }

        fn path(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }
    }

    impl Drop for TempExportDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn temp_file_residue(directory: &Path) -> Vec<PathBuf> {
        std::fs::read_dir(directory)
            .expect("test export directory should be listable")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "tmp"))
            .collect()
    }

    /// Regression (issue #2823): the export writers used to call
    /// `std::fs::write` on the destination directly, truncating a previously
    /// complete export before the replacement bytes were durable — a mid-write
    /// failure (disk full, I/O fault) destroyed the only copy. A failure
    /// injected mid-write, after real bytes have reached the temp file, must
    /// leave the destination byte-for-byte untouched and no temp file behind.
    #[test]
    fn a_mid_write_failure_leaves_a_pre_existing_file_untouched() {
        let dir = TempExportDir::create("failure-existing");
        let destination = dir.path("mixdown.wav");
        std::fs::write(&destination, b"previous complete render")
            .expect("pre-existing export should be written");

        let error = replace_file_atomically(&destination, |file| {
            // Real bytes reach the temp file before the injected failure,
            // mirroring an I/O fault partway through an export.
            file.write_all(b"partial bytes")
                .map_err(|e| format!("Write error: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"previous complete render",
            "a failed replace must leave the destination byte-for-byte intact"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be removed after a failed replace"
        );
    }

    /// The same failure against a not-yet-existing destination must create
    /// nothing there: a truncated file would satisfy a later existence check
    /// and masquerade as the export.
    #[test]
    fn a_mid_write_failure_creates_nothing_at_a_missing_destination() {
        let dir = TempExportDir::create("failure-missing");
        let destination = dir.path("project.sourdaw");

        let error = replace_file_atomically(&destination, |file| {
            file.write_all(b"partial")
                .map_err(|e| format!("Write error: {e}"))?;
            Err("injected write failure".to_string())
        })
        .unwrap_err();

        assert_eq!(error, "injected write failure");
        assert!(
            !destination.exists(),
            "a failed replace must not leave a file at the destination"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be removed after a failed replace"
        );
    }

    #[test]
    fn a_successful_replace_swaps_the_destination_completely_and_leaves_no_temp_file() {
        let dir = TempExportDir::create("success-existing");
        let destination = dir.path("mixdown.wav");
        std::fs::write(&destination, b"previous complete render")
            .expect("pre-existing export should be written");

        replace_file_atomically(&destination, |file| {
            file.write_all(b"new complete render")
                .map_err(|e| format!("Write error: {e}"))
        })
        .unwrap();

        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"new complete render",
            "a successful replace must land the new bytes in full"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be renamed away on success"
        );
    }

    /// Rename-based replacement is also how a destination that does not exist
    /// yet appears: it either exists complete or not at all, never truncated.
    #[test]
    fn a_successful_replace_can_create_a_missing_destination() {
        let dir = TempExportDir::create("success-missing");
        let destination = dir.path("project.sourdaw");

        replace_file_atomically(&destination, |file| {
            file.write_all(b"fresh export")
                .map_err(|e| format!("Write error: {e}"))
        })
        .unwrap();

        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"fresh export",
            "a created destination must hold the written bytes in full"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the temp file must be renamed away on success"
        );
    }

    /// End to end through the command the renderer calls for every byte
    /// export: an existing destination is replaced, and one whose directory
    /// does not exist yet is still created.
    #[tokio::test]
    async fn write_file_bytes_replaces_an_existing_export_and_creates_missing_directories() {
        let dir = TempExportDir::create("command");
        let existing = dir.path("stem.wav");
        std::fs::write(&existing, b"previous stem").expect("pre-existing stem should be written");

        write_file_bytes(existing.to_string_lossy().into_owned(), b"new stem")
            .await
            .unwrap();

        assert_eq!(
            std::fs::read(&existing).unwrap(),
            b"new stem",
            "the command must replace an existing export with the new bytes"
        );
        assert!(
            temp_file_residue(&dir.root).is_empty(),
            "the command must not leave temp files behind"
        );

        let nested = dir.root.join("new-folder").join("project.sourdaw");
        write_file_bytes(nested.to_string_lossy().into_owned(), b"fresh project")
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&nested).unwrap(),
            b"fresh project",
            "the command must create a missing destination directory and file"
        );
    }
}
