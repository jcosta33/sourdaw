//! Plugin folders the user picked, beyond the platform's own.
//!
//! A grant is born only from a folder the user chose in a native folder dialog
//! the desktop shell's main process opened: the shell hands the dialog's result
//! straight to [`grant_at`] through a command withheld from the renderer. A
//! path a page sends over IPC is never a grant, so a renderer cannot widen what
//! the scan and the loader will execute by asking.
//!
//! The file this persists to is not authority. Every stored grant re-runs the
//! pick validator against the filesystem as it is now, each time a policy is
//! built, and has to resolve to exactly the path that was granted. A folder that
//! has since gone missing, been replaced by a symbolic link, or come to resolve
//! somewhere else is reported unavailable and grants nothing; it stays in the
//! file because an unplugged drive comes back, and only an explicit revoke
//! removes it.
//!
//! The file lives in the private native state directory, which no file command resolves
//! into and no project or collaborator writes, so its only writer is this module.
//! It is read fresh on every policy construction rather than cached: the scan
//! runs in a separate utility process with its own addon instance, and it has to
//! see a grant the main process wrote a moment ago.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::commands::filesystem::{
    built_in_roots, canonicalize_through_missing_tail, grant_registry, replace_file_atomically,
};
use crate::host::plugin_scan_policy::{
    default_plugin_scan_roots, normalize_path_lexically, path_has_symlink_component,
};

const GRANT_FILE_NAME: &str = "plugin-folder-grants.json";

/// Schema version of the persisted grant document.
///
/// Whole-document: a mismatch reads as no grants at all. Reading a partially
/// understood list as wider than the user made it is the failure that matters,
/// and only an all-or-nothing gate rules it out.
const GRANT_SCHEMA_VERSION: u32 = 1;

/// Refuse to parse a document larger than folder picks could have written.
const MAX_GRANT_FILE_BYTES: u64 = 1024 * 1024;

/// The most plugin folders Sourdaw remembers.
pub(crate) const MAX_PLUGIN_FOLDER_GRANTS: usize = 64;

/// Why a folder cannot be, or no longer is, a plugin folder.
///
/// `Display` is the text a musician reads, both as the refusal of a pick and as
/// the reason a granted folder is listed unavailable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PluginFolderRefusal {
    Empty,
    Relative(PathBuf),
    Missing(PathBuf),
    Unreadable { path: PathBuf, cause: String },
    NotADirectory(PathBuf),
    SymbolicLink(PathBuf),
    FilesystemRoot(PathBuf),
    HomeOrAncestor(PathBuf),
    OverlapsDefaultFolder { path: PathBuf, default: PathBuf },
    OverlapsAppStorage { path: PathBuf, storage: PathBuf },
    OverlapsWritableFileGrant { path: PathBuf, grant: PathBuf },
    InsideGrant { path: PathBuf, grant: PathBuf },
    TooMany,
    ResolvesElsewhere { granted: PathBuf, now: PathBuf },
    StoreUnavailable(String),
}

impl fmt::Display for PluginFolderRefusal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(formatter, "No folder was chosen."),
            Self::Relative(path) => write!(
                formatter,
                "The plugin folder path must be absolute: {}.",
                path.display()
            ),
            Self::Missing(path) => write!(
                formatter,
                "The folder {} could not be found. If it is on a drive that is not connected, connect it and try again.",
                path.display()
            ),
            Self::Unreadable { path, cause } => write!(
                formatter,
                "The folder {} could not be read: {cause}.",
                path.display()
            ),
            Self::NotADirectory(path) => {
                write!(formatter, "{} is a file, not a folder.", path.display())
            }
            Self::SymbolicLink(path) => write!(
                formatter,
                "The folder {} is, or is inside, a symbolic link. Choose the folder the link points to instead.",
                path.display()
            ),
            Self::FilesystemRoot(path) => write!(
                formatter,
                "{} is the top of a drive. Choose the folder your plugins are in instead.",
                path.display()
            ),
            Self::HomeOrAncestor(path) => write!(
                formatter,
                "{} is your home folder or contains it. Choose the folder your plugins are in instead.",
                path.display()
            ),
            Self::OverlapsDefaultFolder { path, default } => write!(
                formatter,
                "{} is inside or contains the default plugin folder {}, which Sourdaw already scans.",
                path.display(),
                default.display()
            ),
            Self::OverlapsAppStorage { path, storage } => write!(
                formatter,
                "{} is inside or contains {}, where Sourdaw keeps its own files. A plugin folder cannot overlap them.",
                path.display(),
                storage.display()
            ),
            Self::OverlapsWritableFileGrant { path, grant } => write!(
                formatter,
                "{} is inside or contains {}, a folder Sourdaw can write project files into, so plugins there could be replaced. Choose a folder only plugin installers write to.",
                path.display(),
                grant.display()
            ),
            Self::InsideGrant { path, grant } => write!(
                formatter,
                "{} is inside {}, which is already a plugin folder.",
                path.display(),
                grant.display()
            ),
            Self::TooMany => write!(
                formatter,
                "Sourdaw can remember at most {MAX_PLUGIN_FOLDER_GRANTS} plugin folders. Remove one before adding another."
            ),
            Self::ResolvesElsewhere { granted, now } => write!(
                formatter,
                "The folder {} now leads to {}. Add it again if that is where your plugins are.",
                granted.display(),
                now.display()
            ),
            Self::StoreUnavailable(cause) => {
                write!(formatter, "The plugin folder list could not be saved: {cause}.")
            }
        }
    }
}

