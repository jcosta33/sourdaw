//! The paths the user actually picked, and nothing else.
//!
//! The native file commands used to admit whole user directories — Documents,
//! Downloads, Desktop, Music — so any renderer script that reached
//! `write_file_bytes` could rewrite a document the musician never offered the
//! app. This registry replaces that blanket with a record of individual
//! grants: one entry per path a user chose in a native dialog, carrying the
//! access that choice implied and nothing wider.
//!
//! Production code has exactly one way to add a grant, [`grant`], and it is
//! reachable only from the desktop shell's main process — the command that
//! calls it is withheld from the renderer's command surface. Nothing else can
//! widen a grant, and no code path adjusts one in place: a second pick of the
//! same path replaces the first outright, so what the registry holds is always
//! the access some dialog the user answered actually implied.
//!
//! The file this persists to is not authority. Every path read back is
//! canonicalised again before it becomes a grant, so a path that has since been
//! deleted, moved, or replaced by a link into somewhere else resolves to what
//! is there now — or is dropped. Paths are stored verbatim and absolute; a glob
//! or a pattern would be a second, weaker matcher for the guard the resolver
//! already performs component-wise.
//!
//! What it is trusted for is the set of paths themselves, and that is why it
//! lives in [`super::private_state_directory`] rather than beside the app's
//! other data. The app data directory is a built-in root, so a document stored
//! there is one `write_file_bytes` away from saying whatever a renderer wants
//! it to say — including a recursive read-write grant on `/`, which the next
//! launch would read back as something the user had chosen. The private
//! directory is refused by the resolver ahead of every root and every grant, so
//! the only writer of this file is the code that owns it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::{Deserialize, Serialize};

use super::{
    canonicalize_through_missing_tail, private_state_directory, AtomicWriteError, FileRefusal,
};
use crate::host::plugin_folder_grants;

const GRANT_FILE_NAME: &str = "file-grants.json";

/// Schema version of the persisted grant document.
///
/// Whole-document: a mismatch means "read nothing". A partially understood
/// grant list would silently narrow what the user already authorized, which
/// reads downstream as a library that lost its folders for no stated reason —
/// but reading it as *wider* than intended is the failure that matters here,
/// and only an all-or-nothing gate rules that out.
const GRANT_SCHEMA_VERSION: u32 = 1;

/// Refuse to parse a grant file larger than dialogs could have written.
const MAX_GRANT_FILE_BYTES: u64 = 1024 * 1024;

/// Refuse a document carrying more grants than a person could have picked.
const MAX_GRANTS: usize = 4096;

/// What a grant permits.
///
/// `Read` is deliberately not a subset expressed by a flag: a writable
/// resolution against a `Read` grant must be refused outright, and an enum is
/// what makes that a match rather than a comparison someone can invert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantMode {
    Read,
    ReadWrite,
}

/// One path the user granted, resolved at the moment they granted it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileGrant {
    /// The fully resolved path. Symlinks are already followed, so the guard
    /// compares two canonical paths and never a spelling against a target.
    pub canonical: PathBuf,
    pub mode: GrantMode,
    /// Whether the grant reaches below `canonical`. A directory pick is
    /// recursive; a file pick admits that one file and not its siblings.
    pub recursive: bool,
}

impl FileGrant {
    /// Whether this grant admits `path` at `mode`.
    ///
    /// `starts_with` is component-wise, so a grant on `/samples/kit` never
    /// admits `/samples/kit-backup` the way a string prefix would.
    fn admits(&self, path: &Path, mode: GrantMode) -> bool {
        if mode == GrantMode::ReadWrite && self.mode == GrantMode::Read {
            return false;
        }
        if self.recursive {
            path.starts_with(&self.canonical)
        } else {
            path == self.canonical
        }
    }
}

#[derive(Debug, Default)]
pub struct GrantRegistry {
    grants: Vec<FileGrant>,
}

impl GrantRegistry {
    fn empty() -> Self {
        Self { grants: Vec::new() }
    }

