//! The native filesystem errors.
//!
//! The napi edge sends every command error as text, so these enums make the
//! Rust side of that contract compile-checked: each failure is a variant, and
//! `Display` carries the exact text the command used to return. Callers convert
//! with `to_string()` at the command body. The sample library classifies some
//! of these texts (`restoreLibrary.ts`), so rewording one needs the matching
//! TypeScript change (ADR 0059).

use std::fmt;
use std::io;
use std::path::PathBuf;

use crate::host::runtime_scope::RuntimeScopeRefusal;

use super::MAX_FILE_IPC_BYTES;
use super::MAX_RENDERER_PATH_BYTES;

#[derive(Debug)]
pub enum FileRefusal {
    /// The path did not canonicalise: it is missing or unreadable.
    NotFoundOrNotAccessible,
    /// The path resolved to something that is not a directory.
    NotADirectory,
    /// The path is inside no built-in root and no grant. Also the refusal for
    /// the private state directory, deliberately indistinguishable.
    OutsideAllowedRoots,
    /// A directory entry could not be read.
    EntryUnreadable(io::Error),
    /// A directory entry's metadata could not be read.
    MetadataUnreadable(io::Error),
    NotAFile,
    IsADirectory,
    NoParentDirectory,
    NoExistingParentDirectory,
    ExtensionMismatch {
        label: String,
        extension: String,
    },
    EmptyRendererPath,
    RendererPathTooLong,
    PayloadTooLarge {
        command: String,
    },
    ParentDirectoryTraversal,
    EscapesFilesystemRoot,
    /// Staging names belong only to the export registry.
    ExportStagingPath,
    /// The runtime scope refused to name a directory.
    RuntimeScope(RuntimeScopeRefusal),
    NoFileName,
    TemporaryFileUncreatable(io::Error),
    TemporaryFileUnsynced(io::Error),
    FinishedFileUnmovable(io::Error),
    FileUnreadable(io::Error),
    FileMetadataUnreadable(io::Error),
    DirectoryUnreadable(io::Error),
    DirectoryUncreatable(io::Error),
    FileUnwritable(io::Error),
    UnknownGrantMode {
        mode: String,
    },
    GrantPathNotAbsolute,
    WriteGrantInPluginFolder {
        path: PathBuf,
        folder: PathBuf,
    },
    NoApplicationDataDirectory,
    GrantFileHasNoParent,
    GrantDirectoryUncreatable(io::Error),
    GrantsUnserializable(serde_json::Error),
    GrantsUnwritable(io::Error),
}

impl fmt::Display for FileRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFoundOrNotAccessible => f.write_str("File not found or not accessible"),
            Self::NotADirectory => f.write_str("Not a directory"),
            Self::OutsideAllowedRoots => f.write_str("Path is outside allowed native file roots"),
            Self::EntryUnreadable(cause) => write!(f, "Failed to read entry: {cause}"),
            Self::MetadataUnreadable(cause) => write!(f, "Failed to read metadata: {cause}"),
            Self::NotAFile => f.write_str("Path is not a file"),
            Self::IsADirectory => f.write_str("Path is a directory"),
            Self::NoParentDirectory => f.write_str("Path must include a parent directory"),
            Self::NoExistingParentDirectory => {
                f.write_str("No existing parent directory for path")
            }
            Self::ExtensionMismatch { label, extension } => {
                write!(f, "{label} path must use .{extension} extension")
            }
            Self::EmptyRendererPath => f.write_str("Renderer path must not be empty"),
            Self::RendererPathTooLong => write!(
                f,
                "Native file path exceeds {MAX_RENDERER_PATH_BYTES}-byte IPC limit"
            ),
            Self::PayloadTooLarge { command } => write!(
                f,
                "{command} payload exceeds {MAX_FILE_IPC_BYTES}-byte IPC limit"
            ),
            Self::ParentDirectoryTraversal => {
                f.write_str("Renderer path must not contain parent-directory traversal")
            }
            Self::EscapesFilesystemRoot => {
                f.write_str("Renderer path must not escape the filesystem root")
            }
            Self::ExportStagingPath => f.write_str("Export temporary paths are native-only"),
            Self::RuntimeScope(refusal) => refusal.fmt(f),
            Self::NoFileName => f.write_str("Atomic write error: path has no file name"),
            Self::TemporaryFileUncreatable(cause) => {
                write!(f, "Failed to create temporary file: {cause}")
            }
            Self::TemporaryFileUnsynced(cause) => {
                write!(f, "Failed to sync temporary file: {cause}")
            }
            Self::FinishedFileUnmovable(cause) => {
                write!(f, "Failed to move finished file into place: {cause}")
            }
            Self::FileUnreadable(cause) => write!(f, "Failed to read file: {cause}"),
            Self::FileMetadataUnreadable(cause) => {
                write!(f, "Failed to read file metadata: {cause}")
            }
            Self::DirectoryUnreadable(cause) => write!(f, "Failed to read directory: {cause}"),
            Self::DirectoryUncreatable(cause) => write!(f, "Failed to create directory: {cause}"),
            Self::FileUnwritable(cause) => write!(f, "Failed to write file: {cause}"),
            Self::UnknownGrantMode { mode } => write!(f, "Unknown file grant mode: {mode}"),
            Self::GrantPathNotAbsolute => f.write_str("Granted path must be absolute"),
            Self::WriteGrantInPluginFolder { path, folder } => write!(
                f,
                "{} is inside the plugin folder {}, and Sourdaw never writes into plugin folders. Choose another folder.",
                path.display(),
                folder.display()
            ),
            Self::NoApplicationDataDirectory => f.write_str("No application data directory"),
            Self::GrantFileHasNoParent => f.write_str("Grant file has no parent directory"),
            Self::GrantDirectoryUncreatable(cause) => {
                write!(f, "Failed to create the grant directory: {cause}")
            }
            Self::GrantsUnserializable(cause) => {
                write!(f, "Failed to serialize the grants: {cause}")
            }
            Self::GrantsUnwritable(cause) => write!(f, "Failed to write the grants: {cause}"),
        }
    }
}

