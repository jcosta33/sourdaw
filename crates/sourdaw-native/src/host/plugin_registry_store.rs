//! The plugin scan registry's file.
//!
//! Scanning is expensive, and its result is the table plugin activation
//! resolves against. Holding that table in memory only meant every relaunch
//! started with an empty registry, so reopening a saved project failed every
//! plugin it contained until the user ran a scan by hand (#2271). This module
//! is the durable half: written after a scan, read back before the first
//! plugin-touching command.
//!
//! The file is not authority. Nothing in it widens what may be loaded — every
//! entry is re-checked against [`PluginScanPolicy`] on the way in, so a
//! hand-edited file can still only describe plugins the live policy would
//! authorize anyway, and the path it names is re-checked for absoluteness and
//! symlink components at that moment rather than trusted from when it was
//! written.
//!
//! A file this build cannot parse, or one carrying a different schema version,
//! is treated as absent: the registry stays empty and a scan refills it, which
//! is exactly the state a first run is in. Reading half of it is never an
//! option — a partially populated lookup table is indistinguishable, from the
//! user's side, from the missing-plugin bug this module exists to fix.
//!
//! Registry I/O is control-side only. Every entry point here touches the
//! filesystem and must never be reached from the audio callback.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::state::PluginRegistryEntry;

/// Schema version of the persisted registry document.
///
/// Whole-document, not per entry, and deliberately so: a mismatch has to mean
/// "read nothing". A per-entry version would license a partial load, which is
/// the half-populated registry that reports "plugin not found" for a plugin the
/// user has already scanned.
const SCAN_REGISTRY_SCHEMA_VERSION: u32 = 1;

const REGISTRY_DIRECTORY: &str = "com.sourdaw.app";
const REGISTRY_FILE_NAME: &str = "plugin-registry.json";
const REGISTRY_TEMPORARY_FILE_NAME: &str = "plugin-registry.json.tmp";

/// Refuse to parse a registry file larger than a scan could have written.
/// A bounded scan yields at most a few hundred entries of a few hundred bytes;
/// anything past this is not this file's content and is not worth the parse.
const MAX_REGISTRY_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// The persisted registry document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedScanRegistry {
    pub schema_version: u32,
    /// The lookup table verbatim: one row per key activation resolves, which is
    /// both the path hash and the CLAP descriptor id of every scanned CLAP
    /// plugin. Ordered, so a rewrite that changed nothing produces the same
    /// bytes.
    pub entries: BTreeMap<String, PersistedPluginEntry>,
}

/// One persisted registry row: what the scan learned, plus the fingerprint of
/// the file it learned it from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedPluginEntry {
    pub path: String,
    /// `ScannedPlugin::id` — the hash of the path this plugin was scanned at.
    pub stable_id: String,
    /// The CLAP descriptor's own id. Empty for formats that carry none.
    pub clap_id: String,
    pub format: String,
    pub name: String,
    pub category: String,
    /// Size of the plugin file, in bytes, when it was scanned.
    pub file_size_bytes: u64,
    /// Modification time of the plugin file when it was scanned, in
    /// milliseconds since the unix epoch.
    ///
    /// Millisecond resolution is the fingerprint's floor: a replacement written
    /// within the same millisecond *and* at exactly the same size reads as
    /// unchanged. Every real plugin update moves one of the two.
    pub file_modified_ms: u64,
}

impl PersistedPluginEntry {
    fn as_registry_entry(&self) -> PluginRegistryEntry {
        PluginRegistryEntry {
            path: self.path.clone(),
            stable_id: self.stable_id.clone(),
            clap_id: self.clap_id.clone(),
            format: self.format.clone(),
            name: self.name.clone(),
            category: self.category.clone(),
        }
    }
}

