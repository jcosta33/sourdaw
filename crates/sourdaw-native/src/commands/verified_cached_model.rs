use sha2::{Digest, Sha256};
use std::io::{Read, Write};
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
    if sha256_hex(&bytes) != model.expected_sha256 {
        return Err(format!(
            "Verified local model {} failed hash validation.",
            model.filename
        ));
    }

    Ok(bytes)
}

/// Verify `bytes` against the pinned spec, then install them as the cached
/// artifact.
///
/// This is the write half of the cache boundary, deliberately asymmetric with
/// the read half: the reader never creates or repairs, while the writer
/// exists to populate — so it creates the cache directory, and it runs only
/// behind an explicit, consented renderer download whose bytes it re-verifies
/// before anything reaches disk. The install is stage-fsync-rename inside the
/// cache directory, so a concurrent reader observes the old verified file or
/// the new one, never a partial write.
pub async fn write_verified_cached_model(
    model: &'static VerifiedCachedModel,
    bytes: Vec<u8>,
) -> Result<(), String> {
    validate_cached_model_spec(model)?;
    let directory = cached_model_dir()?;
    tokio::task::spawn_blocking(move || {
        write_verified_cached_model_bytes(&directory, model, &bytes)
    })
    .await
    .map_err(|error| format!("Verified model write task failed: {error}"))?
}

pub(crate) fn write_verified_cached_model_bytes(
    directory: &Path,
    model: &VerifiedCachedModel,
    bytes: &[u8],
) -> Result<(), String> {
    verify_model_bytes_for_write(model, bytes)?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create the verified model cache directory: {error}"))?;
    let target = directory.join(model.filename);
    refuse_link_target(&target, model)?;
    // Same-directory staging keeps the rename atomic on one filesystem. The
    // process id scopes the name to this process, so a leftover from a crashed
    // attempt is ours and stale by definition, and the staging open replaces
    // it outright.
    let staging = directory.join(format!(".{}.stage-{}", model.filename, std::process::id()));
    let outcome = stage_and_rename(&staging, &target, model, bytes);
    if outcome.is_err() {
        let _ = std::fs::remove_file(&staging);
    }
    outcome
}

fn verify_model_bytes_for_write(model: &VerifiedCachedModel, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != model.expected_size_bytes {
        return Err(format!(
            "Refusing to store {}: size {} does not match the pinned {} bytes.",
            model.filename,
            bytes.len(),
            model.expected_size_bytes
        ));
    }
    if sha256_hex(bytes) != model.expected_sha256 {
        return Err(format!(
            "Refusing to store {}: SHA-256 does not match the pinned digest.",
            model.filename
        ));
    }
    Ok(())
}

fn refuse_link_target(target: &Path, model: &VerifiedCachedModel) -> Result<(), String> {
    let Ok(metadata) = std::fs::symlink_metadata(target) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Refusing to replace the symlink named {} with a verified model.",
            model.filename
        ));
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::FileTypeExt;
        metadata.file_type().is_reparse_point()
    } {
        return Err(format!(
            "Refusing to replace the reparse point named {} with a verified model.",
            model.filename
        ));
    }
    Ok(())
}