impl std::error::Error for FileRefusal {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::RuntimeScope(refusal) => Some(refusal),
            _ => None,
        }
    }
}

/// A failed atomic replace: either the replace itself refused, or the caller's
/// write step failed with its own error.
#[derive(Debug)]
pub(crate) enum AtomicWriteError<WriteError> {
    File(FileRefusal),
    Write(WriteError),
}

impl<WriteError: fmt::Display> fmt::Display for AtomicWriteError<WriteError> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::File(refusal) => refusal.fmt(f),
            Self::Write(error) => error.fmt(f),
        }
    }
}

impl<WriteError: fmt::Debug + fmt::Display> std::error::Error for AtomicWriteError<WriteError> {}

impl<WriteError> From<FileRefusal> for AtomicWriteError<WriteError> {
    fn from(refusal: FileRefusal) -> Self {
        Self::File(refusal)
    }
}

/// The write step of an atomic WAV replace.
#[derive(Debug)]
pub(crate) enum WavWriteError<SampleError> {
    Header(hound::Error),
    Samples(SampleError),
    Finalize(hound::Error),
}

impl<SampleError: fmt::Display> fmt::Display for WavWriteError<SampleError> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Header(cause) => write!(f, "WAV write error: {cause}"),
            Self::Samples(error) => error.fmt(f),
            Self::Finalize(cause) => write!(f, "Finalize error: {cause}"),
        }
    }
}

impl<SampleError: fmt::Debug + fmt::Display> std::error::Error for WavWriteError<SampleError> {}

/// The streaming export registry's errors.
#[cfg(any(feature = "napi-addon", test))]
#[derive(Debug)]
pub(crate) enum ExportFileError {
    /// A path, parent-directory, or manifest-write refusal on the shared route.
    File(FileRefusal),
    FileUninspectable(io::Error),
    NotARegularFile,
    #[cfg(windows)]
    ReparsePoint,
    #[cfg(windows)]
    IdentityBufferSize(std::num::TryFromIntError),
    #[cfg(windows)]
    Unidentifiable(io::Error),
    #[cfg(not(any(unix, windows)))]
    IdentityUnavailable,
    OwnedByAnotherHost,
    RecordsUnserializable(serde_json::Error),
    StateIsSymlink,
    StateUninspectable(io::Error),
    InvalidRecoveryToken,
    TargetHasNoParent,
    InvalidTargetName,
    TargetParentUnresolvable(io::Error),
    InvalidRecoveryRecord,
    RecordNotARegularFile,
    TemporaryFileUninspectable(io::Error),
    NoRecordedIdentity,
    TemporaryIdentityChanged,
    RetainedIdentityChanged,
    IdentityUnprovenAfterRestart,
    StateUncreatable(io::Error),
    StateDirectoryUnresolvable(io::Error),
    #[cfg(unix)]
    StatePermissionsUnset(io::Error),
    LockUnopenable(io::Error),
    KeyUnwritable(io::Error),
    KeyUnreadable(io::Error),
    InvalidKey,
    KeyUncreatable(io::Error),
    ManifestUnreadable(io::Error),
    ManifestTooLarge,
    InvalidManifest(serde_json::Error),
    UnauthenticatedManifest,
    LegacyManifest,
    RecoveryUnremovable(io::Error),
    ManifestUnserializable(serde_json::Error),
    AlreadyStaged,
    UnknownTransaction,
    TemporaryFileUncreatable(io::Error),
    StaleTransaction,
    ChunkTooLarge,
    AlreadySealed,
    NoWritableFile,
    AppendFailed(io::Error),
    TemporaryFileMissing,
    SealFailed(io::Error),
    InvalidCommitBatch,
    NotSealed,
    InvalidPath,
    TargetIdentityChanged,
    CommitFailed(io::Error),
    AbortUnremovable(io::Error),
    /// Every abort failure, in token order.
    Aborted(Vec<ExportFileError>),
}

