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

/// The application-data subdirectory no file command may resolve into.
///
/// The app data directory itself is a built-in root, so anything Sourdaw keeps
/// there is writable by the renderer through `write_file_bytes`. State that
/// decides what the renderer may reach cannot live under that rule — a forged
/// grant document would survive the relaunch and be read back as authority —
/// so it lives here instead, behind a refusal that outranks every root and
/// every grant.
const PRIVATE_DIR_NAME: &str = "private";
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
    // The checked path is the one returned, never the caller's spelling of it.
    // Windows normalises a path on the way to the filesystem — a trailing
    // period or space on a segment is trimmed — so returning the untouched
    // input lets the write land somewhere the guard never saw. The resolved
    // form has already been through canonicalisation, which is where that
    // normalisation happens.
    Ok(destination)
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
/// The private-state refusal runs first, and it is not an optimisation: the
/// grant document lives there, and a renderer that could write it would be
/// handing itself a recursive read-write grant on `/` for the next launch. The
/// check therefore has to outrank both the built-in roots — the private
/// directory sits inside the app data root — and the registry, so that a user
/// grant on an ancestor cannot reach it either.
///
/// After that, order matters only for cost: the built-in roots are the app's
/// own storage and admit both modes, so they answer before the registry.
/// `starts_with` is component-wise throughout, so no root or grant admits a
/// sibling directory whose name merely shares its prefix.
fn ensure_allowed_root(resolved_path: &Path, mode: GrantMode) -> Result<(), String> {
    if is_private_state_path(resolved_path) {
        // Refused with the same message as anything else outside the roots.
        // A distinct one would tell a probing renderer that it had found the
        // directory holding the state that decides what it may reach.
        return Err("Path is outside allowed native file roots".to_string());
    }

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

    if let Some(data_dir) = application_data_directory() {
        roots.push(data_dir);
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        roots.push(cache_dir.join(APP_DIR_NAME));
    }
    if let Some(project_dir) = project_directory() {
        roots.push(project_dir);
    }

    roots
}

/// Whether `resolved_path` is inside the directory only native code may touch.
///
/// Matched as "the component after the application data directory, whatever
/// its spelling" rather than as a resolved prefix, because a byte comparison
/// against the resolved private path is escapable. `canonicalize_through_missing_tail`
/// re-appends a component that does not exist yet using the caller's own
/// spelling, so before the first launch creates the directory, `PRIVATE`
/// resolves to `PRIVATE` and misses a prefix test that says `private` — while a
/// case-insensitive volume, which is the default on macOS and on Windows, reads
/// the file straight back out of `private` at the next launch. Which names the
/// filesystem may deliver there is [`names_private_directory`]'s question.
///
/// A missing private directory still refuses: the path a renderer would write
/// the grant document to does not exist yet either, and a check that only
/// applied once the directory was there would leave exactly one launch during
/// which the document could be planted.
fn is_private_state_path(resolved_path: &Path) -> bool {
    let Some(application_data) = application_data_directory() else {
        return false;
    };
    let Ok(resolved_root) = canonicalize_through_missing_tail(&application_data) else {
        return false;
    };
    let Ok(below_root) = resolved_path.strip_prefix(&resolved_root) else {
        return false;
    };
    below_root
        .components()
        .next()
        .is_some_and(|component| names_private_directory(&component.as_os_str().to_string_lossy()))
}

/// Whether `component` is a name the filesystem may deliver to the private
/// directory.
///
/// Windows trims trailing periods and spaces from every segment on the way to
/// the filesystem, so `private.` and `private ` both open `private`. Its
/// volumes then fold case, as macOS volumes do by default — and NTFS folds by
/// Unicode upcasing, not by ASCII, so the dotless `ı` in `prıvate` upcases to
/// `I` and opens the same directory. The comparison folds the same way, and it
/// folds on every platform: over-refusing a handful of names nothing else uses
/// costs a case-sensitive volume nothing, and the alternative is a refusal
/// that behaves differently on the host that needs it most.
///
/// Folding here rather than leaning on the directory already existing is what
/// makes this testable: the eager creation at addon construction is defence in
/// depth, and no `cargo test` compiles it.
fn names_private_directory(component: &str) -> bool {
    component.trim_end_matches(['.', ' ']).to_uppercase() == PRIVATE_DIR_NAME.to_uppercase()
}