#[derive(Debug, Default)]
struct StoredRegistry {
    /// Whether the file has been read this process. Read-once: hydration is a
    /// boot step, and re-reading it later would resurrect entries a completed
    /// scan has since removed.
    hydrated: bool,
    /// Every row the file carried, including rows hydration refused as stale.
    /// A refused row is still the plugin's last known location, which is what
    /// an activation miss needs in order to say where the plugin used to be.
    entries: BTreeMap<String, PersistedPluginEntry>,
}

/// The registry file, and what this process has read from it.
pub struct PluginRegistryStore {
    /// `None` for a store with no file behind it: every operation becomes a
    /// no-op and the registry lives and dies with the process.
    location: Option<PathBuf>,
    stored: Mutex<StoredRegistry>,
}

impl PluginRegistryStore {
    /// The registry file in the platform's app-data directory.
    pub fn at_default_location() -> Self {
        Self::new(default_registry_location())
    }

    /// A store over an explicit file.
    pub fn at(location: PathBuf) -> Self {
        Self::new(Some(location))
    }

    /// A store with no file: nothing is read, nothing is written.
    pub fn in_memory_only() -> Self {
        Self::new(None)
    }

    fn new(location: Option<PathBuf>) -> Self {
        Self {
            location,
            stored: Mutex::new(StoredRegistry::default()),
        }
    }

    /// Read the registry file into `plugin_registry`, once per process.
    ///
    /// Additive: an entry already in the registry — put there by a scan this
    /// session — is never displaced by the file's older view of it.
    ///
    /// Entries are admitted only if the policy still authorizes their path and
    /// the file on disk is byte-for-byte the size and age the scan recorded.
    /// Anything else is a plugin that has been updated, replaced or removed
    /// since, and resolving it would hand activation a path whose contents no
    /// longer match the descriptor id recorded next to it.
    pub fn hydrate_into(
        &self,
        plugin_registry: &Mutex<HashMap<String, PluginRegistryEntry>>,
        scan_policy: &PluginScanPolicy,
    ) {
        let mut stored = self.lock_stored();
        if stored.hydrated {
            return;
        }
        stored.hydrated = true;

        let Some(location) = self.location.as_deref() else {
            return;
        };
        let Some(document) = read_registry_document(location) else {
            return;
        };
        stored.entries = document.entries;

        let unchanged_entries: Vec<(String, PluginRegistryEntry)> = stored
            .entries
            .iter()
            .filter(|(_, entry)| entry_is_still_the_scanned_file(entry, scan_policy))
            .map(|(key, entry)| (key.clone(), entry.as_registry_entry()))
            .collect();
        if unchanged_entries.is_empty() {
            return;
        }

        // Recovered rather than refused, for the reason the scan publisher
        // recovers: the registry is a derived lookup table, so a panic
        // elsewhere leaves nothing here a reader must distrust.
        let mut registry = plugin_registry
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (key, entry) in unchanged_entries {
            registry.entry(key).or_insert(entry);
        }
    }

    /// Where the file last saw the plugin behind this registry key, whether or
    /// not hydration was willing to resolve it.
    pub fn last_known_entry(&self, plugin_id: &str) -> Option<PersistedPluginEntry> {
        self.lock_stored().entries.get(plugin_id).cloned()
    }