impl std::error::Error for PluginFolderRefusal {}

/// The places a plugin folder may not overlap, as data.
///
/// Data rather than lookups so tests supply temporary stand-ins: the real home
/// directory, plugin folders and application storage are the developer's own,
/// and no test may depend on or write into them.
#[derive(Debug, Clone, Default)]
pub(crate) struct ForbiddenRoots {
    /// The user's home directory. A pick that is it or contains it would hand
    /// the scan every file the user owns.
    pub(crate) home: Option<PathBuf>,
    /// The platform default plugin folders. A grant inside one is redundant and
    /// one containing one would duplicate its rank; keeping them disjoint keeps
    /// the default folders' priority order the only one that applies to them.
    pub(crate) default_roots: Vec<PathBuf>,
    /// The storage the renderer may write without any user pick. A plugin
    /// folder overlapping it would let a page plant native code that the scan
    /// and the loader then execute.
    pub(crate) app_storage_roots: Vec<PathBuf>,
    /// The paths the user granted the renderer read-write access to through
    /// a file or folder pick. A plugin folder overlapping one would let a page
    /// replace a plugin with its own code, whichever pick came first.
    pub(crate) renderer_writable_grants: Vec<PathBuf>,
}

impl ForbiddenRoots {
    /// The real forbidden set, resolved the way picks are: canonical where the
    /// folder exists, through its deepest existing ancestor where it does not.
    ///
    /// A refused runtime scope is an error, never an empty storage set: without
    /// the scope no folder can be shown to lie outside the app's own storage.
    pub(crate) fn production() -> Result<Self, String> {
        Ok(Self {
            home: dirs::home_dir().map(|home| fs::canonicalize(&home).unwrap_or(home)),
            default_roots: default_plugin_scan_roots()
                .iter()
                .map(|root| resolve_forbidden_root(root))
                .collect(),
            app_storage_roots: built_in_roots()?
                .iter()
                .map(|root| resolve_forbidden_root(root))
                .collect(),
            renderer_writable_grants: grant_registry::persisted_read_write_paths()?,
        })
    }
}

fn resolve_forbidden_root(root: &Path) -> PathBuf {
    canonicalize_through_missing_tail(root).unwrap_or_else(|_| normalize_path_lexically(root))
}