#[cfg(any(feature = "napi-addon", test))]
impl fmt::Display for ExportFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::File(refusal) => refusal.fmt(f),
            Self::FileUninspectable(cause) => write!(f, "Cannot inspect export file: {cause}"),
            Self::NotARegularFile => f.write_str("Export temporary file is not a regular file"),
            #[cfg(windows)]
            Self::ReparsePoint => f.write_str("Export temporary file is a reparse point"),
            #[cfg(windows)]
            Self::IdentityBufferSize(cause) => cause.fmt(f),
            #[cfg(windows)]
            Self::Unidentifiable(cause) => write!(f, "Cannot identify export file: {cause}"),
            #[cfg(not(any(unix, windows)))]
            Self::IdentityUnavailable => {
                f.write_str("Created export file identity is unavailable on this platform")
            }
            Self::OwnedByAnotherHost => {
                f.write_str("Streaming export is owned by another live native host")
            }
            Self::RecordsUnserializable(cause) => cause.fmt(f),
            Self::StateIsSymlink => f.write_str("Export state or temporary path is a symlink"),
            Self::StateUninspectable(cause) => write!(f, "Cannot inspect export state: {cause}"),
            Self::InvalidRecoveryToken => f.write_str("Invalid export recovery token"),
            Self::TargetHasNoParent => f.write_str("Export target has no parent"),
            Self::InvalidTargetName => f.write_str("Invalid export target name"),
            Self::TargetParentUnresolvable(cause) => cause.fmt(f),
            Self::InvalidRecoveryRecord => f.write_str("Invalid export recovery record"),
            Self::RecordNotARegularFile => {
                f.write_str("Export recovery record does not name a regular temporary file")
            }
            Self::TemporaryFileUninspectable(cause) => {
                write!(f, "Cannot inspect export temporary file: {cause}")
            }
            Self::NoRecordedIdentity => {
                f.write_str("Export temporary file has no recorded identity")
            }
            Self::TemporaryIdentityChanged => f.write_str("Export temporary file identity changed"),
            Self::RetainedIdentityChanged => f.write_str("Retained export file identity changed"),
            Self::IdentityUnprovenAfterRestart => {
                f.write_str("Cannot prove export temporary file identity after restart")
            }
            Self::StateUncreatable(cause) => write!(f, "Cannot create export state: {cause}"),
            Self::StateDirectoryUnresolvable(cause) => cause.fmt(f),
            #[cfg(unix)]
            Self::StatePermissionsUnset(cause) => cause.fmt(f),
            Self::LockUnopenable(cause) => write!(f, "Cannot open export state lock: {cause}"),
            Self::KeyUnwritable(cause) => cause.fmt(f),
            Self::KeyUnreadable(cause) => cause.fmt(f),
            Self::InvalidKey => f.write_str("Invalid export authentication key"),
            Self::KeyUncreatable(cause) => {
                write!(f, "Cannot create export authentication key: {cause}")
            }
            Self::ManifestUnreadable(cause) => cause.fmt(f),
            Self::ManifestTooLarge => f.write_str("Export recovery manifest is too large"),
            Self::InvalidManifest(cause) => write!(f, "Invalid export recovery manifest: {cause}"),
            Self::UnauthenticatedManifest => {
                f.write_str("Unauthenticated export recovery manifest")
            }
            Self::LegacyManifest => f.write_str(
                "Legacy export recovery has no created-file identity; entries were preserved",
            ),
            Self::RecoveryUnremovable(cause) => {
                write!(f, "Cannot recover export temporary file: {cause}")
            }
            Self::ManifestUnserializable(cause) => cause.fmt(f),
            Self::AlreadyStaged => f.write_str("Export target is already staged"),
            Self::UnknownTransaction => f.write_str("Unknown export transaction"),
            Self::TemporaryFileUncreatable(cause) => {
                write!(f, "Cannot create export temporary file: {cause}")
            }
            Self::StaleTransaction => f.write_str("Stale export transaction"),
            Self::ChunkTooLarge => f.write_str("Export chunk exceeds 1 MiB"),
            Self::AlreadySealed => f.write_str("Export transaction is already sealed"),
            Self::NoWritableFile => f.write_str("Export transaction has no writable file"),
            Self::AppendFailed(cause) => write!(f, "Cannot append export file: {cause}"),
            Self::TemporaryFileMissing => f.write_str("Export temporary file is missing"),
            Self::SealFailed(cause) => write!(f, "Cannot seal export file: {cause}"),
            Self::InvalidCommitBatch => f.write_str("Invalid export commit batch"),
            Self::NotSealed => f.write_str("Export transaction is not sealed"),
            Self::InvalidPath => f.write_str("Invalid export path"),
            Self::TargetIdentityChanged => f.write_str("Export target identity changed"),
            Self::CommitFailed(cause) => write!(f, "Cannot commit export file: {cause}"),
            Self::AbortUnremovable(cause) => {
                write!(f, "Cannot abort export temporary file: {cause}")
            }
            Self::Aborted(errors) => {
                for (index, error) in errors.iter().enumerate() {
                    if index > 0 {
                        f.write_str("; ")?;
                    }
                    error.fmt(f)?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(any(feature = "napi-addon", test))]
impl std::error::Error for ExportFileError {}

#[cfg(any(feature = "napi-addon", test))]
impl From<FileRefusal> for ExportFileError {
    fn from(refusal: FileRefusal) -> Self {
        Self::File(refusal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_displays_the_text_restore_library_matches() {
        assert_eq!(
            FileRefusal::NotFoundOrNotAccessible.to_string(),
            "File not found or not accessible"
        );
    }

    #[test]
    fn not_a_directory_displays_the_text_restore_library_matches() {
        assert_eq!(FileRefusal::NotADirectory.to_string(), "Not a directory");
    }

    #[test]
    fn outside_roots_displays_the_text_restore_library_matches() {
        assert_eq!(
            FileRefusal::OutsideAllowedRoots.to_string(),
            "Path is outside allowed native file roots"
        );
    }

    #[test]
    fn entry_unreadable_keeps_the_prefix_and_os_cause_shape() {
        let text =
            FileRefusal::EntryUnreadable(io::Error::other("Operation not permitted")).to_string();
        assert_eq!(text, "Failed to read entry: Operation not permitted");
        assert!(text.starts_with("Failed to read entry:"));
    }

    #[test]
    fn metadata_unreadable_keeps_the_prefix_and_os_cause_shape() {
        let text = FileRefusal::MetadataUnreadable(io::Error::other("Operation not permitted"))
            .to_string();
        assert_eq!(text, "Failed to read metadata: Operation not permitted");
        assert!(text.starts_with("Failed to read metadata:"));
    }

    #[test]
    fn runtime_scope_passes_its_text_through() {
        assert_eq!(
            FileRefusal::RuntimeScope(RuntimeScopeRefusal::SelectedDifferently).to_string(),
            "Native runtime scope was already selected differently"
        );
    }

    #[test]
    fn interpolating_refusals_keep_their_text() {
        assert_eq!(
            FileRefusal::RendererPathTooLong.to_string(),
            "Native file path exceeds 4096-byte IPC limit"
        );
        assert_eq!(
            FileRefusal::PayloadTooLarge {
                command: "read_file_bytes".to_string()
            }
            .to_string(),
            "read_file_bytes payload exceeds 1073741824-byte IPC limit"
        );
        assert_eq!(
            FileRefusal::ExtensionMismatch {
                label: "Collaboration bundle".to_string(),
                extension: "sdaw".to_string()
            }
            .to_string(),
            "Collaboration bundle path must use .sdaw extension"
        );
        assert_eq!(
            FileRefusal::UnknownGrantMode {
                mode: "write".to_string()
            }
            .to_string(),
            "Unknown file grant mode: write"
        );
        assert_eq!(
            FileRefusal::WriteGrantInPluginFolder {
                path: PathBuf::from("/plugins/clap/out.wav"),
                folder: PathBuf::from("/plugins/clap"),
            }
            .to_string(),
            "/plugins/clap/out.wav is inside the plugin folder /plugins/clap, and Sourdaw never writes into plugin folders. Choose another folder."
        );
    }

    #[test]
    fn atomic_and_wav_write_errors_display_their_inner_text() {
        let refused: AtomicWriteError<String> = FileRefusal::NoFileName.into();
        assert_eq!(
            refused.to_string(),
            "Atomic write error: path has no file name"
        );
        assert_eq!(
            AtomicWriteError::<String>::Write("injected".to_string()).to_string(),
            "injected"
        );
        assert_eq!(
            WavWriteError::<String>::Samples("sample failure".to_string()).to_string(),
            "sample failure"
        );
    }

    #[test]
    fn aborted_joins_every_failure_in_order() {
        assert_eq!(
            ExportFileError::Aborted(vec![
                ExportFileError::TemporaryIdentityChanged,
                ExportFileError::AbortUnremovable(io::Error::other("busy")),
            ])
            .to_string(),
            "Export temporary file identity changed; Cannot abort export temporary file: busy"
        );
    }
}
