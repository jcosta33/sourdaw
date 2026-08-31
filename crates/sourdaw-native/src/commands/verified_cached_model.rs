use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use super::filesystem::APP_DIR_NAME;

pub struct VerifiedCachedModel {
    pub filename: &'static str,
    pub expected_sha256: &'static str,
    pub expected_size_bytes: u64,
}

/// Locate the shared model cache without creating or mutating it.
pub fn cached_model_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or("Could not determine data directory")?
        .join(APP_DIR_NAME)
        .join("models"))
}

/// Read a verified cached artifact through one non-link file handle. The bytes
/// returned here are the exact bytes a local inference caller must consume;
/// returning a path after verification would re-open a mutable name and leave
/// a hash-to-parser replacement race.
pub async fn read_verified_cached_model(
    model: &'static VerifiedCachedModel,
) -> Result<Vec<u8>, String> {
    validate_cached_model_spec(model)?;
    let path = cached_model_dir()?.join(model.filename);
    tokio::task::spawn_blocking(move || read_verified_cached_model_bytes(&path, model))
        .await
        .map_err(|error| format!("Verified model read task failed: {error}"))?
}

fn read_verified_cached_model_bytes(
    path: &Path,
    model: &VerifiedCachedModel,
) -> Result<Vec<u8>, String> {
    read_verified_cached_model_bytes_with_hooks(
        path,
        model,
        #[cfg(test)]
        || {},
        #[cfg(test)]
        || {},
    )
}

/// Read the artifact exactly once, then hash the bytes that will be returned.
/// The callback exists to pin the former verify-then-rewind boundary in a
/// regression: replacing the on-disk file after this point cannot alter the
/// already-owned buffer handed to Whisper.
#[cfg(test)]
fn read_verified_cached_model_bytes_after_read(
    path: &Path,
    model: &VerifiedCachedModel,
    after_read: impl FnOnce(),
) -> Result<Vec<u8>, String> {
    read_verified_cached_model_bytes_with_hooks(path, model, || {}, after_read)
}

fn read_verified_cached_model_bytes_with_hooks(
    path: &Path,
    model: &VerifiedCachedModel,
    #[cfg(test)] after_metadata: impl FnOnce(),
    #[cfg(test)] after_read: impl FnOnce(),
) -> Result<Vec<u8>, String> {
    let link_metadata = std::fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Verified local model {} is not cached: {error}",
            model.filename
        )
    })?;
    if link_metadata.file_type().is_symlink() {
        return Err(format!(
            "Verified local model {} must not be a symlink.",
            model.filename
        ));
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::FileTypeExt;
        link_metadata.file_type().is_reparse_point()
    } {
        return Err(format!(
            "Verified local model {} must not be a reparse point.",
            model.filename
        ));
    }

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|error| {
        format!(
            "Failed to open verified local model {}: {error}",
            model.filename
        )
    })?;
    let metadata = file.metadata().map_err(|error| {
        format!(
            "Failed to inspect verified local model {}: {error}",
            model.filename
        )
    })?;
    if !metadata.is_file() || metadata.len() != model.expected_size_bytes {
        return Err(format!(
            "Verified local model {} failed size validation.",
            model.filename
        ));
    }
    #[cfg(test)]
    after_metadata();

    let mut bytes = Vec::with_capacity(model.expected_size_bytes as usize);
    file.read_to_end(&mut bytes).map_err(|error| {
        format!(
            "Failed to read verified local model {}: {error}",
            model.filename
        )
    })?;
    if bytes.len() as u64 != model.expected_size_bytes {
        return Err(format!(
            "Verified local model {} changed while it was read.",
            model.filename
        ));
    }
    #[cfg(test)]
    after_read();
    let actual = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if actual != model.expected_sha256 {
        return Err(format!(
            "Verified local model {} failed hash validation.",
            model.filename
        ));
    }

    Ok(bytes)
}

