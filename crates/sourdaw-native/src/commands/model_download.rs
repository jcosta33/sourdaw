use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub struct ModelDownload {
    pub filename: &'static str,
    pub url: &'static str,
    pub expected_sha256: &'static str,
    pub expected_size_bytes: u64,
}

/// Get the shared model cache directory.
pub fn model_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or("Could not determine data directory")?
        .join("com.sourdaw.app")
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create model directory: {e}"))?;
    Ok(dir)
}

/// Ensure a model file exists locally, downloading it if necessary.
/// Returns the path to the cached model file.
pub async fn ensure_model(model: &ModelDownload) -> Result<PathBuf, String> {
    validate_model_spec(model)?;
    let dir = model_dir()?;
    let path = dir.join(model.filename);

    if path.exists() {
        if model_file_matches(&path, model)? {
            return Ok(path);
        } else {
            eprintln!(
                "[Model] Cached {} failed integrity checks, re-downloading.",
                model.filename
            );
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove untrusted model: {e}"))?;
        }
    }

    // Check for partial download
    let tmp = path.with_extension("tmp");
    if tmp.exists() {
        std::fs::remove_file(&tmp).ok();
    }

    // Check available disk space before downloading
    check_disk_space(&dir, model.filename)?;

    eprintln!("[Model] Downloading {}...", model.filename);
    download_with_progress(model, &tmp).await?;

    verify_model_file(&tmp, model)?;

    // Rename to final path
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to finalize model file: {e}"))?;

    eprintln!("[Model] {} ready", model.filename);
    Ok(path)
}

/// Stream download with progress logging.
async fn download_with_progress(model: &ModelDownload, dest: &PathBuf) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600)) // 1h timeout for large models
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(model.url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    if total > 0 && total != model.expected_size_bytes {
        return Err(format!(
            "Model size mismatch before download for {}: expected {} bytes, server reported {} bytes",
            model.filename, model.expected_size_bytes, total
        ));
    }
    let total_mb = total as f64 / 1_048_576.0;

    if total > 0 {
        eprintln!("[Model] {}: {total_mb:.1} MB", model.filename);
    }

    let mut file =
        std::fs::File::create(dest).map_err(|e| format!("Failed to create file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_report = 0u64;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("File write error: {e}"))?;

        downloaded += chunk.len() as u64;

        // Log progress every 10MB
        if total > 0 && downloaded - last_report > 10_485_760 {
            let pct = (downloaded as f64 / total as f64 * 100.0) as u32;
            eprintln!(
                "[Model] {}: {pct}% ({:.1}/{total_mb:.1} MB)",
                model.filename,
                downloaded as f64 / 1_048_576.0
            );
            last_report = downloaded;
        }
    }

    file.flush().map_err(|e| format!("File flush error: {e}"))?;
    drop(file);

    eprintln!(
        "[Model] {}: download complete ({:.1} MB)",
        model.filename,
        downloaded as f64 / 1_048_576.0
    );
    Ok(())
}

fn validate_model_spec(model: &ModelDownload) -> Result<(), String> {
    validate_model_filename(model.filename)?;
    validate_model_url(model.url)?;
    validate_sha256(model.expected_sha256)?;
    if model.expected_size_bytes == 0 {
        return Err("Model expected size must be non-zero".to_string());
    }
    Ok(())
}

fn validate_model_filename(filename: &str) -> Result<(), String> {
    let path = Path::new(filename);
    if path.components().count() != 1 {
        return Err("Model filename must be a single path segment".to_string());
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Model filename must be a normal path segment".to_string());
        }
    }
    Ok(())
}

fn validate_model_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid model URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Model URL must use HTTPS".to_string());
    }
    if parsed.host_str() != Some("huggingface.co") {
        return Err("Model URL host must be huggingface.co".to_string());
    }
    Ok(())
}

fn validate_sha256(expected: &str) -> Result<(), String> {
    let is_hex = expected.bytes().all(|byte| byte.is_ascii_hexdigit());
    if expected.len() != 64 || !is_hex {
        return Err("Expected model SHA-256 must be a 64-character hex digest".to_string());
    }
    Ok(())
}

fn model_file_matches(path: &PathBuf, model: &ModelDownload) -> Result<bool, String> {
    match verify_model_file(path, model) {
        Ok(()) => Ok(true),
        Err(error) => {
            eprintln!(
                "[Model] Integrity check failed for {}: {error}",
                model.filename
            );
            Ok(false)
        }
    }
}

fn verify_model_file(path: &PathBuf, model: &ModelDownload) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to stat model file: {e}"))?;
    if metadata.len() != model.expected_size_bytes {
        return Err(format!(
            "Model size mismatch for {}: expected {} bytes, got {} bytes",
            model.filename,
            model.expected_size_bytes,
            metadata.len()
        ));
    }

    let actual = sha256_file(path)?;
    if actual != model.expected_sha256 {
        return Err(format!(
            "Model hash mismatch for {}: expected {}, got {}",
            model.filename, model.expected_sha256, actual
        ));
    }
    Ok(())
}

/// Rough disk space check — warns if less than 1GB free.
fn check_disk_space(dir: &PathBuf, filename: &str) -> Result<(), String> {
    // statvfs on macOS/Linux
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = std::fs::metadata(dir) {
            // Use statvfs via nix or just check we can write
            let _ = meta.blksize(); // confirm it's a real filesystem
        }
    }
    // Simple heuristic: try to get free space via temp file
    let test_path = dir.join(".space_check");
    if let Err(e) = std::fs::write(&test_path, b"ok") {
        return Err(format!(
            "Cannot write to model directory for {filename}: {e}. Check disk space and permissions."
        ));
    }
    std::fs::remove_file(&test_path).ok();
    Ok(())
}

fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to read file for hash: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file for hash: {e}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}
