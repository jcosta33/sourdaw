use sha2::{Digest, Sha256};
use std::fmt;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use super::filesystem::APP_DIR_NAME;

/// Why the verified model cache refused a read or a write. `Display` is the
/// message the renderer receives through the napi edge.
#[derive(Debug)]
pub enum ModelCacheError {
    NoDataDirectory,
    FilenameNotSingleSegment,
    FilenameNotNormalSegment,
    InvalidExpectedSha256,
    ZeroExpectedSize,
    ReadTaskFailed(tokio::task::JoinError),
    WriteTaskFailed(tokio::task::JoinError),
    NotCached {
        filename: &'static str,
        source: std::io::Error,
    },
    CachedSymlink {
        filename: &'static str,
    },
    #[cfg(windows)]
    CachedReparsePoint {
        filename: &'static str,
    },
    OpenFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    InspectFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    CachedSizeMismatch {
        filename: &'static str,
    },
    ReadFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    ChangedWhileRead {
        filename: &'static str,
    },
    CachedHashMismatch {
        filename: &'static str,
    },
    StoreSizeMismatch {
        filename: &'static str,
        actual_bytes: usize,
        expected_bytes: u64,
    },
    StoreHashMismatch {
        filename: &'static str,
    },
    CreateCacheDirectoryFailed(std::io::Error),
    ReplaceSymlink {
        filename: &'static str,
    },
    #[cfg(windows)]
    ReplaceReparsePoint {
        filename: &'static str,
    },
    StageFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    WriteFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    PersistFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    ReplaceFailed {
        filename: &'static str,
        source: std::io::Error,
    },
    InstallFailed {
        filename: &'static str,
        source: std::io::Error,
    },
}

impl fmt::Display for ModelCacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoDataDirectory => f.write_str("Could not determine data directory"),
            Self::FilenameNotSingleSegment => {
                f.write_str("Model filename must be a single path segment")
            }
            Self::FilenameNotNormalSegment => {
                f.write_str("Model filename must be a normal path segment")
            }
            Self::InvalidExpectedSha256 => {
                f.write_str("Expected model SHA-256 must be a 64-character hex digest")
            }
            Self::ZeroExpectedSize => f.write_str("Model expected size must be non-zero"),
            Self::ReadTaskFailed(error) => write!(f, "Verified model read task failed: {error}"),
            Self::WriteTaskFailed(error) => write!(f, "Verified model write task failed: {error}"),
            Self::NotCached { filename, source } => {
                write!(f, "Verified local model {filename} is not cached: {source}")
            }
            Self::CachedSymlink { filename } => {
                write!(f, "Verified local model {filename} must not be a symlink.")
            }
            #[cfg(windows)]
            Self::CachedReparsePoint { filename } => {
                write!(f, "Verified local model {filename} must not be a reparse point.")
            }
            Self::OpenFailed { filename, source } => {
                write!(f, "Failed to open verified local model {filename}: {source}")
            }
            Self::InspectFailed { filename, source } => {
                write!(f, "Failed to inspect verified local model {filename}: {source}")
            }
            Self::CachedSizeMismatch { filename } => {
                write!(f, "Verified local model {filename} failed size validation.")
            }
            Self::ReadFailed { filename, source } => {
                write!(f, "Failed to read verified local model {filename}: {source}")
            }
            Self::ChangedWhileRead { filename } => {
                write!(f, "Verified local model {filename} changed while it was read.")
            }
            Self::CachedHashMismatch { filename } => {
                write!(f, "Verified local model {filename} failed hash validation.")
            }
            Self::StoreSizeMismatch {
                filename,
                actual_bytes,
                expected_bytes,
            } => write!(
                f,
                "Refusing to store {filename}: size {actual_bytes} does not match the pinned {expected_bytes} bytes."
            ),
            Self::StoreHashMismatch { filename } => write!(
                f,
                "Refusing to store {filename}: SHA-256 does not match the pinned digest."
            ),
            Self::CreateCacheDirectoryFailed(source) => write!(
                f,
                "Failed to create the verified model cache directory: {source}"
            ),
            Self::ReplaceSymlink { filename } => write!(
                f,
                "Refusing to replace the symlink named {filename} with a verified model."
            ),
            #[cfg(windows)]
            Self::ReplaceReparsePoint { filename } => write!(
                f,
                "Refusing to replace the reparse point named {filename} with a verified model."
            ),
            Self::StageFailed { filename, source } => {
                write!(f, "Failed to stage verified local model {filename}: {source}")
            }
            Self::WriteFailed { filename, source } => {
                write!(f, "Failed to write verified local model {filename}: {source}")
            }
            Self::PersistFailed { filename, source } => {
                write!(f, "Failed to persist verified local model {filename}: {source}")
            }
            Self::ReplaceFailed { filename, source } => {
                write!(f, "Failed to replace cached model {filename}: {source}")
            }
            Self::InstallFailed { filename, source } => {
                write!(f, "Failed to install verified local model {filename}: {source}")
            }
        }
    }
}