    /// A registry over an explicit grant set, for tests only.
    ///
    /// Test-gated for the reason the plugin scan policy gates its own: the
    /// grants are the authority, so production code must have exactly one way
    /// to obtain one — a dialog the user answered — and no way to widen it.
    #[cfg(test)]
    pub(crate) fn with_grants(grants: Vec<FileGrant>) -> Self {
        Self { grants }
    }

    pub fn admits(&self, path: &Path, mode: GrantMode) -> bool {
        self.grants.iter().any(|grant| grant.admits(path, mode))
    }

    /// Record a grant, replacing any earlier one for the same canonical path.
    ///
    /// Replacement rather than accumulation, because two grants on one path are
    /// two answers to the same question: the newest dialog is the one the user
    /// just answered.
    fn insert(&mut self, grant: FileGrant) {
        self.grants
            .retain(|existing| existing.canonical != grant.canonical);
        self.grants.push(grant);
    }
}

static REGISTRY: OnceLock<RwLock<GrantRegistry>> = OnceLock::new();

fn registry() -> &'static RwLock<GrantRegistry> {
    REGISTRY.get_or_init(|| RwLock::new(initial_registry()))
}

#[cfg(not(test))]
fn initial_registry() -> GrantRegistry {
    restore_grants()
}

/// Tests never read the developer's own grant file: a unit test that inherited
/// real grants would pass or fail on what happens to be on that machine.
#[cfg(test)]
fn initial_registry() -> GrantRegistry {
    GrantRegistry::empty()
}

fn read_registry() -> RwLockReadGuard<'static, GrantRegistry> {
    registry()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_registry() -> RwLockWriteGuard<'static, GrantRegistry> {
    registry()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether the live registry admits `path` at `mode`.
///
/// No grant admits a write inside a plugin folder. A directory pick may
/// contain one — a home folder holds the per-user plugin folders on every
/// platform — and stays writable everywhere else, but a page writing into a
/// plugin folder would be planting native code the next scan executes.
pub(crate) fn admits(path: &Path, mode: GrantMode) -> bool {
    if mode == GrantMode::ReadWrite
        && plugin_folder_containing(path, &plugin_folder_grants::plugin_code_roots()).is_some()
    {
        return false;
    }
    read_registry().admits(path, mode)
}

/// The plugin folder that `path` is inside of or equal to, if any.
///
/// Compared component by component, so a sibling sharing a name prefix is not
/// inside, and with names compared the way the platform's filesystem compares
/// them. A folder that does not exist yet keeps whatever spelling the renderer
/// sent, and `Plug-Ins/clap` is the CLAP folder on a case-insensitive volume.
pub(crate) fn plugin_folder_containing<'a>(
    path: &Path,
    plugin_folders: &'a [PathBuf],
) -> Option<&'a PathBuf> {
    let path = comparable_components(path);
    plugin_folders
        .iter()
        .find(|folder| path.starts_with(&comparable_components(folder)))
}

fn comparable_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| comparable_name(&component.as_os_str().to_string_lossy()))
        .collect()
}

/// macOS and Windows volumes are case-insensitive by default; folding on a
/// case-sensitive one only refuses more. Windows also drops trailing dots and
/// spaces from a name on its way to the filesystem, and APFS treats every
/// Unicode normalization of a name as the same name.
#[cfg(target_os = "windows")]
fn comparable_name(name: &str) -> String {
    fold_case(name.trim_end_matches(['.', ' ']))
}

#[cfg(target_os = "macos")]
fn comparable_name(name: &str) -> String {
    icu_normalizer::DecomposingNormalizerBorrowed::new_nfd()
        .normalize(&fold_case(name))
        .into_owned()
}