    /// Write the registry to the file, replacing what was there.
    ///
    /// A registry entry whose file cannot be fingerprinted right now is left
    /// out: without a fingerprint the next hydration has nothing to invalidate
    /// against, and an entry that can never be proven stale is worse than an
    /// entry that is missing.
    ///
    /// Failure is reported and swallowed. A scan that found plugins has already
    /// succeeded for this session, and turning a full disk into a failed scan
    /// would take away the working half too.
    pub fn persist(&self, plugin_registry: &HashMap<String, PluginRegistryEntry>) {
        let Some(location) = self.location.as_deref() else {
            return;
        };

        let mut fingerprints: HashMap<&str, Option<(u64, u64)>> = HashMap::new();
        let mut entries = BTreeMap::new();
        for (key, entry) in plugin_registry {
            let fingerprint = *fingerprints
                .entry(entry.path.as_str())
                .or_insert_with(|| file_fingerprint(Path::new(&entry.path)));
            let Some((file_size_bytes, file_modified_ms)) = fingerprint else {
                continue;
            };
            entries.insert(
                key.clone(),
                PersistedPluginEntry {
                    path: entry.path.clone(),
                    stable_id: entry.stable_id.clone(),
                    clap_id: entry.clap_id.clone(),
                    format: entry.format.clone(),
                    name: entry.name.clone(),
                    category: entry.category.clone(),
                    file_size_bytes,
                    file_modified_ms,
                },
            );
        }

        let document = PersistedScanRegistry {
            schema_version: SCAN_REGISTRY_SCHEMA_VERSION,
            entries,
        };
        match write_registry_document(location, &document) {
            Ok(()) => self.lock_stored().entries = document.entries,
            Err(error) => eprintln!("[Plugin] Could not save the plugin scan registry: {error}"),
        }
    }

    fn lock_stored(&self) -> std::sync::MutexGuard<'_, StoredRegistry> {
        self.stored
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn default_registry_location() -> Option<PathBuf> {
    Some(
        dirs::data_dir()?
            .join(REGISTRY_DIRECTORY)
            .join(REGISTRY_FILE_NAME),
    )
}

/// Whether the file this entry describes is still the file that was scanned.
fn entry_is_still_the_scanned_file(
    entry: &PersistedPluginEntry,
    scan_policy: &PluginScanPolicy,
) -> bool {
    let path = Path::new(&entry.path);
    if !path.is_absolute() {
        return false;
    }
    if scan_policy.authorize_scan_root(path).is_err() {
        return false;
    }

    file_fingerprint(path).is_some_and(|(size, modified)| {
        size == entry.file_size_bytes && modified == entry.file_modified_ms
    })
}

fn file_fingerprint(path: &Path) -> Option<(u64, u64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some((metadata.len(), u64::try_from(modified).ok()?))
}

fn read_registry_document(location: &Path) -> Option<PersistedScanRegistry> {
    let metadata = fs::metadata(location).ok()?;
    if metadata.len() > MAX_REGISTRY_FILE_BYTES {
        eprintln!(
            "[Plugin] Ignoring an oversized plugin scan registry at {}",
            location.display()
        );
        return None;
    }

    let bytes = fs::read(location).ok()?;
    let document: PersistedScanRegistry = serde_json::from_slice(&bytes).ok()?;
    if document.schema_version != SCAN_REGISTRY_SCHEMA_VERSION {
        return None;
    }
    Some(document)
}

/// Write through a temporary file and rename over the target, so a process that
/// dies mid-write leaves the previous registry intact rather than a truncated
/// one the next boot has to discard.
fn write_registry_document(
    location: &Path,
    document: &PersistedScanRegistry,
) -> Result<(), String> {
    let directory = location
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", location.display()))?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("cannot create {}: {error}", directory.display()))?;

    let bytes = serde_json::to_vec(document)
        .map_err(|error| format!("cannot serialize the registry: {error}"))?;
    let temporary_location = directory.join(REGISTRY_TEMPORARY_FILE_NAME);
    fs::write(&temporary_location, &bytes)
        .map_err(|error| format!("cannot write {}: {error}", temporary_location.display()))?;
    fs::rename(&temporary_location, location).map_err(|error| {
        let _ = fs::remove_file(&temporary_location);
        format!("cannot replace {}: {error}", location.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, FileTimes};
    use std::time::{Duration, SystemTime};

    struct TestRegistryRoot {
        root: PathBuf,
    }

    impl TestRegistryRoot {
        fn create(test_name: &str) -> Self {
            let unique_suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            // Canonical, because the scan policy refuses any path with a
            // symlink component and the platform temp directory reaches through
            // one on macOS. An uncanonicalized fixture makes every hydration
            // refuse for the wrong reason, which reads as a passing staleness
            // test that never checked staleness.
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("the temp directory should resolve")
                .join(format!(
                    "sourdaw-{test_name}-{}-{unique_suffix}",
                    std::process::id()
                ));
            fs::create_dir_all(root.join("plugins")).expect("test plugin root should be created");
            Self { root }
        }

        /// A policy that authorizes this test's plugin directory and nothing
        /// else — the platform defaults are the user's real plugin folders, and
        /// no test may write into those.
        fn scan_policy(&self) -> PluginScanPolicy {
            PluginScanPolicy::with_allowed_roots(vec![self.root.join("plugins")])
        }

        fn store(&self) -> PluginRegistryStore {
            PluginRegistryStore::at(self.root.join(REGISTRY_FILE_NAME))
        }

        fn write_plugin_file(&self, file_name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join("plugins").join(file_name);
            fs::write(&path, contents).expect("test plugin file should be written");
            path
        }
    }

    impl Drop for TestRegistryRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn registry_entry(path: &Path, stable_id: &str) -> PluginRegistryEntry {
        PluginRegistryEntry {
            path: path.display().to_string(),
            stable_id: stable_id.to_string(),
            clap_id: "com.vendor.reverb".to_string(),
            format: "clap".to_string(),
            name: "Vendor Reverb".to_string(),
            category: "effect".to_string(),
        }
    }

    fn registry_with(
        entries: Vec<(String, PluginRegistryEntry)>,
    ) -> HashMap<String, PluginRegistryEntry> {
        entries.into_iter().collect()
    }

    /// The defect: nothing survived the process, so a saved project reopened
    /// against an empty registry and failed every plugin in it.
    #[test]
    fn a_persisted_entry_resolves_again_in_a_new_process() {
        let test_root = TestRegistryRoot::create("registry-hydrate");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));

        // A second store over the same file is the next launch: nothing carries
        // over but what was written.
        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        let registry = next_launch_registry.lock().expect("registry lock");
        let entry = registry
            .get("aaaa1111")
            .expect("the persisted entry must resolve without a new scan");
        assert_eq!(entry.path, plugin_path.display().to_string());
        assert_eq!(entry.clap_id, "com.vendor.reverb");
        assert_eq!(entry.name, "Vendor Reverb");
        assert_eq!(entry.category, "effect");
        assert_eq!(entry.format, "clap");
        assert_eq!(entry.stable_id, "aaaa1111");
    }

    /// A live scan owns the registry; the file is the older view and may not
    /// overwrite it.
    #[test]
    fn hydration_does_not_displace_an_entry_this_session_scanned() {
        let test_root = TestRegistryRoot::create("registry-hydrate-additive");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));