impl std::error::Error for ModelCacheError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::ReadTaskFailed(source) | Self::WriteTaskFailed(source) => Some(source),
            Self::CreateCacheDirectoryFailed(source)
            | Self::NotCached { source, .. }
            | Self::OpenFailed { source, .. }
            | Self::InspectFailed { source, .. }
            | Self::ReadFailed { source, .. }
            | Self::StageFailed { source, .. }
            | Self::WriteFailed { source, .. }
            | Self::PersistFailed { source, .. }
            | Self::ReplaceFailed { source, .. }
            | Self::InstallFailed { source, .. } => Some(source),
            _ => None,
        }
    }
}

pub struct VerifiedCachedModel {
    pub filename: &'static str,
    pub expected_sha256: &'static str,
    pub expected_size_bytes: u64,
}

/// Locate the shared model cache without creating or mutating it.
pub fn cached_model_dir() -> Result<PathBuf, ModelCacheError> {
    Ok(dirs::data_dir()
        .ok_or(ModelCacheError::NoDataDirectory)?
        .join(APP_DIR_NAME)
        .join("models"))
}

/// Read a verified cached artifact through one non-link file handle. The bytes
/// returned here are the exact bytes a local inference caller must consume;
/// returning a path after verification would re-open a mutable name and leave
/// a hash-to-parser replacement race.
pub async fn read_verified_cached_model(
    model: &'static VerifiedCachedModel,
) -> Result<Vec<u8>, ModelCacheError> {
    validate_cached_model_spec(model)?;
    let path = cached_model_dir()?.join(model.filename);
    tokio::task::spawn_blocking(move || read_verified_cached_model_bytes(&path, model))
        .await
        .map_err(ModelCacheError::ReadTaskFailed)?
}

fn read_verified_cached_model_bytes(
    path: &Path,
    model: &VerifiedCachedModel,
) -> Result<Vec<u8>, ModelCacheError> {
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
) -> Result<Vec<u8>, ModelCacheError> {
    read_verified_cached_model_bytes_with_hooks(path, model, || {}, after_read)
}

