use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const APP_DIR_NAME: &str = "com.sourdaw.app";
const IPC_TEMP_DIR_NAME: &str = "sourdaw_ipc";

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

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    let file_path = resolve_existing_file_path(&path)?;
    std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn write_audio_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let file_path = resolve_writable_file_path(&path)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&file_path, &data).map_err(|e| format!("Failed to write file: {}", e))
}

/// Header carrying the percent-encoded destination path for `write_file_bytes`.
const FILE_PATH_HEADER: &str = "x-sourdaw-path";

/// Decode a percent-encoded (`encodeURIComponent`) header value back to a path.
///
/// Header values must be printable ASCII, but paths are arbitrary UTF-8, so the
/// frontend percent-encodes them. Decoding is done here rather than pulling in a
/// dependency: the grammar is three characters wide and fully specified.
fn decode_percent_encoded(value: &str) -> Result<String, String> {
    let raw = value.as_bytes();
    let mut decoded = Vec::with_capacity(raw.len());
    let mut index = 0;

    while index < raw.len() {
        if raw[index] != b'%' {
            decoded.push(raw[index]);
            index += 1;
            continue;
        }

        if index + 2 >= raw.len() {
            return Err("Malformed percent-encoded path: truncated escape".to_string());
        }

        let high = (raw[index + 1] as char)
            .to_digit(16)
            .ok_or_else(|| "Malformed percent-encoded path: invalid hex digit".to_string())?;
        let low = (raw[index + 2] as char)
            .to_digit(16)
            .ok_or_else(|| "Malformed percent-encoded path: invalid hex digit".to_string())?;

        decoded.push(((high << 4) | low) as u8);
        index += 3;
    }

    String::from_utf8(decoded)
        .map_err(|_| "Malformed percent-encoded path: not valid UTF-8".to_string())
}

/// Write raw bytes to a file, received over Tauri's binary IPC path.
///
/// The whole invoke message is the file's bytes (`InvokeBody::Raw`), so nothing
/// is JSON-serialized: a multi-megabyte export crosses at exactly its byte
/// length instead of inflating into a decimal number array. The destination
/// path travels in the `x-sourdaw-path` header because the body is fully
/// occupied by the payload.
///
/// Path resolution and directory creation match `write_audio_file` exactly, so
/// the same bytes land at the same location.
#[tauri::command]
pub async fn write_file_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let encoded_path = request
        .headers()
        .get(FILE_PATH_HEADER)
        .ok_or_else(|| format!("Missing '{}' header", FILE_PATH_HEADER))?
        .to_str()
        .map_err(|_| format!("Header '{}' is not valid ASCII", FILE_PATH_HEADER))?;
    let path = decode_percent_encoded(encoded_path)?;

    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        // Tauri falls back to a JSON body where raw bodies are unsupported.
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("write_file_bytes requires a raw byte body".to_string())
        }
    };

    let file_path = resolve_writable_file_path(&path)?;
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&file_path, data).map_err(|e| format!("Failed to write file: {}", e))
}

/// Read a file's bytes, returned over Tauri's binary IPC path.
///
/// `tauri::ipc::Response` carries the bytes verbatim to the webview as an
/// `ArrayBuffer`, avoiding the JSON number array that `read_audio_file`
/// produces. Path resolution matches `read_audio_file` exactly.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let file_path = resolve_existing_file_path(&path)?;
    let bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
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

pub(crate) fn resolve_existing_file_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical)?;
    if !canonical.is_file() {
        return Err("Path is not a file".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_existing_directory_path(path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_renderer_path(path)?;
    let canonical = canonicalize_existing_path(&resolved)?;
    ensure_allowed_root(&canonical)?;
    if !canonical.is_dir() {
        return Err("Not a directory".to_string());
    }
    Ok(canonical)
}

pub(crate) fn resolve_writable_file_path(path: &str) -> Result<PathBuf, String> {
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

pub(crate) fn require_extension(
    path: PathBuf,
    extension: &str,
    label: &str,
) -> Result<PathBuf, String> {
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

    let input = Path::new(trimmed);
    if input.is_absolute() {
        return normalize_absolute_path(input);
    }

    reject_relative_parent_segments(input)?;
    Ok(ipc_temp_dir().join(input))
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

    #[test]
    fn should_decode_a_percent_encoded_ascii_path_unchanged() {
        let decoded = decode_percent_encoded("/exports/Sourdaw_Bake_1.wav").unwrap();

        assert_eq!(decoded, "/exports/Sourdaw_Bake_1.wav");
    }

    #[test]
    fn should_decode_multibyte_utf8_escapes_produced_by_encode_uri_component() {
        // encodeURIComponent('/Users/josé/Música/kick.wav')
        let encoded = "%2FUsers%2Fjos%C3%A9%2FM%C3%BAsica%2Fkick.wav";

        let decoded = decode_percent_encoded(encoded).unwrap();

        assert_eq!(decoded, "/Users/josé/Música/kick.wav");
    }

    #[test]
    fn should_decode_a_space_and_reserved_characters() {
        let decoded = decode_percent_encoded("/exports/My%20Track%20%231.wav").unwrap();

        assert_eq!(decoded, "/exports/My Track #1.wav");
    }

    #[test]
    fn should_reject_a_truncated_percent_escape() {
        let result = decode_percent_encoded("/exports/bad%4");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: truncated escape"
        );
    }

    #[test]
    fn should_reject_a_non_hex_percent_escape() {
        let result = decode_percent_encoded("/exports/bad%ZZ.wav");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: invalid hex digit"
        );
    }

    #[test]
    fn should_reject_escapes_that_decode_to_invalid_utf8() {
        let result = decode_percent_encoded("%FF%FE");

        assert_eq!(
            result.unwrap_err(),
            "Malformed percent-encoded path: not valid UTF-8"
        );
    }
}