/// Every spelling a case-insensitive volume may treat as one name maps to one
/// string. Neither platform documents its fold table, so this folds at least
/// as far as either could: folding too far only refuses a write into an oddly
/// named sibling folder, while folding too little admits a write into plugin
/// code. `str::to_lowercase` keeps already-lowercase letters such as final
/// sigma or long s apart from the letters they fold into, and an uppercase
/// round trip alone splits `ẞ` from `ß`. Each character therefore goes down,
/// up and down again, so `ς` and `σ` both become `σ`, and `ß`, `ẞ` and `ss`
/// all become `ss`.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn fold_case(name: &str) -> String {
    name.chars()
        .flat_map(char::to_lowercase)
        .flat_map(char::to_uppercase)
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn comparable_name(name: &str) -> String {
    name.to_string()
}

/// Refuse a read-write pick that is inside or equal to a plugin folder, so the
/// user learns at the dialog that it cannot be written to rather than from a
/// later write that fails. A read pick there is harmless and stays allowed.
pub(crate) fn refuse_write_grant_in_plugin_folder(
    canonical: &Path,
    mode: GrantMode,
    plugin_folders: &[PathBuf],
) -> Result<(), FileRefusal> {
    if mode != GrantMode::ReadWrite {
        return Ok(());
    }
    match plugin_folder_containing(canonical, plugin_folders) {
        Some(folder) => Err(FileRefusal::WriteGrantInPluginFolder {
            path: canonical.to_path_buf(),
            folder: folder.clone(),
        }),
        None => Ok(()),
    }
}

/// Record a grant and persist it. The one production route into the registry.
pub(crate) fn grant(grant: FileGrant) {
    let snapshot = {
        let mut registry = write_registry();
        registry.insert(grant);
        persisted_document(&registry)
    };
    // Persistence failure is reported, not fatal: the grant the user just made
    // holds for this session either way, and refusing the dialog because a
    // preferences file could not be written would block the pick itself. The
    // cost is paid at the next launch, where the path restores as ungranted and
    // the user reconnects it.
    if let Err(error) = save_grants(&snapshot) {
        eprintln!("[Filesystem] Could not save the native file grants: {error}");
    }
}

