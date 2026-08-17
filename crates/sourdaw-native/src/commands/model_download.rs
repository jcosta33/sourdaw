use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Mutex as AsyncMutex;

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

/// One async lock per model filename, shared process-wide.
///
/// Invariant: every "inspect the cached file → download to `<filename>.tmp` →
/// verify → rename" sequence in `ensure_model` runs under this lock. The tmp
/// path is shared per model, so without exclusion two concurrent calls
/// interleave writes into the same tmp file and race the final rename; with
/// it, the second caller awaits the first and then finds the verified cache.
fn model_lock(filename: &str) -> Arc<AsyncMutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();
    let registry = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    // Recover from poisoning: the registry is insert-only, so a panic while
    // it was held cannot leave it observably inconsistent.
    let mut map = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.entry(filename.to_string())
        .or_insert_with(|| Arc::new(AsyncMutex::new(())))
        .clone()
}

/// Ensure a model file exists locally, downloading it if necessary.
/// Returns the path to the cached model file.
///
/// Concurrent calls for the same model serialize on `model_lock`, so the
/// download happens at most once per process at a time and a caller that
/// arrives mid-download awaits it instead of starting a duplicate.
pub async fn ensure_model(model: &ModelDownload) -> Result<PathBuf, String> {
    validate_model_spec(model)?;
    let lock = model_lock(model.filename);
    let _exclusive = lock.lock().await;
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

    // Remove a stale partial download. Safe under `model_lock`: a tmp file
    // observed here can only belong to a previous crashed or aborted run,
    // never to a download still in flight. The tmp name appends to the full
    // filename (never `with_extension`, which would map `foo.bin` and
    // `foo.gguf` onto the same `foo.tmp`).
    let tmp = dir.join(format!("{}.tmp", model.filename));
    if tmp.exists() {
        std::fs::remove_file(&tmp).ok();
    }

    // Fail fast if the destination cannot hold the download.
    check_disk_space(
        &dir,
        model.filename,
        model
            .expected_size_bytes
            .saturating_add(DISK_SPACE_MARGIN_BYTES),
    )?;

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

/// Headroom demanded beyond the model itself, so a download cannot land the
/// user on a byte-exact full disk.
const DISK_SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;

/// Pre-download destination check.
///
/// On unix (every platform the desktop shells ship) this measures actual
/// free space via `statvfs` and rejects the download when `required_bytes`
/// does not fit, so a 142 MB+ stream does not discover a full disk as a
/// mid-stream write error. On other platforms only the writability probe
/// below runs — it verifies permissions, not space.
fn check_disk_space(dir: &Path, filename: &str, required_bytes: u64) -> Result<(), String> {
    #[cfg(unix)]
    {
        let free = free_disk_space_bytes(dir)?;
        if free < required_bytes {
            return Err(format!(
                "Not enough disk space for {filename}: {free} bytes free, {required_bytes} bytes required (model plus margin). Free up space and retry."
            ));
        }
    }

    // Writability probe: catches a read-only or permission-broken model
    // directory before the download starts. Named per model so probes for
    // different models never collide; same-model calls are already
    // serialized by `model_lock`.
    let test_path = dir.join(format!(".{filename}.space_check"));
    if let Err(e) = std::fs::write(&test_path, b"ok") {
        return Err(format!(
            "Cannot write to model directory for {filename}: {e}. Check permissions."
        ));
    }
    std::fs::remove_file(&test_path).ok();
    Ok(())
}

/// Free space in bytes available to an unprivileged process on the
/// filesystem holding `dir`, via `statvfs`.
#[cfg(unix)]
fn free_disk_space_bytes(dir: &Path) -> Result<u64, String> {
    use std::os::unix::ffi::OsStrExt;

    let c_path = std::ffi::CString::new(dir.as_os_str().as_bytes())
        .map_err(|_| "Model directory path contains a NUL byte".to_string())?;
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c_path` is a valid NUL-terminated path and `stats` is a valid
    // out-pointer for the duration of the call.
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stats) };
    if rc != 0 {
        return Err(format!(
            "Failed to query free disk space for the model directory: {}",
            std::io::Error::last_os_error()
        ));
    }
    // `f_bavail` counts fragments available to unprivileged callers;
    // `f_frsize` is the fragment size.
    Ok((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The per-model exclusion contract: one shared lock per model filename,
    /// independent locks across models. Without this, two `ensure_model`
    /// calls for the same model interleave writes into the shared
    /// `<filename>.tmp` and race the rename to the final path.
    #[test]
    fn model_lock_is_shared_per_model_and_independent_across_models() {
        let first = model_lock("lock-contract-a.bin");
        let same = model_lock("lock-contract-a.bin");
        let other = model_lock("lock-contract-b.bin");

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other));

        // Holding the lock through one handle excludes the other handle —
        // the exclusion is real, not two locks that happen to share a name.
        let held = first.try_lock().expect("uncontended lock must acquire");
        assert!(same.try_lock().is_err());
        assert!(other.try_lock().is_ok());
        drop(held);
        assert!(same.try_lock().is_ok());
    }

    /// Two tasks racing the same model's critical section never overlap:
    /// the section observes itself as the only occupant, so check→download→
    /// rename runs whole per caller.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn same_model_critical_sections_serialize() {
        let occupancy = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));

        let mut tasks = Vec::new();
        for _ in 0..2 {
            let occupancy = occupancy.clone();
            let max_seen = max_seen.clone();
            tasks.push(tokio::spawn(async move {
                let lock = model_lock("serialize-contract.bin");
                let _exclusive = lock.lock().await;
                let inside = occupancy.fetch_add(1, Ordering::SeqCst) + 1;
                max_seen.fetch_max(inside, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                occupancy.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for task in tasks {
            task.await.expect("task must not panic");
        }

        assert_eq!(max_seen.load(Ordering::SeqCst), 1);
    }

    /// The disk check measures real free space, not mere writability: an
    /// impossible requirement fails before any download, a trivial one
    /// passes.
    #[cfg(unix)]
    #[test]
    fn disk_check_rejects_a_download_larger_than_free_space() {
        let dir = std::env::temp_dir();

        check_disk_space(&dir, "tiny-model.bin", 1)
            .expect("a 1-byte requirement must fit any live filesystem");

        let error = check_disk_space(&dir, "huge-model.bin", u64::MAX)
            .expect_err("no filesystem has u64::MAX bytes free");
        assert!(
            error.contains("Not enough disk space"),
            "error must name the space shortfall, got: {error}"
        );
    }
}