/// One stored grant and whether it grants anything right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GrantStatus {
    pub(crate) path: PathBuf,
    pub(crate) unavailable: Option<PluginFolderRefusal>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedGrant {
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedGrants {
    schema_version: u32,
    grants: Vec<PersistedGrant>,
}

/// Serializes read-modify-write of the grant file within this process. The
/// main process is the only writer; other processes only read.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Where the production grant document lives.
///
/// A refused runtime scope has no store, so it grants no folder and every
/// grant or revoke is refused.
#[cfg(not(test))]
pub(crate) fn production_store_location() -> Option<PathBuf> {
    let directory = crate::commands::filesystem::private_state_directory()
        .ok()
        .flatten()?;
    Some(directory.join(GRANT_FILE_NAME))
}

/// Tests never touch the developer's own grant file: a unit test that inherited
/// real grants would pass or fail on what happens to be on that machine. A test
/// that needs a store installs a temporary one for its own thread with
/// [`with_store_location_for_test`].
#[cfg(test)]
pub(crate) fn production_store_location() -> Option<PathBuf> {
    TEST_STORE_LOCATION.with(|location| location.borrow().clone())
}

#[cfg(test)]
thread_local! {
    static TEST_STORE_LOCATION: std::cell::RefCell<Option<PathBuf>> =
        const { std::cell::RefCell::new(None) };
}

/// Point [`production_store_location`] at `location` on this thread for the
/// duration of `body`. Thread-local, so tests running alongside keep seeing no
/// store.
#[cfg(test)]
pub(crate) fn with_store_location_for_test<T>(location: &Path, body: impl FnOnce() -> T) -> T {
    struct Restore(Option<PathBuf>);
    impl Drop for Restore {
        fn drop(&mut self) {
            TEST_STORE_LOCATION.with(|location| *location.borrow_mut() = self.0.take());
        }
    }

    let previous =
        TEST_STORE_LOCATION.with(|current| current.replace(Some(location.to_path_buf())));
    let _restore = Restore(previous);
    body()
}

/// Every folder the plugin scan loads code from: the platform's plugin folders,
/// resolved the way picks are, and every stored plugin folder grant.
///
/// A renderer write into any of them plants native code the next scan runs.
/// A stored grant counts even while it is unavailable: once its folder is back
/// it is authority again, with whatever was written there in the meantime.
pub(crate) fn plugin_code_roots() -> Vec<PathBuf> {
    plugin_code_roots_at(production_store_location().as_deref())
}

/// [`plugin_code_roots`] over the grant store at `store`, if any.
pub(crate) fn plugin_code_roots_at(store: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = default_plugin_scan_roots()
        .iter()
        .map(|root| resolve_forbidden_root(root))
        .collect();
    if let Some(location) = store {
        roots.extend(read_grants(location));
    }
    roots
}

/// Validate a folder the user picked, answering with its canonical path.
///
/// The checks every grant re-runs on every use; [`grant_at`] adds the ones
/// against the grants already stored.
pub(crate) fn validate_folder(
    requested: &Path,
    forbidden: &ForbiddenRoots,
) -> Result<PathBuf, PluginFolderRefusal> {
    if requested.as_os_str().is_empty() {
        return Err(PluginFolderRefusal::Empty);
    }
    if !requested.is_absolute() {
        return Err(PluginFolderRefusal::Relative(requested.to_path_buf()));
    }
    // Every component, not only the last: a link anywhere along the path lets
    // whoever controls it point the grant somewhere else later. On Windows
    // `is_symlink` also reports junctions, so they are refused here too.
    match path_has_symlink_component(requested) {
        Ok(true) => return Err(PluginFolderRefusal::SymbolicLink(requested.to_path_buf())),
        Ok(false) => {}
        Err(cause) => {
            return Err(PluginFolderRefusal::Unreadable {
                path: requested.to_path_buf(),
                cause,
            })
        }
    }
    let canonical = fs::canonicalize(requested).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            PluginFolderRefusal::Missing(requested.to_path_buf())
        } else {
            PluginFolderRefusal::Unreadable {
                path: requested.to_path_buf(),
                cause: error.to_string(),
            }
        }
    })?;
    if !canonical.is_dir() {
        return Err(PluginFolderRefusal::NotADirectory(canonical));
    }
    if canonical.parent().is_none() {
        return Err(PluginFolderRefusal::FilesystemRoot(canonical));
    }
    if forbidden
        .home
        .as_ref()
        .is_some_and(|home| home.starts_with(&canonical))
    {
        return Err(PluginFolderRefusal::HomeOrAncestor(canonical));
    }
    if let Some(default) = first_overlap(&canonical, &forbidden.default_roots) {
        return Err(PluginFolderRefusal::OverlapsDefaultFolder {
            path: canonical,
            default,
        });
    }
    if let Some(storage) = first_overlap(&canonical, &forbidden.app_storage_roots) {
        return Err(PluginFolderRefusal::OverlapsAppStorage {
            path: canonical,
            storage,
        });
    }
    if let Some(grant) = first_overlap(&canonical, &forbidden.renderer_writable_grants) {
        return Err(PluginFolderRefusal::OverlapsWritableFileGrant {
            path: canonical,
            grant,
        });
    }
    Ok(canonical)
}