/// Install an explicit grant set for the duration of `body`, for tests only.
///
/// The registry is process-global, so the swap is serialized: two tests holding
/// different grant sets at once would each see the other's.
#[cfg(test)]
pub(crate) fn with_grants_for_test<T>(grants: Vec<FileGrant>, body: impl FnOnce() -> T) -> T {
    use std::sync::Mutex;

    static TEST_LOCK: Mutex<()> = Mutex::new(());
    let _serialized = TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    *write_registry() = GrantRegistry::with_grants(grants);
    let outcome = body();
    *write_registry() = GrantRegistry::empty();
    outcome
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedGrant {
    path: String,
    mode: GrantMode,
    recursive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedGrants {
    schema_version: u32,
    grants: Vec<PersistedGrant>,
}

/// Where the grant document lives: inside the private directory the resolver
/// refuses ahead of every built-in root and every grant.
pub(crate) fn grant_file_location() -> Result<Option<PathBuf>, FileRefusal> {
    Ok(private_state_directory()?.map(|directory| directory.join(GRANT_FILE_NAME)))
}

fn persisted_document(registry: &GrantRegistry) -> PersistedGrants {
    PersistedGrants {
        schema_version: GRANT_SCHEMA_VERSION,
        grants: registry
            .grants
            .iter()
            .map(|grant| PersistedGrant {
                path: grant.canonical.to_string_lossy().into_owned(),
                mode: grant.mode,
                recursive: grant.recursive,
            })
            .collect(),
    }
}

fn save_grants(document: &PersistedGrants) -> Result<(), FileRefusal> {
    let location = grant_file_location()?.ok_or(FileRefusal::NoApplicationDataDirectory)?;
    let directory = location.parent().ok_or(FileRefusal::GrantFileHasNoParent)?;
    fs::create_dir_all(directory).map_err(FileRefusal::GrantDirectoryUncreatable)?;
    let bytes = serde_json::to_vec_pretty(document).map_err(FileRefusal::GrantsUnserializable)?;
    super::replace_file_atomically(&location, |file| {
        use std::io::Write;
        file.write_all(&bytes)
    })
    .map_err(|error| match error {
        AtomicWriteError::File(refusal) => refusal,
        AtomicWriteError::Write(cause) => FileRefusal::GrantsUnwritable(cause),
    })
}

/// Read the grants back, re-resolving each one against the filesystem as it is
/// now.
///
/// A path that no longer resolves is dropped rather than kept as a stale
/// entry: the registry answers "is this path granted", and a grant on a path
/// that does not exist can only ever admit whatever later takes that name.
///
/// The private directory is created first, before any command has had the
/// chance to name a path into it: once it exists, canonicalisation corrects
/// the spelling a caller supplied, so the refusal and the resolution agree on
/// one path rather than on however the caller happened to write it.
#[cfg(not(test))]
fn restore_grants() -> GrantRegistry {
    super::ensure_private_state_directory();

    // A refused runtime scope restores nothing: the only document it could
    // name is the legacy one the scope was selected to keep out of reach.
    let Ok(Some(location)) = grant_file_location() else {
        return GrantRegistry::empty();
    };
    let Some(document) = read_grant_document(&location) else {
        return GrantRegistry::empty();
    };

    GrantRegistry {
        grants: resolve_persisted_grants(document),
    }
}

/// Re-resolve every persisted grant against the filesystem as it is now,
/// dropping the ones that are relative or no longer resolve.
fn resolve_persisted_grants(document: PersistedGrants) -> Vec<FileGrant> {
    document
        .grants
        .into_iter()
        .filter_map(|persisted| {
            let path = PathBuf::from(persisted.path);
            if !path.is_absolute() {
                return None;
            }
            Some(FileGrant {
                canonical: path.canonicalize().ok()?,
                mode: persisted.mode,
                recursive: persisted.recursive,
            })
        })
        .collect()
}

/// The canonical paths the renderer can write through, read fresh from the
/// persisted grant document.
///
/// Read from disk rather than from the live registry because the plugin scan
/// runs in a utility process whose addon instance holds its own registry, which
/// never sees the main process's picks.
///
/// A refused runtime scope is an error rather than an empty set: the caller
/// excludes these paths, and an empty set would exclude nothing.
#[cfg(not(test))]
pub(crate) fn persisted_read_write_paths() -> Result<Vec<PathBuf>, FileRefusal> {
    read_write_paths_under(grant_file_location())
}

/// [`persisted_read_write_paths`] for the grant document `location` names.
fn read_write_paths_under(
    location: Result<Option<PathBuf>, FileRefusal>,
) -> Result<Vec<PathBuf>, FileRefusal> {
    Ok(location?
        .map(|location| read_write_paths_at(&location))
        .unwrap_or_default())
}

/// Tests never read the developer's own grant file; they supply the set
/// through the plugin folder validator's forbidden roots instead.
#[cfg(test)]
pub(crate) fn persisted_read_write_paths() -> Result<Vec<PathBuf>, FileRefusal> {
    Ok(Vec::new())
}

/// The canonical paths of the read-write grants in the document at
/// `location`, resolved the way [`restore_grants`] resolves them.
fn read_write_paths_at(location: &Path) -> Vec<PathBuf> {
    read_grant_document(location)
        .map(resolve_persisted_grants)
        .unwrap_or_default()
        .into_iter()
        .filter(|grant| grant.mode == GrantMode::ReadWrite)
        .map(|grant| grant.canonical)
        .collect()
}

/// Read and validate the grant document at `location`, or nothing.
///
/// Only [`restore_grants`] is gated out of the test binary, because it is the
/// half that reads the real application data directory. The gates this applies
/// — the size bound, the schema version, the row cap — are the reason a forged
/// or corrupt document cannot become authority, so they are compiled and
/// exercised like any other behaviour.
fn read_grant_document(location: &Path) -> Option<PersistedGrants> {
    use std::io::Read;

    // Bounded on the read rather than on a `metadata` call, so a file replaced
    // by a link to a character device cannot report a length of zero and then
    // return bytes until memory runs out.
    let mut bytes = Vec::new();
    fs::File::open(location)
        .ok()?
        .take(MAX_GRANT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_GRANT_FILE_BYTES {
        eprintln!(
            "[Filesystem] Ignoring an oversized native file grant list at {}",
            location.display()
        );
        return None;
    }

    let document: PersistedGrants = serde_json::from_slice(&bytes).ok()?;
    if document.schema_version != GRANT_SCHEMA_VERSION || document.grants.len() > MAX_GRANTS {
        return None;
    }
    Some(document)
}

/// Resolve a path the shell is about to grant.
///
/// A save target does not exist yet, so canonicalisation walks up to the
/// deepest ancestor that does and re-appends what is missing: the resulting
/// path has every symlink in its existing part already followed, which is the
/// same shape the resolver compares against.
pub(crate) fn resolve_grant_target(path: &Path) -> Result<PathBuf, FileRefusal> {
    if !path.is_absolute() {
        return Err(FileRefusal::GrantPathNotAbsolute);
    }
    canonicalize_through_missing_tail(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_grant(path: &str) -> FileGrant {
        FileGrant {
            canonical: PathBuf::from(path),
            mode: GrantMode::Read,
            recursive: false,
        }
    }

    #[test]
    fn a_recursive_grant_admits_descendants_component_wise() {
        let registry = GrantRegistry::with_grants(vec![FileGrant {
            canonical: PathBuf::from("/samples/kit"),
            mode: GrantMode::ReadWrite,
            recursive: true,
        }]);

        assert!(registry.admits(Path::new("/samples/kit"), GrantMode::ReadWrite));
        assert!(registry.admits(Path::new("/samples/kit/snare.wav"), GrantMode::ReadWrite));
        assert!(
            !registry.admits(Path::new("/samples/kit-backup/snare.wav"), GrantMode::Read),
            "a sibling whose name merely shares a prefix is a different directory"
        );
    }

    #[test]
    fn a_refused_scope_reads_no_renderer_writable_grants_rather_than_none() {
        assert_eq!(
            read_write_paths_under(Ok(None)).unwrap(),
            Vec::<PathBuf>::new()
        );
        let refusal = read_write_paths_under(Err(FileRefusal::RuntimeScope("refused".to_string())))
            .unwrap_err();
        assert!(matches!(refusal, FileRefusal::RuntimeScope(_)));
        assert_eq!(refusal.to_string(), "refused");
    }

    #[test]
    fn a_non_recursive_grant_admits_nothing_below_the_file_it_names() {
        // A save target is one file. Were the match a prefix regardless of
        // `recursive`, granting `/samples/loop.wav` would also grant every path
        // spelled beneath it — which is what a directory that later replaced
        // that file would be.
        let registry = GrantRegistry::with_grants(vec![FileGrant {
            canonical: PathBuf::from("/samples/loop.wav"),
            mode: GrantMode::ReadWrite,
            recursive: false,
        }]);

        assert!(registry.admits(Path::new("/samples/loop.wav"), GrantMode::ReadWrite));
        assert!(!registry.admits(Path::new("/samples/loop.wav/nested"), GrantMode::Read));
        assert!(!registry.admits(
            Path::new("/samples/loop.wav/nested/deeper.wav"),
            GrantMode::ReadWrite
        ));
    }

    #[test]
    fn a_read_grant_never_admits_a_writable_resolution() {
        let registry = GrantRegistry::with_grants(vec![read_grant("/samples/loop.wav")]);

        assert!(registry.admits(Path::new("/samples/loop.wav"), GrantMode::Read));
        assert!(!registry.admits(Path::new("/samples/loop.wav"), GrantMode::ReadWrite));
    }

    #[test]
    fn a_second_grant_on_one_path_replaces_the_first_rather_than_stacking() {
        let mut registry = GrantRegistry::with_grants(vec![FileGrant {
            canonical: PathBuf::from("/samples/loop.wav"),
            mode: GrantMode::ReadWrite,
            recursive: false,
        }]);

        registry.insert(read_grant("/samples/loop.wav"));

        assert_eq!(registry.grants.len(), 1);
        assert!(
            !registry.admits(Path::new("/samples/loop.wav"), GrantMode::ReadWrite),
            "the replaced grant must not survive underneath the new one"
        );
    }

    struct TempGrantDir {
        root: PathBuf,
    }

    impl TempGrantDir {
        fn create(test_name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "sourdaw-grant-document-{test_name}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&root).expect("test grant directory should be created");
            Self { root }
        }

        fn write(&self, contents: &[u8]) -> PathBuf {
            let location = self.root.join(GRANT_FILE_NAME);
            fs::write(&location, contents).expect("test grant document should be written");
            location
        }
    }

    impl Drop for TempGrantDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn document_bytes(schema_version: u32, grants: usize) -> Vec<u8> {
        let document = PersistedGrants {
            schema_version,
            grants: (0..grants)
                .map(|index| PersistedGrant {
                    path: format!("/samples/loop-{index}.wav"),
                    mode: GrantMode::Read,
                    recursive: false,
                })
                .collect(),
        };
        serde_json::to_vec(&document).expect("test grant document should serialize")
    }

    #[test]
    fn a_grant_document_larger_than_the_cap_is_not_read() {
        let dir = TempGrantDir::create("oversized");
        let mut bytes = document_bytes(GRANT_SCHEMA_VERSION, 1);
        // Padded with whitespace, which JSON would otherwise accept: what has
        // to refuse this document is the size bound, not a parse failure.
        bytes.resize(MAX_GRANT_FILE_BYTES as usize + 1, b' ');
        let location = dir.write(&bytes);

        assert!(read_grant_document(&location).is_none());
    }

    #[test]
    fn a_grant_document_from_another_schema_version_is_not_read() {
        let dir = TempGrantDir::create("schema");
        let location = dir.write(&document_bytes(GRANT_SCHEMA_VERSION + 1, 1));

        assert!(read_grant_document(&location).is_none());
    }

    #[test]
    fn a_grant_document_carrying_more_grants_than_the_cap_is_not_read() {
        let dir = TempGrantDir::create("count");
        let location = dir.write(&document_bytes(GRANT_SCHEMA_VERSION, MAX_GRANTS + 1));

        assert!(read_grant_document(&location).is_none());
    }

    #[test]
    fn read_write_paths_keep_only_resolvable_read_write_grants() {
        let dir = TempGrantDir::create("read-write-paths");
        let writable = dir.root.join("Project");
        let readable = dir.root.join("Samples");
        fs::create_dir_all(&writable).expect("writable folder should be created");
        fs::create_dir_all(&readable).expect("readable folder should be created");
        let grant = |path: &Path, mode| PersistedGrant {
            path: path.to_string_lossy().into_owned(),
            mode,
            recursive: true,
        };
        let document = PersistedGrants {
            schema_version: GRANT_SCHEMA_VERSION,
            grants: vec![
                grant(&writable, GrantMode::ReadWrite),
                grant(&readable, GrantMode::Read),
                grant(&dir.root.join("Gone"), GrantMode::ReadWrite),
            ],
        };
        let location = dir
            .write(&serde_json::to_vec(&document).expect("test grant document should serialize"));

        assert_eq!(
            read_write_paths_at(&location),
            vec![writable
                .canonicalize()
                .expect("writable folder should resolve")]
        );
    }

    #[test]
    fn a_conforming_grant_document_survives_the_round_trip() {
        let dir = TempGrantDir::create("round-trip");
        let document = persisted_document(&GrantRegistry::with_grants(vec![FileGrant {
            canonical: PathBuf::from("/samples/kit"),
            mode: GrantMode::ReadWrite,
            recursive: true,
        }]));
        let location = dir.write(
            &serde_json::to_vec_pretty(&document).expect("test grant document should serialize"),
        );

        let read = read_grant_document(&location).expect("a conforming document should be read");

        assert_eq!(read.schema_version, GRANT_SCHEMA_VERSION);
        assert_eq!(read.grants.len(), 1);
        assert_eq!(read.grants[0].path, "/samples/kit");
        assert_eq!(read.grants[0].mode, GrantMode::ReadWrite);
        assert!(read.grants[0].recursive);
    }

    #[test]
    fn a_read_write_pick_inside_a_plugin_folder_is_refused() {
        let plugin_folders = vec![PathBuf::from("/plugins/VST3")];

        for (name, path, mode, refused) in [
            (
                "the folder itself",
                "/plugins/VST3",
                GrantMode::ReadWrite,
                true,
            ),
            (
                "inside it",
                "/plugins/VST3/Vendor",
                GrantMode::ReadWrite,
                true,
            ),
            (
                "a bundle in it",
                "/plugins/VST3/Evil.vst3",
                GrantMode::ReadWrite,
                true,
            ),
            ("containing it", "/plugins", GrantMode::ReadWrite, false),
            (
                "a prefix sibling",
                "/plugins/VST3-backup",
                GrantMode::ReadWrite,
                false,
            ),
            (
                "read-only inside it",
                "/plugins/VST3/Vendor",
                GrantMode::Read,
                false,
            ),
            (
                "inside it in another case",
                "/plugins/vst3/Evil.vst3",
                GrantMode::ReadWrite,
                cfg!(any(target_os = "macos", target_os = "windows")),
            ),
        ] {
            let result =
                refuse_write_grant_in_plugin_folder(Path::new(path), mode, &plugin_folders);
            assert_eq!(
                result.is_err(),
                refused,
                "{name}: unexpected result {result:?}"
            );
        }
        let message = refuse_write_grant_in_plugin_folder(
            Path::new("/plugins/VST3/Vendor"),
            GrantMode::ReadWrite,
            &plugin_folders,
        )
        .expect_err("a write pick inside a plugin folder is refused");
        assert!(message.to_string().contains("/plugins/VST3"), "{message}");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn a_plugin_folder_spelled_with_a_trailing_dot_or_space_is_the_same_folder() {
        let plugin_folders = vec![PathBuf::from(r"C:\Plugins\VST3")];
        for spelling in [r"C:\Plugins\VST3.\Evil.vst3", r"C:\Plugins\VST3 \Evil.vst3"] {
            assert!(
                plugin_folder_containing(Path::new(spelling), &plugin_folders).is_some(),
                "{spelling} should be inside the plugin folder"
            );
        }
    }

    #[test]
    fn a_grant_containing_a_platform_plugin_folder_never_admits_writes_into_it() {
        let plugin_folder = plugin_folder_grants::plugin_code_roots()
            .into_iter()
            .next()
            .expect("every supported platform defines a plugin folder");
        let parent = plugin_folder
            .parent()
            .expect("a plugin folder has a parent")
            .to_path_buf();
        let bundle = plugin_folder.join("Evil.clap");
        let folder_name = plugin_folder
            .file_name()
            .expect("a plugin folder has a name")
            .to_string_lossy()
            .into_owned();
        let respelled_name = swap_case(&folder_name);
        assert_ne!(respelled_name, folder_name, "the respelling must differ");
        let respelled_bundle = parent.join(respelled_name).join("Evil.clap");
        let elsewhere = parent.join("sourdaw-not-a-plugin-folder").join("song.wav");

        with_grants_for_test(
            vec![FileGrant {
                canonical: parent,
                mode: GrantMode::ReadWrite,
                recursive: true,
            }],
            || {
                assert!(admits(&elsewhere, GrantMode::ReadWrite));
                assert!(!admits(&bundle, GrantMode::ReadWrite));
                assert!(!admits(&plugin_folder, GrantMode::ReadWrite));
                if cfg!(any(target_os = "macos", target_os = "windows")) {
                    assert!(!admits(&respelled_bundle, GrantMode::ReadWrite));
                }
                assert!(admits(&bundle, GrantMode::Read));
            },
        );
    }

    fn swap_case(name: &str) -> String {
        name.chars()
            .flat_map(|character| {
                if character.is_uppercase() {
                    character.to_lowercase().collect::<Vec<_>>()
                } else {
                    character.to_uppercase().collect::<Vec<_>>()
                }
            })
            .collect()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_plugin_folder_spelled_in_another_unicode_normalization_is_the_same_folder() {
        let folders = vec![PathBuf::from("/Users/u/Plugins/Caf\u{e9}")];

        for inside in [
            "/Users/u/Plugins/Cafe\u{301}/Evil.clap",
            "/Users/u/Plugins/CAFE\u{301}/Evil.clap",
            "/Users/u/Plugins/CAF\u{c9}/Evil.clap",
        ] {
            assert!(
                plugin_folder_containing(Path::new(inside), &folders).is_some(),
                "{inside:?} is inside the plugin folder"
            );
        }
        assert!(
            plugin_folder_containing(Path::new("/Users/u/Plugins/Cafe/Evil.clap"), &folders)
                .is_none(),
            "a name without the accent is another folder"
        );
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn a_plugin_folder_name_matches_every_spelling_the_volume_folds_together() {
        let folders = vec![
            PathBuf::from("/Users/u/Plugins/\u{391}\u{3a3}"),
            PathBuf::from("/Users/u/Plugins/Stra\u{df}e"),
            PathBuf::from("/Users/u/Plugins/Long\u{17f}"),
        ];

        for inside in [
            "/Users/u/Plugins/\u{3b1}\u{3c3}/Evil.clap",
            "/Users/u/Plugins/\u{3b1}\u{3c2}/Evil.clap",
            "/Users/u/Plugins/STRASSE/Evil.clap",
            "/Users/u/Plugins/Stra\u{1e9e}e/Evil.clap",
            "/Users/u/Plugins/LONGS/Evil.clap",
        ] {
            assert!(
                plugin_folder_containing(Path::new(inside), &folders).is_some(),
                "{inside:?} is inside a plugin folder"
            );
        }
        assert!(
            plugin_folder_containing(Path::new("/Users/u/Plugins/\u{3b1}/Evil.clap"), &folders)
                .is_none(),
            "a shorter name is another folder"
        );
    }

    #[test]
    fn a_stored_plugin_folder_grant_refuses_writes_through_admits_available_or_not() {
        use crate::host::plugin_folder_grants::test_support::{store_grants, TempTree};

        let tree = TempTree::create("admits-stored-grant");
        let available = tree.dir("Music/Plugins/Available");
        let unplugged = tree.path("Music/Plugins/Caf\u{e9}");
        store_grants(&tree.store(), &[available.clone(), unplugged.clone()]);
        let song = tree.path("Music/song.wav");

        plugin_folder_grants::with_store_location_for_test(&tree.store(), || {
            with_grants_for_test(
                vec![FileGrant {
                    canonical: tree.root.clone(),
                    mode: GrantMode::ReadWrite,
                    recursive: true,
                }],
                || {
                    assert!(admits(&song, GrantMode::ReadWrite));
                    assert!(!admits(&available.join("Evil.clap"), GrantMode::ReadWrite));
                    assert!(!admits(&unplugged.join("Evil.clap"), GrantMode::ReadWrite));
                    assert!(admits(&available.join("Evil.clap"), GrantMode::Read));
                    if cfg!(target_os = "macos") {
                        let decomposed = tree.path("Music/Plugins/Cafe\u{301}/Evil.clap");
                        assert!(!admits(&decomposed, GrantMode::ReadWrite));
                    }
                },
            );
        });
    }
}