        let mut rescanned = registry_entry(&plugin_path, "aaaa1111");
        rescanned.name = "Vendor Reverb 2".to_string();
        let session_registry = Mutex::new(registry_with(vec![("aaaa1111".to_string(), rescanned)]));
        test_root
            .store()
            .hydrate_into(&session_registry, &test_root.scan_policy());

        assert_eq!(
            session_registry
                .lock()
                .expect("registry lock")
                .get("aaaa1111")
                .expect("the scanned entry should still be there")
                .name,
            "Vendor Reverb 2"
        );
    }

    /// A plugin updated in place keeps its path, so the path is not enough to
    /// tell the scanned file from its replacement. Resolving the stale row
    /// would hand activation a descriptor id the file on disk may no longer
    /// carry.
    #[test]
    fn a_plugin_file_whose_size_changed_does_not_hydrate() {
        let test_root = TestRegistryRoot::create("registry-stale-size");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));

        let scanned_times = File::open(&plugin_path)
            .expect("plugin file should open")
            .metadata()
            .expect("plugin metadata should be readable");
        let scanned_modified = scanned_times
            .modified()
            .expect("plugin mtime should be readable");
        fs::write(&plugin_path, b"clap-bytes-version-2").expect("plugin file should be replaced");
        // Pin the mtime back to the scanned value so only the size differs:
        // the size check has to stand on its own.
        File::options()
            .write(true)
            .open(&plugin_path)
            .expect("plugin file should open for a time update")
            .set_times(FileTimes::new().set_modified(scanned_modified))
            .expect("plugin mtime should be restorable");

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "a plugin file whose size changed must not resolve from the stale entry"
        );
    }

    /// The other half of the same invalidation: a replacement of identical size
    /// is still a different file, and its modification time says so.
    #[test]
    fn a_plugin_file_whose_modification_time_changed_does_not_hydrate() {
        let test_root = TestRegistryRoot::create("registry-stale-mtime");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));

        File::options()
            .write(true)
            .open(&plugin_path)
            .expect("plugin file should open for a time update")
            .set_times(FileTimes::new().set_modified(SystemTime::now() + Duration::from_secs(120)))
            .expect("plugin mtime should be settable");

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "a plugin file modified since the scan must not resolve from the stale entry"
        );
    }

    /// A row hydration refused is still where the plugin was last seen, and an
    /// activation miss has nothing else to name.
    #[test]
    fn a_stale_row_is_still_the_last_known_location() {
        let test_root = TestRegistryRoot::create("registry-last-known");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let store = test_root.store();
        store.persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));
        fs::remove_file(&plugin_path).expect("plugin file should be removable");

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());

        let last_known = next_launch
            .last_known_entry("aaaa1111")
            .expect("the removed plugin's last known location must survive");
        assert_eq!(last_known.path, plugin_path.display().to_string());
        assert_eq!(last_known.name, "Vendor Reverb");
    }

    #[test]
    fn a_corrupt_registry_file_reads_as_an_absent_one() {
        let test_root = TestRegistryRoot::create("registry-corrupt");
        fs::write(test_root.root.join(REGISTRY_FILE_NAME), b"{not json at all")
            .expect("corrupt registry should be written");

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(next_launch_registry
            .lock()
            .expect("registry lock")
            .is_empty());
    }

    #[test]
    fn a_registry_file_from_another_schema_reads_as_an_absent_one() {
        let test_root = TestRegistryRoot::create("registry-schema");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));

        let location = test_root.root.join(REGISTRY_FILE_NAME);
        let mut document: PersistedScanRegistry =
            serde_json::from_slice(&fs::read(&location).expect("registry should be readable"))
                .expect("registry should parse");
        document.schema_version = SCAN_REGISTRY_SCHEMA_VERSION + 1;
        fs::write(
            &location,
            serde_json::to_vec(&document).expect("registry should serialize"),
        )
        .expect("registry should be rewritten");

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "a document this build does not understand must be read as absent, not in part"
        );
    }

    /// The file is data, not a grant: a row naming a path outside the scan
    /// policy's roots resolves to nothing.
    #[test]
    fn a_row_outside_the_scan_policy_roots_does_not_hydrate() {
        let test_root = TestRegistryRoot::create("registry-unauthorized");
        fs::create_dir_all(test_root.root.join("elsewhere"))
            .expect("outside directory should be created");
        let outside_path = test_root.root.join("elsewhere").join("Smuggled.clap");
        fs::write(&outside_path, b"clap-bytes").expect("outside plugin should be written");
        test_root.store().persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&outside_path, "aaaa1111"),
        )]));

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "the registry file must not authorize a path the scan policy refuses"
        );
    }

    #[test]
    fn a_store_with_no_file_neither_reads_nor_writes() {
        let test_root = TestRegistryRoot::create("registry-in-memory");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");

        let store = PluginRegistryStore::in_memory_only();
        store.persist(&registry_with(vec![(
            "aaaa1111".to_string(),
            registry_entry(&plugin_path, "aaaa1111"),
        )]));
        let registry = Mutex::new(HashMap::new());
        store.hydrate_into(&registry, &test_root.scan_policy());

        assert!(registry.lock().expect("registry lock").is_empty());
        assert!(store.last_known_entry("aaaa1111").is_none());
    }
}