fn read_verified_cached_model_bytes_with_hooks(
    path: &Path,
    model: &VerifiedCachedModel,
    #[cfg(test)] after_metadata: impl FnOnce(),
    #[cfg(test)] after_read: impl FnOnce(),
) -> Result<Vec<u8>, ModelCacheError> {
    let link_metadata =
        std::fs::symlink_metadata(path).map_err(|source| ModelCacheError::NotCached {
            filename: model.filename,
            source,
        })?;
    if link_metadata.file_type().is_symlink() {
        return Err(ModelCacheError::CachedSymlink {
            filename: model.filename,
        });
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::FileTypeExt;
        link_metadata.file_type().is_reparse_point()
    } {
        return Err(ModelCacheError::CachedReparsePoint {
            filename: model.filename,
        });
    }

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(path)
        .map_err(|source| ModelCacheError::OpenFailed {
            filename: model.filename,
            source,
        })?;
    let metadata = file
        .metadata()
        .map_err(|source| ModelCacheError::InspectFailed {
            filename: model.filename,
            source,
        })?;
    if !metadata.is_file() || metadata.len() != model.expected_size_bytes {
        return Err(ModelCacheError::CachedSizeMismatch {
            filename: model.filename,
        });
    }
    #[cfg(test)]
    after_metadata();

    let mut bytes = Vec::with_capacity(model.expected_size_bytes as usize);
    file.read_to_end(&mut bytes)
        .map_err(|source| ModelCacheError::ReadFailed {
            filename: model.filename,
            source,
        })?;
    if bytes.len() as u64 != model.expected_size_bytes {
        return Err(ModelCacheError::ChangedWhileRead {
            filename: model.filename,
        });
    }
    #[cfg(test)]
    after_read();
    if sha256_hex(&bytes) != model.expected_sha256 {
        return Err(ModelCacheError::CachedHashMismatch {
            filename: model.filename,
        });
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
) -> Result<(), ModelCacheError> {
    validate_cached_model_spec(model)?;
    let directory = cached_model_dir()?;
    tokio::task::spawn_blocking(move || {
        write_verified_cached_model_bytes(&directory, model, &bytes)
    })
    .await
    .map_err(ModelCacheError::WriteTaskFailed)?
}

pub(crate) fn write_verified_cached_model_bytes(
    directory: &Path,
    model: &VerifiedCachedModel,
    bytes: &[u8],
) -> Result<(), ModelCacheError> {
    verify_model_bytes_for_write(model, bytes)?;
    std::fs::create_dir_all(directory).map_err(ModelCacheError::CreateCacheDirectoryFailed)?;
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

fn verify_model_bytes_for_write(
    model: &VerifiedCachedModel,
    bytes: &[u8],
) -> Result<(), ModelCacheError> {
    if bytes.len() as u64 != model.expected_size_bytes {
        return Err(ModelCacheError::StoreSizeMismatch {
            filename: model.filename,
            actual_bytes: bytes.len(),
            expected_bytes: model.expected_size_bytes,
        });
    }
    if sha256_hex(bytes) != model.expected_sha256 {
        return Err(ModelCacheError::StoreHashMismatch {
            filename: model.filename,
        });
    }
    Ok(())
}

fn refuse_link_target(target: &Path, model: &VerifiedCachedModel) -> Result<(), ModelCacheError> {
    let Ok(metadata) = std::fs::symlink_metadata(target) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() {
        return Err(ModelCacheError::ReplaceSymlink {
            filename: model.filename,
        });
    }
    #[cfg(windows)]
    if {
        use std::os::windows::fs::FileTypeExt;
        metadata.file_type().is_reparse_point()
    } {
        return Err(ModelCacheError::ReplaceReparsePoint {
            filename: model.filename,
        });
    }
    Ok(())
}

fn stage_and_rename(
    staging: &Path,
    target: &Path,
    model: &VerifiedCachedModel,
    bytes: &[u8],
) -> Result<(), ModelCacheError> {
    let _ = std::fs::remove_file(staging);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staging)
        .map_err(|source| ModelCacheError::StageFailed {
            filename: model.filename,
            source,
        })?;
    file.write_all(bytes)
        .map_err(|source| ModelCacheError::WriteFailed {
            filename: model.filename,
            source,
        })?;
    file.sync_all()
        .map_err(|source| ModelCacheError::PersistFailed {
            filename: model.filename,
            source,
        })?;
    drop(file);
    // Windows refuses to rename over an existing destination, so the previous
    // verified file is removed first; a failure between the two leaves the
    // cache merely absent, which the read boundary already reports as a miss
    // and a consented re-download repairs.
    if std::fs::symlink_metadata(target).is_ok() {
        std::fs::remove_file(target).map_err(|source| ModelCacheError::ReplaceFailed {
            filename: model.filename,
            source,
        })?;
    }
    std::fs::rename(staging, target).map_err(|source| ModelCacheError::InstallFailed {
        filename: model.filename,
        source,
    })?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn validate_cached_model_spec(model: &VerifiedCachedModel) -> Result<(), ModelCacheError> {
    validate_model_filename(model.filename)?;
    validate_sha256(model.expected_sha256)?;
    if model.expected_size_bytes == 0 {
        return Err(ModelCacheError::ZeroExpectedSize);
    }
    Ok(())
}

fn validate_model_filename(filename: &str) -> Result<(), ModelCacheError> {
    let path = Path::new(filename);
    if path.components().count() != 1 {
        return Err(ModelCacheError::FilenameNotSingleSegment);
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(ModelCacheError::FilenameNotNormalSegment);
        }
    }
    Ok(())
}

fn validate_sha256(expected: &str) -> Result<(), ModelCacheError> {
    let is_hex = expected.bytes().all(|byte| byte.is_ascii_hexdigit());
    if expected.len() != 64 || !is_hex {
        return Err(ModelCacheError::InvalidExpectedSha256);
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
        assert!(matches!(error, ModelCacheError::CachedHashMismatch { .. }));
        assert_eq!(
            error.to_string(),
            "Verified local model small-verified-model.bin failed hash validation."
        );
    }

    #[test]
    fn cached_voice_reader_rejects_an_artifact_with_the_wrong_size() {
        let path = isolated_model_path("wrong-size");
        fs::write(&path, b"abc").expect("test artifact must be writable");

        let result = read_verified_cached_model_bytes(&path, &WRONG_SIZE_MODEL);

        fs::remove_file(&path).expect("test artifact must be removed");
        let error = result.expect_err("an artifact with the wrong size must be rejected");
        assert!(matches!(error, ModelCacheError::CachedSizeMismatch { .. }));
        assert_eq!(
            error.to_string(),
            "Verified local model small-verified-model.bin failed size validation."
        );
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
        assert!(matches!(error, ModelCacheError::ChangedWhileRead { .. }));
        assert_eq!(
            error.to_string(),
            "Verified local model small-verified-model.bin changed while it was read."
        );
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
        assert!(matches!(error, ModelCacheError::CachedSymlink { .. }));
        assert_eq!(
            error.to_string(),
            "Verified local model small-verified-model.bin must not be a symlink."
        );
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

        assert!(matches!(error, ModelCacheError::StoreSizeMismatch { .. }));
        assert_eq!(
            error.to_string(),
            "Refusing to store small-verified-model.bin: size 4 does not match the pinned 3 bytes."
        );
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

        assert!(matches!(error, ModelCacheError::StoreHashMismatch { .. }));
        assert_eq!(
            error.to_string(),
            "Refusing to store small-verified-model.bin: SHA-256 does not match the pinned digest."
        );
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
        assert!(matches!(error, ModelCacheError::ReplaceSymlink { .. }));
        assert_eq!(
            error.to_string(),
            "Refusing to replace the symlink named small-verified-model.bin with a verified model."
        );
        assert!(still_a_link, "the symlink must survive the refused write");
    }

    #[test]
    fn cached_model_spec_refusals_keep_their_messages() {
        let cases = [
            (
                VerifiedCachedModel {
                    filename: "nested/model.bin",
                    ..SMALL_VERIFIED_MODEL
                },
                "Model filename must be a single path segment",
            ),
            (
                VerifiedCachedModel {
                    filename: "..",
                    ..SMALL_VERIFIED_MODEL
                },
                "Model filename must be a normal path segment",
            ),
            (
                VerifiedCachedModel {
                    expected_sha256: "not-a-digest",
                    ..SMALL_VERIFIED_MODEL
                },
                "Expected model SHA-256 must be a 64-character hex digest",
            ),
            (
                VerifiedCachedModel {
                    expected_size_bytes: 0,
                    ..SMALL_VERIFIED_MODEL
                },
                "Model expected size must be non-zero",
            ),
        ];
        for (model, message) in cases {
            let error = validate_cached_model_spec(&model)
                .expect_err("a malformed model spec must be refused");
            assert_eq!(error.to_string(), message);
        }
        assert_eq!(
            ModelCacheError::NoDataDirectory.to_string(),
            "Could not determine data directory"
        );
    }

    #[test]
    fn cached_voice_reader_reports_a_missing_artifact_with_its_os_cause() {
        let path = isolated_model_path("missing");
        let _ = fs::remove_file(&path);
        let os_cause = fs::symlink_metadata(&path).expect_err("the artifact must be missing");

        let error = read_verified_cached_model_bytes(&path, &SMALL_VERIFIED_MODEL)
            .expect_err("a missing artifact must be refused");

        assert!(matches!(error, ModelCacheError::NotCached { .. }));
        assert_eq!(
            error.to_string(),
            format!("Verified local model small-verified-model.bin is not cached: {os_cause}")
        );
    }
}