/// The first root that `path` is inside of or contains. `starts_with` is
/// component-wise, so a sibling sharing a name prefix is not an overlap.
fn first_overlap(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    roots
        .iter()
        .find(|root| path.starts_with(root) || root.starts_with(path))
        .cloned()
}

/// Whether a stored grant grants anything right now: it must pass the pick
/// validator again and still resolve to exactly the path that was granted.
fn revalidate(granted: &Path, forbidden: &ForbiddenRoots) -> Result<(), PluginFolderRefusal> {
    let now = validate_folder(granted, forbidden)?;
    if now != granted {
        return Err(PluginFolderRefusal::ResolvesElsewhere {
            granted: granted.to_path_buf(),
            now,
        });
    }
    Ok(())
}

/// Record a folder the user picked in a native folder dialog, answering with
/// the canonical path that was granted.
///
/// Picking a granted folder again changes nothing. A pick inside a granted
/// folder is refused, naming it; a pick containing granted folders replaces
/// them, so stored grants never overlap one another.
pub(crate) fn grant_at(
    location: &Path,
    forbidden: &ForbiddenRoots,
    requested: &Path,
) -> Result<PathBuf, PluginFolderRefusal> {
    let canonical = validate_folder(requested, forbidden)?;
    let _serialized = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut grants = read_grants(location);

    if grants.contains(&canonical) {
        return Ok(canonical);
    }
    if let Some(grant) = grants.iter().find(|grant| canonical.starts_with(grant)) {
        return Err(PluginFolderRefusal::InsideGrant {
            path: canonical,
            grant: grant.clone(),
        });
    }
    grants.retain(|grant| !grant.starts_with(&canonical));
    if grants.len() >= MAX_PLUGIN_FOLDER_GRANTS {
        return Err(PluginFolderRefusal::TooMany);
    }
    grants.push(canonical.clone());
    save_grants(location, &grants)?;
    Ok(canonical)
}

/// Remove the stored grant for exactly `path`. Revoking a folder that is not
/// granted succeeds: revocation only ever narrows authority.
pub(crate) fn revoke_at(location: &Path, path: &Path) -> Result<(), PluginFolderRefusal> {
    let _serialized = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut grants = read_grants(location);
    let before = grants.len();
    grants.retain(|grant| grant != path);
    if grants.len() == before {
        return Ok(());
    }
    save_grants(location, &grants)
}

/// Every stored grant, in grant order, with the reason it grants nothing now.
pub(crate) fn list_at(location: &Path, forbidden: &ForbiddenRoots) -> Vec<GrantStatus> {
    read_grants(location)
        .into_iter()
        .map(|path| GrantStatus {
            unavailable: revalidate(&path, forbidden).err(),
            path,
        })
        .collect()
}

/// The stored grants that are authority right now, in grant order.
pub(crate) fn valid_grants_at(location: &Path, forbidden: &ForbiddenRoots) -> Vec<PathBuf> {
    list_at(location, forbidden)
        .into_iter()
        .filter(|status| status.unavailable.is_none())
        .map(|status| status.path)
        .collect()
}

/// The stored paths, or none when the document is missing, oversized, corrupt,
/// from another schema version or over the cap.
fn read_grants(location: &Path) -> Vec<PathBuf> {
    read_grant_document(location)
        .map(|document| {
            document
                .grants
                .into_iter()
                .map(|grant| PathBuf::from(grant.path))
                .collect()
        })
        .unwrap_or_default()
}

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
            "[Plugin] Ignoring an oversized plugin folder grant list at {}",
            location.display()
        );
        return None;
    }
    let document: PersistedGrants = serde_json::from_slice(&bytes).ok()?;
    if document.schema_version != GRANT_SCHEMA_VERSION
        || document.grants.len() > MAX_PLUGIN_FOLDER_GRANTS
    {
        return None;
    }
    Some(document)
}