fn validate_cached_model_spec(model: &VerifiedCachedModel) -> Result<(), String> {
    validate_model_filename(model.filename)?;
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

fn validate_sha256(expected: &str) -> Result<(), String> {
    let is_hex = expected.bytes().all(|byte| byte.is_ascii_hexdigit());
    if expected.len() != 64 || !is_hex {
        return Err("Expected model SHA-256 must be a 64-character hex digest".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fs;

    const SMALL_VERIFIED_MODEL: VerifiedCachedModel = VerifiedCachedModel {
        filename: "small-verified-model.bin",
        expected_sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        expected_size_bytes: 3,
    };
    const WRONG_HASH_MODEL: VerifiedCachedModel = VerifiedCachedModel {
        expected_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        ..SMALL_VERIFIED_MODEL
    };
    const WRONG_SIZE_MODEL: VerifiedCachedModel = VerifiedCachedModel {
        expected_size_bytes: 4,
        ..SMALL_VERIFIED_MODEL
    };

    fn isolated_model_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("sourdaw-{name}-{}", std::process::id()))
    }

    #[test]
    fn cached_voice_reader_hashes_and_returns_the_same_open_file_bytes() {
        let path = isolated_model_path("verified-bytes");
        fs::write(&path, b"abc").expect("test artifact must be writable");

        let bytes = read_verified_cached_model_bytes(&path, &SMALL_VERIFIED_MODEL)
            .expect("the verified file handle must return its bytes");

        fs::remove_file(&path).expect("test artifact must be removed");
        assert_eq!(bytes, b"abc");
    }

    #[test]
    fn cached_voice_reader_rejects_an_artifact_with_the_wrong_hash() {
        let path = isolated_model_path("wrong-hash");
        fs::write(&path, b"abc").expect("test artifact must be writable");

        let result = read_verified_cached_model_bytes(&path, &WRONG_HASH_MODEL);

        fs::remove_file(&path).expect("test artifact must be removed");
        let error = result.expect_err("an artifact with the wrong hash must be rejected");
        assert!(error.contains("failed hash validation"));
    }

    #[test]
    fn cached_voice_reader_rejects_an_artifact_with_the_wrong_size() {
        let path = isolated_model_path("wrong-size");
        fs::write(&path, b"abc").expect("test artifact must be writable");

        let result = read_verified_cached_model_bytes(&path, &WRONG_SIZE_MODEL);

        fs::remove_file(&path).expect("test artifact must be removed");
        let error = result.expect_err("an artifact with the wrong size must be rejected");
        assert!(error.contains("failed size validation"));
    }

    #[test]
    fn cached_voice_reader_hashes_the_exact_bytes_returned_when_the_path_is_overwritten_after_read()
    {
        let path = isolated_model_path("same-length-overwrite");
        fs::write(&path, b"abc").expect("test artifact must be writable");
        let callback_ran = Cell::new(false);

        let bytes =
            read_verified_cached_model_bytes_after_read(&path, &SMALL_VERIFIED_MODEL, || {
                callback_ran.set(true);
                fs::write(&path, b"xyz").expect("same-length replacement must be writable");
            })
            .expect("the initially read, verified bytes must remain the returned bytes");

        fs::remove_file(&path).expect("test artifact must be removed");
        assert!(callback_ran.get(), "the path replacement hook must run");
        assert_eq!(bytes, b"abc");
    }

    #[test]
    fn cached_voice_reader_rejects_length_changed_after_opened_file_metadata_check() {
        let path = isolated_model_path("truncate-after-metadata");
        fs::write(&path, b"abc").expect("test artifact must be writable");

        let result = read_verified_cached_model_bytes_with_hooks(
            &path,
            &SMALL_VERIFIED_MODEL,
            || fs::write(&path, b"a").expect("test artifact must be truncatable"),
            || {},
        );

        fs::remove_file(&path).expect("test artifact must be removed");
        let error = result.expect_err("a file truncated after metadata must be rejected");
        assert!(error.contains("changed while it was read"));
    }

    #[cfg(unix)]
    #[test]
    fn cached_voice_reader_rejects_a_symlink_before_it_can_be_verified_or_loaded() {
        use std::os::unix::fs::symlink;

        let target = isolated_model_path("symlink-target");
        let link = isolated_model_path("symlink");
        fs::write(&target, b"abc").expect("test target must be writable");
        symlink(&target, &link).expect("test symlink must be created");

        let error = read_verified_cached_model_bytes(&link, &SMALL_VERIFIED_MODEL)
            .expect_err("a symbolic link must never become a Whisper input");

        fs::remove_file(&link).expect("test symlink must be removed");
        fs::remove_file(&target).expect("test target must be removed");
        assert!(error.contains("must not be a symlink"));
    }
}
