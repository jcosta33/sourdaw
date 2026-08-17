use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const APP_DIR_NAME: &str = "com.sourdaw.app";
const IPC_TEMP_DIR_NAME: &str = "sourdaw_ipc";
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
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&file_path, &data).map_err(|e| format!("Failed to write file: {}", e))
}

/// Name the shell addresses the destination path of `write_file_bytes` by.
///
/// The Tauri shell sends it as a percent-encoded header because the invoke body
/// is fully occupied by the payload; the Node addon passes the path directly.
/// The name is shared so both report the same thing when it is missing.
pub const FILE_PATH_HEADER: &str = "x-sourdaw-path";

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
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&file_path, data).map_err(|e| format!("Failed to write file: {}", e))
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

pub fn resolve_existing_file_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical)?;
    if !canonical.is_file() {
        return Err("Path is not a file".to_string());
    }
    Ok(canonical)
}

pub fn resolve_existing_directory_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical)?;
    if !canonical.is_dir() {
        return Err("Not a directory".to_string());
    }
    Ok(canonical)
}

pub fn resolve_writable_file_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    if let Ok(canonical) = canonicalize_existing_path(&resolved) {
        ensure_allowed_root(&canonical)?;
        if canonical.is_dir() {
            return Err("Path is a directory".to_string());
        }
        return Ok(canonical);
    }

    let parent = resolved
        .parent()
        .ok_or_else(|| "Path must include a parent directory".to_string())?;
    let canonical_parent = canonicalize_existing_parent(parent)?;
    ensure_allowed_root(&canonical_parent)?;
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

fn canonicalize_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let mut current = path;
    loop {
        if let Ok(canonical) = current.canonicalize() {
            return Ok(canonical);
        }
        current = current
            .parent()
            .ok_or_else(|| "No existing parent directory for path".to_string())?;
    }
}

fn ensure_allowed_root(canonical_path: &Path) -> Result<(), String> {
    for root in allowed_roots() {
        if let Ok(canonical_root) = root.canonicalize() {
            if canonical_path.starts_with(canonical_root) {
                return Ok(());
            }
        }
    }
    Err("Path is outside allowed native file roots".to_string())
}

fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = vec![std::env::temp_dir()];

    if let Some(data_dir) = dirs::data_dir() {
        roots.push(data_dir.join(APP_DIR_NAME));
    }
    if let Some(cache_dir) = dirs::cache_dir() {
        roots.push(cache_dir.join(APP_DIR_NAME));
    }
    if let Some(document_dir) = dirs::document_dir() {
        roots.push(document_dir);
    }
    if let Some(download_dir) = dirs::download_dir() {
        roots.push(download_dir);
    }
    if let Some(desktop_dir) = dirs::desktop_dir() {
        roots.push(desktop_dir);
    }
    if let Some(audio_dir) = dirs::audio_dir() {
        roots.push(audio_dir);
    }

    roots
}

#[cfg(test)]
mod tests {
    use super::*;

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

    // The percent-decoder tests moved with the decoder itself into
    // `commands::binary_ipc`, which now owns the one shared header-validation
    // chain for every raw-body command.
}
