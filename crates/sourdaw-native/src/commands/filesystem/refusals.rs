//! The native filesystem refusals whose message text TypeScript matches.
//!
//! The napi edge sends every command error as text, so this enum makes the Rust
//! side of that contract compile-checked: each refusal the sample library
//! classifies (`restoreLibrary.ts`) is a variant, `Display` carries the exact
//! text it matches, and callers convert with `to_string()` at the existing edge.
//! Rewording a message needs the matching TypeScript change (ADR 0059).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileRefusal {
    /// The path did not canonicalise: it is missing or unreadable.
    NotFoundOrNotAccessible,
    /// The path resolved to something that is not a directory.
    NotADirectory,
    /// The path is inside no built-in root and no grant. Also the refusal for
    /// the private state directory, deliberately indistinguishable.
    OutsideAllowedRoots,
    /// A directory entry could not be read; `cause` is the OS error text.
    EntryUnreadable { cause: String },
    /// A directory entry's metadata could not be read; `cause` is the OS error text.
    MetadataUnreadable { cause: String },
    /// Any other refusal on the same routes, which no caller classifies.
    Message(String),
}

impl fmt::Display for FileRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFoundOrNotAccessible => f.write_str("File not found or not accessible"),
            Self::NotADirectory => f.write_str("Not a directory"),
            Self::OutsideAllowedRoots => f.write_str("Path is outside allowed native file roots"),
            Self::EntryUnreadable { cause } => write!(f, "Failed to read entry: {cause}"),
            Self::MetadataUnreadable { cause } => write!(f, "Failed to read metadata: {cause}"),
            Self::Message(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for FileRefusal {}

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
        let text = FileRefusal::EntryUnreadable {
            cause: "Operation not permitted".to_string(),
        }
        .to_string();
        assert_eq!(text, "Failed to read entry: Operation not permitted");
        assert!(text.starts_with("Failed to read entry:"));
    }

    #[test]
    fn metadata_unreadable_keeps_the_prefix_and_os_cause_shape() {
        let text = FileRefusal::MetadataUnreadable {
            cause: "Operation not permitted".to_string(),
        }
        .to_string();
        assert_eq!(text, "Failed to read metadata: Operation not permitted");
        assert!(text.starts_with("Failed to read metadata:"));
    }

    #[test]
    fn message_passes_its_text_through() {
        assert_eq!(
            FileRefusal::Message("Export temporary paths are native-only".to_string()).to_string(),
            "Export temporary paths are native-only"
        );
    }
}
