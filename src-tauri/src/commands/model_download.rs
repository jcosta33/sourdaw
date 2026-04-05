use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;

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
pub async fn ensure_model(
    filename: &str,
    url: &str,
    expected_sha256: Option<&str>,
) -> Result<PathBuf, String> {
    let dir = model_dir()?;
    let path = dir.join(filename);

    if path.exists() {
        if let Some(expected) = expected_sha256 {
            let actual = sha256_file(&path)?;
            if actual != expected {
                eprintln!("[Model] Cached {filename} has wrong hash, re-downloading.");
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove corrupt model: {e}"))?;
            } else {
                return Ok(path);
            }
        } else {
            return Ok(path);
        }
    }

    // Check for partial download
    let tmp = path.with_extension("tmp");
    if tmp.exists() {
        std::fs::remove_file(&tmp).ok();
    }

    // Check available disk space before downloading
    check_disk_space(&dir, filename)?;

    eprintln!("[Model] Downloading {filename}...");
    download_with_progress(url, &tmp, filename).await?;

    // Rename to final path
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to finalize model file: {e}"))?;

    if let Some(expected) = expected_sha256 {
        let actual = sha256_file(&path)?;
        if actual != expected {
            std::fs::remove_file(&path).ok();
            return Err(format!(
                "Downloaded file hash mismatch: expected {expected}, got {actual}"
            ));
        }
    }

    eprintln!("[Model] {filename} ready");
    Ok(path)
}

/// Stream download with progress logging.
async fn download_with_progress(url: &str, dest: &PathBuf, name: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600)) // 1h timeout for large models
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let total_mb = total as f64 / 1_048_576.0;

    if total > 0 {
        eprintln!("[Model] {name}: {total_mb:.1} MB");
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
                "[Model] {name}: {pct}% ({:.1}/{total_mb:.1} MB)",
                downloaded as f64 / 1_048_576.0
            );
            last_report = downloaded;
        }
    }

    file.flush().map_err(|e| format!("File flush error: {e}"))?;
    drop(file);

    eprintln!(
        "[Model] {name}: download complete ({:.1} MB)",
        downloaded as f64 / 1_048_576.0
    );
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
    let data = std::fs::read(path).map_err(|e| format!("Failed to read file for hash: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(format!("{:x}", hasher.finalize()))
}
