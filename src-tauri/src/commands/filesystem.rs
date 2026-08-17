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

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::binary_ipc::raw_response_bytes;

    fn block_on<Fut: std::future::Future>(future: Fut) -> Fut::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build")
            .block_on(future)
    }

    #[test]
    fn read_file_bytes_returns_a_raw_body_not_a_json_number_array() {
        let path = std::env::temp_dir().join("sourdaw-read-file-bytes-raw-body.bin");
        let chunk = vec![0u8, 1, 127, 128, 200, 254, 255, 0];
        std::fs::write(&path, &chunk).expect("fixture file should be writable");

        let response = block_on(read_file_bytes(path.to_string_lossy().into_owned()))
            .expect("file read should succeed");

        assert_eq!(raw_response_bytes(response), chunk);

        let _ = std::fs::remove_file(&path);
    }
}
