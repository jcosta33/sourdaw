use sourdaw_native::commands::filesystem as native;

use super::binary_ipc::{raw_body_bytes, read_percent_encoded_header};

pub use sourdaw_native::commands::filesystem::DirectoryEntry;

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    native::read_audio_file(path).await
}

#[tauri::command]
pub async fn write_audio_file(path: String, data: Vec<u8>) -> Result<(), String> {
    native::write_audio_file(path, data).await
}

/// Write raw bytes to a file.
///
/// The whole invoke message is the payload, so the destination path travels in
/// the `x-sourdaw-path` header instead of as a sibling argument.
#[tauri::command]
pub async fn write_file_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let path = read_percent_encoded_header(&request, native::FILE_PATH_HEADER)?;
    let data = raw_body_bytes(&request, "write_file_bytes")?;

    native::write_file_bytes(path, data).await
}

/// Read a file's bytes, returned verbatim rather than as a JSON number array.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = native::read_file_bytes(path).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    native::list_directory(path).await
}