fn stage_and_rename(
    staging: &Path,
    target: &Path,
    model: &VerifiedCachedModel,
    bytes: &[u8],
) -> Result<(), String> {
    let _ = std::fs::remove_file(staging);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staging)
        .map_err(|error| {
            format!(
                "Failed to stage verified local model {}: {error}",
                model.filename
            )
        })?;
    file.write_all(bytes).map_err(|error| {
        format!(
            "Failed to write verified local model {}: {error}",
            model.filename
        )
    })?;
    file.sync_all().map_err(|error| {
        format!(
            "Failed to persist verified local model {}: {error}",
            model.filename
        )
    })?;
    drop(file);
    // Windows refuses to rename over an existing destination, so the previous
    // verified file is removed first; a failure between the two leaves the
    // cache merely absent, which the read boundary already reports as a miss
    // and a consented re-download repairs.
    if std::fs::symlink_metadata(target).is_ok() {
        std::fs::remove_file(target).map_err(|error| {
            format!("Failed to replace cached model {}: {error}", model.filename)
        })?;
    }
    std::fs::rename(staging, target).map_err(|error| {
        format!(
            "Failed to install verified local model {}: {error}",
            model.filename
        )
    })?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
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

    fn isolated_model_dir(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("sourdaw-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn cached_model_writer_stores_bytes_a_verified_read_then_returns() {
        let directory = isolated_model_dir("writer-happy");

        write_verified_cached_model_bytes(&directory, &SMALL_VERIFIED_MODEL, b"abc")
            .expect("a spec-conforming artifact must be stored");
        let bytes = read_verified_cached_model_bytes(
            &directory.join(SMALL_VERIFIED_MODEL.filename),
            &SMALL_VERIFIED_MODEL,
        )
        .expect("the stored artifact must pass the verified read");

        fs::remove_dir_all(&directory).expect("test cache directory must be removed");
        assert_eq!(bytes, b"abc");
    }

    #[test]
    fn cached_model_writer_refuses_the_wrong_size_without_creating_the_cache() {
        let directory = isolated_model_dir("writer-wrong-size");

        let error = write_verified_cached_model_bytes(&directory, &SMALL_VERIFIED_MODEL, b"abcd")
            .expect_err("a size mismatch must be refused");

        assert!(error.contains("does not match the pinned"));
        assert!(
            !directory.exists(),
            "a refused write must not create the cache directory"
        );
    }

    #[test]
    fn cached_model_writer_refuses_the_wrong_hash_without_creating_the_cache() {
        let directory = isolated_model_dir("writer-wrong-hash");

        let error = write_verified_cached_model_bytes(&directory, &WRONG_HASH_MODEL, b"abc")
            .expect_err("a hash mismatch must be refused");

        assert!(error.contains("SHA-256"));
        assert!(
            !directory.exists(),
            "a refused write must not create the cache directory"
        );
    }

    #[test]
    fn cached_model_writer_replaces_an_existing_verified_file() {
        let directory = isolated_model_dir("writer-overwrite");
        write_verified_cached_model_bytes(&directory, &SMALL_VERIFIED_MODEL, b"abc")
            .expect("the initial store must succeed");

        write_verified_cached_model_bytes(&directory, &SMALL_VERIFIED_MODEL, b"abc")
            .expect("storing over an existing verified file must succeed");
        let bytes = read_verified_cached_model_bytes(
            &directory.join(SMALL_VERIFIED_MODEL.filename),
            &SMALL_VERIFIED_MODEL,
        )
        .expect("the replaced artifact must pass the verified read");

        fs::remove_dir_all(&directory).expect("test cache directory must be removed");
        assert_eq!(bytes, b"abc");
    }

    #[cfg(unix)]
    #[test]
    fn cached_model_writer_refuses_to_replace_a_symlink() {
        use std::os::unix::fs::symlink;

        let directory = isolated_model_dir("writer-symlink");
        fs::create_dir_all(&directory).expect("test cache directory must be creatable");
        let decoy = directory.join("decoy.bin");
        fs::write(&decoy, b"abc").expect("test decoy must be writable");
        let target = directory.join(SMALL_VERIFIED_MODEL.filename);
        symlink(&decoy, &target).expect("test symlink must be created");

        let error = write_verified_cached_model_bytes(&directory, &SMALL_VERIFIED_MODEL, b"abc")
            .expect_err("a symlink cache entry must never be replaced by the writer");

        let still_a_link = std::fs::symlink_metadata(&target)
            .expect("the symlink must still exist")
            .file_type()
            .is_symlink();
        fs::remove_dir_all(&directory).expect("test cache directory must be removed");
        assert!(error.contains("symlink"));
        assert!(still_a_link, "the symlink must survive the refused write");
    }
}