/// Create the private directory before anything can resolve a path into it.
///
/// Once it exists, canonicalisation corrects the spelling of the component a
/// caller supplied, so every later resolution lands on the one path the
/// refusal was written against instead of on a variant of it. Called at addon
/// construction rather than lazily from the registry: `ensure_allowed_root`
/// answers an application-data path from the built-in roots without ever
/// consulting the registry, so a lazy creation would still be pending during
/// the first renderer command a fresh profile guards.
///
/// Ensures the private state directory exists for both production and test
/// addon initializations. [`create_private_state_directory`] is where the
/// work is, and that is what tests drive directly.
pub(crate) fn ensure_private_state_directory() {
    let Some(directory) = private_state_directory() else {
        return;
    };
    if let Err(error) = create_private_state_directory(&directory) {
        eprintln!("[Filesystem] Failed to create the private native state directory: {error}");
    }
}

fn create_private_state_directory(directory: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(directory)
}

fn application_data_directory() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(APP_DIR_NAME))
}

/// The application-data subdirectory that holds native-only state.
///
/// Everything under it is unreachable from any file command, whatever the
/// renderer names and whatever the user has granted, so state that decides
/// what the renderer may reach can be stored without the renderer being able
/// to author it.
pub(crate) fn private_state_directory() -> Option<PathBuf> {
    Some(application_data_directory()?.join(PRIVATE_DIR_NAME))
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
        let nested = granted.join("nested-save.txt");

        let (granted_result, sibling_error, nested_error) = grant_registry::with_grants_for_test(
            vec![grant_of(granted.clone(), GrantMode::ReadWrite, false)],
            || {
                (
                    writable(&granted),
                    writable(&sibling).unwrap_err(),
                    writable(&nested).unwrap_err(),
                )
            },
        );

        assert_eq!(granted_result.unwrap(), granted);
        assert_eq!(sibling_error, "Path is outside allowed native file roots");
        assert_eq!(
            nested_error, "Path is outside allowed native file roots",
            "a grant on one file names that file, not a subtree beneath its name"
        );
    }

    fn private_state_path(name: &str) -> PathBuf {
        spelled_private_state_path(PRIVATE_DIR_NAME, name)
    }

    /// The grant document's own filename, taken from the location the registry
    /// writes rather than repeated here, so the two cannot drift apart.
    fn grant_document_name() -> String {
        grant_registry::grant_file_location()
            .and_then(|location| {
                location
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .expect("an account should have an application data directory")
    }

    /// A path under the private directory written the way a caller spelled it.
    ///
    /// Resolved exactly as a renderer's path would be, so a spelling the
    /// filesystem has nothing to correct against survives into the comparison.
    fn spelled_private_state_path(private_spelling: &str, name: &str) -> PathBuf {
        let application_data = dirs::data_dir()
            .expect("an account should have an application data directory")
            .join(APP_DIR_NAME);
        canonicalize_through_missing_tail(&application_data.join(private_spelling).join(name))
            .expect("the application data directory should resolve")
    }

    /// The grant document decides what every later launch may reach, so no file
    /// command may resolve to it in either direction. It used to sit beside the
    /// app's other data, inside a built-in root, which put a forged document
    /// carrying a recursive read-write grant on `/` one `write_file_bytes`
    /// away.
    #[test]
    fn the_grant_document_is_refused_for_reading_and_for_writing() {
        let location = canonicalize_through_missing_tail(
            &grant_registry::grant_file_location()
                .expect("an account should have an application data directory"),
        )
        .expect("the application data directory should resolve");

        assert_eq!(
            ensure_allowed_root(&location, GrantMode::Read).unwrap_err(),
            "Path is outside allowed native file roots"
        );
        assert_eq!(
            ensure_allowed_root(&location, GrantMode::ReadWrite).unwrap_err(),
            "Path is outside allowed native file roots"
        );
    }

    /// End to end through the command a renderer would forge with. The
    /// destination is a probe name rather than the grant document itself, so a
    /// mutation run that removes the guard plants a file nobody reads instead
    /// of rewriting the real grants.
    #[tokio::test]
    async fn write_file_bytes_refuses_the_directory_holding_the_grant_document() {
        let destination = private_state_path("sourdaw-forged-grants-probe.json");

        let error = write_file_bytes(
            destination.to_string_lossy().into_owned(),
            br#"{"schema_version":1,"grants":[{"path":"/","mode":"read_write","recursive":true}]}"#,
        )
        .await
        .unwrap_err();

        assert_eq!(error, "Path is outside allowed native file roots");
    }

    /// Before the first launch creates the private directory there is nothing
    /// on disk for canonicalisation to correct a spelling against, so `PRIVATE`
    /// stayed `PRIVATE` and slipped past a refusal written as a byte prefix —
    /// then a case-insensitive volume, the default on macOS and on Windows,
    /// handed the planted document back as `private` at the next launch.
    #[tokio::test]
    async fn a_case_variant_spelling_does_not_reach_the_private_directory() {
        // The premise, stated rather than assumed: NTFS folds by Unicode
        // upcasing, and this is the spelling that fold collapses onto the real
        // directory name while an ASCII fold leaves it alone.
        assert_eq!("prıvate".to_uppercase(), "PRIVATE");

        for spelling in [
            "PRIVATE",
            "Private",
            "pRiVaTe",
            "private.",
            "private..",
            "private ",
            "PRIVATE. ",
            "prıvate",
            "PRıVATE",
            "prıvate. ",
        ] {
            let destination = spelled_private_state_path(spelling, &grant_document_name());

            assert_eq!(
                ensure_allowed_root(&destination, GrantMode::Read).unwrap_err(),
                "Path is outside allowed native file roots",
                "{spelling} must be refused for reading"
            );
            assert_eq!(
                write_file_bytes(
                    destination.to_string_lossy().into_owned(),
                    br#"{"schema_version":1,"grants":[{"path":"/","mode":"read_write","recursive":true}]}"#,
                )
                .await
                .unwrap_err(),
                "Path is outside allowed native file roots",
                "{spelling} must be refused for writing"
            );
        }

        // The control: a refusal that swallowed every neighbouring name would
        // pass every assertion above and quietly take the app's own storage
        // away from it. Checked without writing, because this half is admitted.
        for admitted in ["privates", "private-old"] {
            let destination = spelled_private_state_path(admitted, "state.json");

            assert!(
                ensure_allowed_root(&destination, GrantMode::ReadWrite).is_ok(),
                "{admitted} is an ordinary directory in the app's own data root"
            );
        }
    }

    /// The guard checks the canonical form of a destination but used to hand
    /// back the caller's own spelling of it. Windows trims a trailing period
    /// or space from every segment on the way to the filesystem, so the two
    /// were not the same path and the write landed somewhere unchecked.
    #[tokio::test]
    async fn a_writable_resolution_answers_with_the_path_it_checked() {
        let dir = TempExportDir::create("checked-path");
        let destination = dir.path("new-folder").join("render.wav");

        let resolved = resolve_writable_file_path(&destination.to_string_lossy()).unwrap();

        let canonical_temp = std::env::temp_dir()
            .canonicalize()
            .expect("the temp directory should resolve");
        assert!(
            resolved.starts_with(&canonical_temp),
            "{resolved:?} must be the canonical form, below {canonical_temp:?}"
        );
        assert_eq!(
            resolved,
            canonicalize_through_missing_tail(&destination).unwrap()
        );

        write_file_bytes(destination.to_string_lossy().into_owned(), b"render")
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(&resolved).unwrap(),
            b"render",
            "the command must still create the file the caller named"
        );
    }

    /// The eager creation is what stops a caller's spelling from surviving
    /// canonicalisation, so it is worth more than a call nothing compiles.
    #[test]
    fn creating_the_private_directory_succeeds_and_is_repeatable() {
        let dir = TempExportDir::create("private-create");
        let directory = dir.path("app-data").join(PRIVATE_DIR_NAME);

        create_private_state_directory(&directory).expect("the directory should be created");
        assert!(directory.is_dir());

        create_private_state_directory(&directory)
            .expect("creating an existing directory must not fail");
        assert!(directory.is_dir());
    }

    /// The private directory sits inside the application data root, and a user
    /// could be talked into picking that root in a dialog. Neither route may
    /// reach the state that decides what the other routes admit.
    #[test]
    fn a_recursive_grant_on_the_application_data_directory_still_refuses_the_private_directory() {
        let application_data = canonicalize_through_missing_tail(
            &dirs::data_dir()
                .expect("an account should have an application data directory")
                .join(APP_DIR_NAME),
        )
        .expect("the application data directory should resolve");
        let destination = private_state_path("sourdaw-forged-grants-probe.json");

        let error = grant_registry::with_grants_for_test(
            vec![grant_of(application_data, GrantMode::ReadWrite, true)],
            || ensure_allowed_root(&destination, GrantMode::ReadWrite).unwrap_err(),
        );

        assert_eq!(error, "Path is outside allowed native file roots");
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