fn save_grants(location: &Path, grants: &[PathBuf]) -> Result<(), PluginFolderRefusal> {
    let directory = location.parent().ok_or_else(|| {
        PluginFolderRefusal::StoreUnavailable("the grant file has no parent directory".to_string())
    })?;
    fs::create_dir_all(directory)
        .map_err(|error| PluginFolderRefusal::StoreUnavailable(error.to_string()))?;
    let document = PersistedGrants {
        schema_version: GRANT_SCHEMA_VERSION,
        grants: grants
            .iter()
            .map(|grant| PersistedGrant {
                path: grant.to_string_lossy().into_owned(),
            })
            .collect(),
    };
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| PluginFolderRefusal::StoreUnavailable(error.to_string()))?;
    replace_file_atomically(location, |file| {
        use std::io::Write;
        file.write_all(&bytes)
            .map_err(|error| format!("Failed to write the plugin folder grants: {error}"))
    })
    .map_err(PluginFolderRefusal::StoreUnavailable)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};

    /// Store `grants` at `location` as the grant command would, without the
    /// folder checks, so a test can hold a grant whose folder is missing.
    pub(crate) fn store_grants(location: &Path, grants: &[PathBuf]) {
        super::save_grants(location, grants).expect("grant store should be written");
    }

    /// A temporary directory, canonicalized so no test path carries the
    /// platform's own temp-directory symlink (`/var` on macOS).
    pub(crate) struct TempTree {
        pub(crate) root: PathBuf,
    }

    impl TempTree {
        pub(crate) fn create(test_name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "sourdaw-plugin-folder-{test_name}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).expect("temp tree should be created");
            let root = std::fs::canonicalize(&root).expect("temp tree should resolve");
            Self { root }
        }

        pub(crate) fn dir(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            std::fs::create_dir_all(&path).expect("temp folder should be created");
            path
        }

        pub(crate) fn store(&self) -> PathBuf {
            self.root.join("private").join(super::GRANT_FILE_NAME)
        }

        pub(crate) fn path(&self, relative: &str) -> PathBuf {
            self.root.join(relative)
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    pub(crate) fn write(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("parent should be created");
        }
        std::fs::write(path, bytes).expect("file should be written");
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{write, TempTree};
    use super::*;

    fn forbidden_in(tree: &TempTree) -> ForbiddenRoots {
        ForbiddenRoots {
            home: Some(tree.dir("home/musician")),
            default_roots: vec![tree.dir("defaults/VST3")],
            app_storage_roots: vec![tree.dir("app-storage/data")],
            renderer_writable_grants: Vec::new(),
        }
    }

    /// One refusal case: its label, the candidate folder, and the refusal it must produce.
    type RefusalCase = (&'static str, PathBuf, fn(&PluginFolderRefusal) -> bool);

    #[test]
    fn plugin_folder_validator_refuses_what_cannot_be_a_plugin_folder() {
        let tree = TempTree::create("refusals");
        let forbidden = forbidden_in(&tree);
        let file = tree.path("plugin.clap");
        write(&file, b"not a folder");

        let cases: Vec<RefusalCase> = vec![
            ("empty", PathBuf::new(), |refusal| {
                matches!(refusal, PluginFolderRefusal::Empty)
            }),
            ("relative", PathBuf::from("plugins/VST3"), |refusal| {
                matches!(refusal, PluginFolderRefusal::Relative(_))
            }),
            ("missing", tree.path("nowhere"), |refusal| {
                matches!(refusal, PluginFolderRefusal::Missing(_))
            }),
            ("a file", file.clone(), |refusal| {
                matches!(refusal, PluginFolderRefusal::NotADirectory(_))
            }),
            ("filesystem root", PathBuf::from("/"), |refusal| {
                matches!(refusal, PluginFolderRefusal::FilesystemRoot(_))
            }),
            ("home", tree.path("home/musician"), |refusal| {
                matches!(refusal, PluginFolderRefusal::HomeOrAncestor(_))
            }),
            ("ancestor of home", tree.path("home"), |refusal| {
                matches!(refusal, PluginFolderRefusal::HomeOrAncestor(_))
            }),
            (
                "inside a default root",
                tree.dir("defaults/VST3/Vendor"),
                |refusal| matches!(refusal, PluginFolderRefusal::OverlapsDefaultFolder { .. }),
            ),
            (
                "containing a default root",
                tree.path("defaults"),
                |refusal| matches!(refusal, PluginFolderRefusal::OverlapsDefaultFolder { .. }),
            ),
            (
                "inside renderer-writable storage",
                tree.dir("app-storage/data/plugins"),
                |refusal| matches!(refusal, PluginFolderRefusal::OverlapsAppStorage { .. }),
            ),
            (
                "containing renderer-writable storage",
                tree.path("app-storage"),
                |refusal| matches!(refusal, PluginFolderRefusal::OverlapsAppStorage { .. }),
            ),
        ];

        for (name, requested, expected) in cases {
            let result = validate_folder(&requested, &forbidden);
            assert!(
                result.as_ref().is_err_and(expected),
                "{name}: unexpected result {result:?}"
            );
        }
    }

    #[test]
    fn plugin_folder_grant_overlapping_a_read_write_file_grant_is_refused() {
        let tree = TempTree::create("writable-grant");
        let project = tree.dir("Projects/Song");
        let forbidden = ForbiddenRoots {
            renderer_writable_grants: vec![project.clone()],
            ..forbidden_in(&tree)
        };

        for (name, requested) in [
            ("equal to", project.clone()),
            ("inside", tree.dir("Projects/Song/Plugins")),
            ("containing", tree.path("Projects")),
        ] {
            let result = grant_at(&tree.store(), &forbidden, &requested);
            assert!(
                matches!(
                    &result,
                    Err(PluginFolderRefusal::OverlapsWritableFileGrant { grant, .. })
                        if *grant == project
                ),
                "{name}: unexpected result {result:?}"
            );
        }
        assert!(list_at(&tree.store(), &forbidden).is_empty());
    }

    #[test]
    fn plugin_folder_grant_beside_a_read_write_file_grant_or_over_a_read_only_one_is_accepted() {
        let tree = TempTree::create("writable-grant-control");
        let sibling = tree.dir("Projects/Song-plugins");
        let read_only = tree.dir("Samples");
        // Only read-write grants reach `renderer_writable_grants`; a read-only
        // grant on `Samples` is absent from it by construction.
        let forbidden = ForbiddenRoots {
            renderer_writable_grants: vec![tree.dir("Projects/Song")],
            ..forbidden_in(&tree)
        };

        for folder in [&sibling, &read_only] {
            assert_eq!(
                grant_at(&tree.store(), &forbidden, folder).as_ref(),
                Ok(folder)
            );
        }
    }

    #[test]
    fn plugin_folder_stored_grant_overlapping_a_later_read_write_file_grant_is_not_authority() {
        let tree = TempTree::create("writable-grant-later");
        let folder = tree.dir("Plugins");
        let before = forbidden_in(&tree);
        grant_at(&tree.store(), &before, &folder).expect("pick is valid");
        assert_eq!(
            valid_grants_at(&tree.store(), &before),
            vec![folder.clone()]
        );

        let after = ForbiddenRoots {
            renderer_writable_grants: vec![folder.clone()],
            ..forbidden_in(&tree)
        };

        let listed = list_at(&tree.store(), &after);
        assert_eq!(listed.len(), 1);
        assert!(
            matches!(
                listed[0].unavailable,
                Some(PluginFolderRefusal::OverlapsWritableFileGrant { .. })
            ),
            "unexpected status {:?}",
            listed[0]
        );
        assert!(valid_grants_at(&tree.store(), &after).is_empty());
    }

    #[test]
    fn plugin_folder_validator_accepts_a_sibling_sharing_a_name_prefix() {
        let tree = TempTree::create("prefix-sibling");
        let forbidden = forbidden_in(&tree);
        let sibling = tree.dir("defaults/VST3-extra");

        assert_eq!(validate_folder(&sibling, &forbidden), Ok(sibling));
    }

    #[cfg(unix)]
    #[test]
    fn plugin_folder_validator_refuses_a_symlink_component() {
        let tree = TempTree::create("symlink-pick");
        let forbidden = forbidden_in(&tree);
        let real = tree.dir("real");
        tree.dir("real/VST3");
        let link = tree.path("link");
        std::os::unix::fs::symlink(&real, &link).expect("symlink should be created");

        for requested in [link.clone(), link.join("VST3")] {
            let result = validate_folder(&requested, &forbidden);
            assert!(
                matches!(result, Err(PluginFolderRefusal::SymbolicLink(_))),
                "{}: unexpected result {result:?}",
                requested.display()
            );
        }
    }

    #[test]
    fn plugin_folder_grant_stores_the_canonical_path_and_survives_a_fresh_read() {
        let tree = TempTree::create("persist");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Plugins");
        let spelled = folder.join("Vendor").join("..");
        tree.dir("Plugins/Vendor");

        let granted = grant_at(&tree.store(), &forbidden, &spelled).expect("pick is valid");

        assert_eq!(granted, folder);
        assert_eq!(valid_grants_at(&tree.store(), &forbidden), vec![folder]);
    }

    #[test]
    fn plugin_folder_grant_of_an_already_granted_folder_changes_nothing() {
        let tree = TempTree::create("equal");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Plugins");
        grant_at(&tree.store(), &forbidden, &folder).expect("first pick is valid");
        let written = fs::read(tree.store()).expect("store should exist");

        assert_eq!(grant_at(&tree.store(), &forbidden, &folder), Ok(folder));
        assert_eq!(fs::read(tree.store()).expect("store should exist"), written);
    }

    #[test]
    fn plugin_folder_grant_inside_an_existing_grant_is_refused_naming_it() {
        let tree = TempTree::create("inside");
        let forbidden = forbidden_in(&tree);
        let outer = tree.dir("Plugins");
        let inner = tree.dir("Plugins/Vendor");
        grant_at(&tree.store(), &forbidden, &outer).expect("outer pick is valid");

        assert_eq!(
            grant_at(&tree.store(), &forbidden, &inner),
            Err(PluginFolderRefusal::InsideGrant {
                path: inner,
                grant: outer.clone(),
            })
        );
        assert_eq!(valid_grants_at(&tree.store(), &forbidden), vec![outer]);
    }

    #[test]
    fn plugin_folder_grant_containing_existing_grants_replaces_them() {
        let tree = TempTree::create("containing");
        let forbidden = forbidden_in(&tree);
        let first = tree.dir("Plugins/A");
        let second = tree.dir("Plugins/B");
        let unrelated = tree.dir("Elsewhere");
        let outer = tree.path("Plugins");
        for folder in [&first, &unrelated, &second] {
            grant_at(&tree.store(), &forbidden, folder).expect("pick is valid");
        }

        grant_at(&tree.store(), &forbidden, &outer).expect("outer pick is valid");

        assert_eq!(
            valid_grants_at(&tree.store(), &forbidden),
            vec![unrelated, outer]
        );
    }

    #[test]
    fn plugin_folder_grant_over_the_cap_is_refused() {
        let tree = TempTree::create("cap");
        let forbidden = forbidden_in(&tree);
        for index in 0..MAX_PLUGIN_FOLDER_GRANTS {
            let folder = tree.dir(&format!("Plugins/{index}"));
            grant_at(&tree.store(), &forbidden, &folder).expect("pick under the cap");
        }
        let one_more = tree.dir("Plugins-extra");

        assert_eq!(
            grant_at(&tree.store(), &forbidden, &one_more),
            Err(PluginFolderRefusal::TooMany)
        );
        assert_eq!(
            valid_grants_at(&tree.store(), &forbidden).len(),
            MAX_PLUGIN_FOLDER_GRANTS
        );
    }

    #[test]
    fn plugin_folder_revoke_removes_only_the_exact_entry_and_absent_is_ok() {
        let tree = TempTree::create("revoke");
        let forbidden = forbidden_in(&tree);
        let kept = tree.dir("Kept");
        let revoked = tree.dir("Revoked");
        grant_at(&tree.store(), &forbidden, &kept).expect("pick is valid");
        grant_at(&tree.store(), &forbidden, &revoked).expect("pick is valid");

        revoke_at(&tree.store(), &revoked).expect("revoke succeeds");
        revoke_at(&tree.store(), &tree.path("Never-granted")).expect("absent revoke succeeds");

        assert_eq!(valid_grants_at(&tree.store(), &forbidden), vec![kept]);
    }

    #[test]
    fn plugin_folder_missing_folder_lists_unavailable_and_stays_stored() {
        let tree = TempTree::create("missing");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Drive/Plugins");
        grant_at(&tree.store(), &forbidden, &folder).expect("pick is valid");
        fs::rename(tree.path("Drive"), tree.path("Unplugged")).expect("drive goes away");

        let listed = list_at(&tree.store(), &forbidden);
        assert_eq!(listed.len(), 1);
        assert!(matches!(
            listed[0].unavailable,
            Some(PluginFolderRefusal::Missing(_))
        ));
        assert!(valid_grants_at(&tree.store(), &forbidden).is_empty());

        fs::rename(tree.path("Unplugged"), tree.path("Drive")).expect("drive comes back");
        assert_eq!(valid_grants_at(&tree.store(), &forbidden), vec![folder]);
    }

    #[cfg(unix)]
    #[test]
    fn plugin_folder_swapped_for_a_symlink_lists_unavailable_with_the_symlink_reason() {
        let tree = TempTree::create("swap");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Plugins");
        let outside = tree.dir("Outside");
        grant_at(&tree.store(), &forbidden, &folder).expect("pick is valid");
        fs::rename(&folder, tree.path("Plugins-moved")).expect("folder moved away");
        std::os::unix::fs::symlink(&outside, &folder).expect("symlink planted");

        let listed = list_at(&tree.store(), &forbidden);

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, folder);
        assert!(
            matches!(
                listed[0].unavailable,
                Some(PluginFolderRefusal::SymbolicLink(_))
            ),
            "unexpected status {:?}",
            listed[0]
        );
        assert!(listed[0]
            .unavailable
            .as_ref()
            .is_some_and(|reason| reason.to_string().contains("symbolic link")));
        assert!(valid_grants_at(&tree.store(), &forbidden).is_empty());
    }

    #[test]
    fn plugin_folder_store_that_is_corrupt_oversized_or_another_schema_reads_as_no_grants() {
        let tree = TempTree::create("store-gates");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Plugins");
        let document = |schema_version: u32, count: usize| {
            serde_json::to_vec(&PersistedGrants {
                schema_version,
                grants: (0..count)
                    .map(|_| PersistedGrant {
                        path: folder.to_string_lossy().into_owned(),
                    })
                    .collect(),
            })
            .expect("document should serialize")
        };
        let mut oversized = document(GRANT_SCHEMA_VERSION, 1);
        oversized.resize(MAX_GRANT_FILE_BYTES as usize + 1, b' ');

        write(&tree.store(), &document(GRANT_SCHEMA_VERSION, 1));
        assert_eq!(
            valid_grants_at(&tree.store(), &forbidden),
            vec![folder.clone()],
            "the conforming control document must read"
        );

        for (name, bytes) in [
            ("corrupt", b"{ not json".to_vec()),
            ("oversized", oversized),
            ("another schema", document(GRANT_SCHEMA_VERSION + 1, 1)),
            (
                "over the cap",
                document(GRANT_SCHEMA_VERSION, MAX_PLUGIN_FOLDER_GRANTS + 1),
            ),
        ] {
            write(&tree.store(), &bytes);
            assert!(
                list_at(&tree.store(), &forbidden).is_empty(),
                "{name}: store should read as no grants"
            );
        }
    }

    #[test]
    fn plugin_folder_stored_grant_overlapping_storage_now_is_not_authority() {
        let tree = TempTree::create("forged");
        let forbidden = forbidden_in(&tree);
        let storage_child = tree.dir("app-storage/data/plugins");
        write(
            &tree.store(),
            &serde_json::to_vec(&PersistedGrants {
                schema_version: GRANT_SCHEMA_VERSION,
                grants: vec![PersistedGrant {
                    path: storage_child.to_string_lossy().into_owned(),
                }],
            })
            .expect("document should serialize"),
        );

        assert!(valid_grants_at(&tree.store(), &forbidden).is_empty());
    }

    #[test]
    fn a_stored_grant_that_resolves_to_another_path_grants_nothing() {
        let tree = TempTree::create("resolves-elsewhere");
        let forbidden = forbidden_in(&tree);
        let folder = tree.dir("Plugins/Vendor");
        let spelled_elsewhere = folder.join("..").join("Vendor");
        save_grants(&tree.store(), std::slice::from_ref(&spelled_elsewhere))
            .expect("store should be written");

        let statuses = list_at(&tree.store(), &forbidden);
        assert!(
            matches!(
                statuses.as_slice(),
                [GrantStatus {
                    unavailable: Some(PluginFolderRefusal::ResolvesElsewhere { now, .. }),
                    ..
                }] if *now == folder
            ),
            "unexpected statuses {statuses:?}"
        );
        assert!(valid_grants_at(&tree.store(), &forbidden).is_empty());
    }

    #[test]
    fn plugin_code_roots_include_every_stored_grant_available_or_not() {
        let tree = TempTree::create("code-roots");
        let available = tree.dir("Plugins/Available");
        let unplugged = tree.path("Unplugged/Plugins");
        save_grants(&tree.store(), &[available.clone(), unplugged.clone()])
            .expect("store should be written");

        let roots = plugin_code_roots_at(Some(&tree.store()));
        assert!(roots.contains(&available), "{roots:?}");
        assert!(roots.contains(&unplugged), "{roots:?}");
        assert!(!plugin_code_roots_at(None).contains(&available));
    }
}
