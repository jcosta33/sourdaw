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
//! What the file *is* trusted for, verbatim, is everything a scan learned about
//! a plugin: the path and descriptor identity activation resolves by, and the
//! metadata a scan would otherwise re-read — which the walk republishes for an
//! unchanged file rather than spawning its helpers again ([`ScanRow`],
//! [`PluginRegistryStore::reusable_rows`]). The stored fingerprint gates
//! staleness, not authenticity: it can tell that the file at that path has
//! changed since the scan, and it can tell nothing whatsoever about whether the
//! bytes there were ever the plugin the row claims. An attacker who can write
//! this file can point an authorized key at any other policy-authorized plugin,
//! and describe it to the browser however they like, and the fingerprint will
//! agree. What they cannot do through it is make a plugin loadable that the
//! live policy would refuse. Anything stronger — a content hash, a signature —
//! would be a different mechanism; do not build on the weaker one as if it were
//! that.
//!
//! A file this build cannot parse, or one carrying a different schema version,
//! is treated as absent: the registry stays empty and a scan refills it, which
//! is exactly the state a first run is in. Reading half of it is never an
//! option — a partially populated lookup table is indistinguishable, from the
//! user's side, from the missing-plugin bug this module exists to fix.
//!
//! Registry I/O is control-side only. Every entry point here touches the
//! filesystem and must never be reached from the audio callback.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use daw_plugin_host::scanner::{self, PluginFormat, ScannedPlugin};
use daw_plugin_host::vst3_module;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::commands::filesystem::APP_DIR_NAME;
use crate::commands::plugins::{MAX_SCAN_CANDIDATES, SCANNED_PLUGIN_KEY_CAPACITY};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::state::PluginRegistryEntry;

/// Schema version of the persisted registry document.
///
/// Whole-document, not per entry, and deliberately so: a mismatch has to mean
/// "read nothing". A per-entry version would license a partial load, which is
/// the half-populated registry that reports "plugin not found" for a plugin the
/// user has already scanned.
///
/// Bumped to 2 when the row gained the scanned capability fields. A version 1
/// document carries no record of whether its zeros were queried or assumed, and
/// there is no migration that can invent one: the whole document reads as
/// absent and the next scan refills it, which is the policy every other row
/// change here follows.
///
/// Bumped to 3 when `clap_id` became `descriptor_id`: the column holds the same
/// move-survivable identity, now named for the concept rather than for the one
/// format that had it. `descriptor_id` carries no serde default, so a version 2
/// document actually fails to deserialize at all — `read_registry_document`
/// discards the whole document before the schema check ever runs. The version
/// gate is belt-and-braces here, not the mechanism that drops the secondary key
/// a moved plugin resolves by.
///
/// Bumped to 4 when the document gained `quarantine`: binaries whose scan
/// helper crashed or timed out, kept out of the candidate loop until an
/// explicit retry clears them (#2911). Same policy as every earlier bump —
/// `quarantine` carries no serde default, so a version 3 document fails to
/// deserialize outright rather than hydrate with an empty quarantine map that
/// would misreport every previously-quarantined binary as healthy.
///
/// Bumped to 5 when the row started carrying the scan's whole `ScannedPlugin`
/// rather than the handful of columns activation reads. A version 4 row has no
/// vendor, category, version or parameter contract, so it cannot stand in for
/// the scan that produced it — which is exactly what the walk now asks of an
/// unchanged file's row. Same policy as every earlier bump: the document reads
/// as absent, and the next scan refills it in full.
const SCAN_REGISTRY_SCHEMA_VERSION: u32 = 5;

const REGISTRY_FILE_NAME: &str = "plugin-registry.json";
const REGISTRY_TEMPORARY_FILE_STEM: &str = "plugin-registry.json";

/// Refuse a document carrying more rows than a completed scan could index.
///
/// Every factor, because every one of them multiplies: a walk indexes at most
/// [`MAX_SCAN_CANDIDATES`] files, each file may declare up to
/// [`scanner::MAX_SCANNED_BUNDLE_PLUGINS`] plugins, and each plugin is stored
/// under [`SCANNED_PLUGIN_KEY_CAPACITY`] keys. Counting candidates alone was
/// wrong by the whole bundle factor — one two-plugin bundle in an otherwise
/// full folder writes more rows than such a bound admits — and the reader would
/// then refuse, at every launch, a file this build's own writer produced.
///
/// Each factor is read from the code that enforces it rather than restated
/// here. A restated bound is a second opinion that can fall behind the first,
/// and falling behind means refusing documents this build wrote.
///
/// Bounding the row count as well as the byte count matters because the two
/// costs are different: deeply repetitive JSON well inside the byte bound still
/// expands into a map far larger than any scan can produce.
const MAX_REGISTRY_ENTRIES: usize = MAX_SCAN_CANDIDATES
    * scanner::MAX_SCANNED_BUNDLE_PLUGINS as usize
    * SCANNED_PLUGIN_KEY_CAPACITY;

/// Refuse to parse a registry file larger than a scan could have written.
///
/// Derived from [`MAX_REGISTRY_ENTRIES`] and the largest row this build can
/// write: a whole [`ScannedPlugin`] at the scanner's own caps — 256 parameter
/// descriptors with names and modules at the per-parameter byte cap — which
/// serialises to a little over 100 KB. The bound is the next power of two above
/// that product.
///
/// It is deliberately enormous, and that is the right shape for it. This is the
/// ceiling a pathological plugin folder could write, not a description of a
/// real registry: an actual musician's file is under a megabyte, because real
/// bundles declare a handful of plugins with a handful of parameters. The bound
/// exists so the reader never refuses a document the writer produced — that
/// failure is unrecoverable without deleting the file by hand, and it repeats
/// at every launch. What it screens out is a file that is not this file at all,
/// and one of those is orders of magnitude away from either number.
///
/// `the_byte_bound_admits_a_registry_full_of_maximal_rows` measures the row
/// rather than trusting this arithmetic, and fails if either side moves.
const MAX_REGISTRY_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Distinguishes one process's temporary registry file from another's.
///
/// Two Sourdaw instances writing the registry at the same time is not exotic —
/// they share one app-data directory. A fixed temporary name lets each truncate
/// the other's half-written bytes and then rename the result over the registry,
/// publishing a document that is neither process's. The pid separates
/// instances; this counter separates writes inside one instance, which
/// `resolve_registry_entry` can issue concurrently with a scan's own save.
static TEMPORARY_FILE_NONCE: AtomicU64 = AtomicU64::new(0);

/// The persisted registry document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedScanRegistry {
    pub schema_version: u32,
    /// The lookup table verbatim: one row per key activation resolves, which is
    /// both the path hash and the CLAP descriptor id of every scanned CLAP
    /// plugin. Ordered, so a rewrite that changed nothing produces the same
    /// bytes.
    pub entries: BTreeMap<String, PersistedPluginEntry>,
    /// Binaries a scan helper crashed or timed out on, keyed by path. Ordered
    /// for the same byte-stability reason as `entries`.
    pub quarantine: BTreeMap<String, PersistedQuarantineEntry>,
}

/// The document as it is written: the same columns as
/// [`PersistedScanRegistry`], borrowed rather than owned.
///
/// A persist writes the whole registry, and the whole registry is already in
/// memory under the store's lock. Building an owned document to serialize would
/// hold a second copy of every row for the length of the write, on a table
/// whose ceiling is [`MAX_REGISTRY_ENTRIES`] rows.
///
/// The field names are the schema and must stay identical to
/// [`PersistedScanRegistry`]'s: this writes what that reads.
#[derive(Serialize)]
struct PersistedScanRegistryRef<'a> {
    schema_version: u32,
    entries: &'a BTreeMap<String, PersistedPluginEntry>,
    quarantine: &'a BTreeMap<String, PersistedQuarantineEntry>,
}

/// The quarantine column alone, out of a document whose other columns this
/// build may not be able to read.
///
/// Every other field is ignored rather than validated, which is the whole
/// point: the column survives a document the schema check would discard.
/// `quarantine` defaults so that a document written before the column existed
/// reads as "nothing quarantined" rather than as unreadable.
#[derive(Deserialize)]
struct QuarantineColumn {
    #[serde(default)]
    quarantine: BTreeMap<String, PersistedQuarantineEntry>,
}

/// One persisted quarantine row: a binary a scan will not spawn a helper for
/// again until an explicit retry clears it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedQuarantineEntry {
    pub path: String,
    /// The process-level failure that triggered quarantine, verbatim from the
    /// scan helper — see `plugin_scan_worker::is_process_failure`.
    pub reason: String,
    pub quarantined_at_ms: u64,
}

/// One scanned plugin and every registry key it answers to, which is what
/// [`PluginRegistryStore::persist`] turns into rows.
///
/// The keys travel with the row rather than being derived here, because the
/// caller knows things this store does not: a scan publishes a plugin under its
/// path hash and its descriptor id, and an activation rescan additionally
/// publishes it under the stale key the saved project actually recorded.
#[derive(Debug, Clone)]
pub struct ScanRow {
    pub keys: Vec<String>,
    pub plugin: ScannedPlugin,
}

/// One persisted registry row: what the scan learned, plus the fingerprint of
/// the file it learned it from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedPluginEntry {
    /// The scan's whole answer for this plugin, verbatim.
    ///
    /// Stored whole rather than as the columns activation happens to read,
    /// because the scan walk now reuses an unchanged file's rows in place of
    /// re-running its helpers: a row that dropped the vendor, the category, the
    /// version or the parameter contract could not stand in for the scan that
    /// produced it, and the browse list would lose a field on every run that
    /// did not re-inspect the plugin.
    pub plugin: ScannedPlugin,
    /// Where this plugin sat among the plugins its file declares.
    ///
    /// A bundle's plugins are ordered by its factory, and that order is not
    /// recoverable from the rows themselves — they are keyed by identity, not
    /// by position. Recorded so a reused file comes back in the order a fresh
    /// scan of it would have produced.
    pub bundle_position: u32,
    /// Size, in bytes, of the binary this plugin loads from — which is the file
    /// inside the bundle, not the bundle directory the walk found. See
    /// [`scanned_binary_location`].
    pub file_size_bytes: u64,
    /// Modification time of that same binary when it was scanned, in
    /// milliseconds since the unix epoch.
    ///
    /// Millisecond resolution is the fingerprint's floor: a replacement written
    /// within the same millisecond *and* at exactly the same size reads as
    /// unchanged. Every real plugin update moves one of the two.
    pub file_modified_ms: u64,
}

impl PersistedPluginEntry {
    fn as_registry_entry(&self) -> PluginRegistryEntry {
        PluginRegistryEntry::from_scanned(&self.plugin)
    }

    /// Whether an instance inspection ran for this row and answered.
    ///
    /// `parameters` is `Some` exactly when the bounded instance worker returned
    /// a contract, and `parameter_metadata_reason` is `Some` exactly when it
    /// was asked and could not. Both absent is the third case and the one the
    /// pair exists to separate: nobody asked at all — a targeted activation
    /// rescan reads the descriptor and stops there.
    fn instance_inspection_answered(&self) -> bool {
        self.plugin.parameters.is_some() && self.plugin.parameter_metadata_reason.is_none()
    }
}

/// What this process has already learned about a registry key the in-memory
/// registry does not hold.
#[derive(Debug)]
enum ResolutionOutcome {
    /// A caller is inside this key's rescan right now.
    InProgress,
    /// The rescan ran and the plugin was not there, with the refusal it
    /// produced.
    Refused(String),
}

#[derive(Debug, Default)]
struct StoredRegistry {
    /// Whether the file has been read this process. Read-once: hydration is a
    /// boot step, and re-reading it later would resurrect entries a completed
    /// scan has since removed.
    hydrated: bool,
    /// The persisted view of the registry: every row the file carried, plus
    /// every row this process has written to it, minus the rows a completed
    /// scan removed. Rows hydration refused as stale stay — a refused row is
    /// still the plugin's last known location, which is what an activation miss
    /// needs in order to say where the plugin used to be.
    ///
    /// This is the union source [`PluginRegistryStore::persist`] writes over, so
    /// it has to track removals: see
    /// [`PluginRegistryStore::apply_completed_scan_removals`].
    entries: BTreeMap<String, PersistedPluginEntry>,
    /// One entry per registry key whose miss this process has already tried to
    /// resolve. Bounds the targeted rescan to once per key per process; see
    /// [`PluginRegistryStore::claim_rescan`].
    resolutions: HashMap<String, ResolutionOutcome>,
    /// Binaries currently quarantined, keyed by path. Loaded from the file on
    /// hydration and mutated by [`PluginRegistryStore::quarantine_failure`],
    /// [`PluginRegistryStore::clear_quarantine`], and
    /// [`PluginRegistryStore::apply_quarantine_removals`].
    quarantine: BTreeMap<String, PersistedQuarantineEntry>,
    /// Every key this process has explicitly decided about — quarantined,
    /// cleared, or dropped as proven gone — as opposed to a key it merely
    /// hydrated and never touched again.
    ///
    /// [`PluginRegistryStore::persist`] needs this distinction because the
    /// scan runs in a forked process with its own store, while the main
    /// process persists on its own paths (a targeted rescan, another scan): a
    /// straight replace of the quarantine column with this process's
    /// in-memory copy would erase a row a sibling process wrote or cleared
    /// after this one last read the file. This process's own decisions must
    /// still win over a stale or concurrent sibling write, so `persist` reads
    /// the file's current quarantine column fresh and overlays only the keys
    /// in this set from `quarantine` — a key this process never touched
    /// defers entirely to whatever is on disk.
    quarantine_touched: BTreeSet<String>,
}

/// The verdict on a caller's request to run the one targeted rescan a registry
/// key gets per process.
pub enum RescanClaim<'a> {
    /// Nobody has rescanned this key yet. The caller owns the attempt and must
    /// settle it.
    Granted(RescanAttempt<'a>),
    /// A rescan already ran this process and refused, with this message.
    Refused(String),
    /// Another caller is inside this key's rescan right now.
    InProgress,
}

/// The one rescan a registry key gets this process, held while it runs.
///
/// Settle it with [`RescanAttempt::refuse`] or [`RescanAttempt::resolved`].
/// Dropping it unsettled — a panic in the rescan, an early return — clears the
/// in-progress marker rather than leaving it, because a marker nothing can
/// clear would refuse that plugin for the rest of the process.
pub struct RescanAttempt<'a> {
    store: &'a PluginRegistryStore,
    plugin_id: String,
    settled: bool,
}

impl RescanAttempt<'_> {
    /// The plugin is not at its last known location. Record the refusal so the
    /// next activation of the same id answers from it instead of spawning
    /// another scan worker.
    pub fn refuse(mut self, reason: String) {
        self.settled = true;
        self.store
            .lock_stored()
            .resolutions
            .insert(self.plugin_id.clone(), ResolutionOutcome::Refused(reason));
    }

    /// The rescan found the plugin. Nothing is recorded: the entry is in the
    /// registry now, so the next lookup hits before it ever reaches a claim.
    pub fn resolved(mut self) {
        self.settled = true;
        self.store.lock_stored().resolutions.remove(&self.plugin_id);
    }
}

impl Drop for RescanAttempt<'_> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        self.store.lock_stored().resolutions.remove(&self.plugin_id);
    }
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
        stored.quarantine = document.quarantine;

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

    /// The rows a fresh scan of `path` would only reproduce, or nothing.
    ///
    /// `Some` means the file at `path` is byte-for-byte the size and age the
    /// scan that wrote these rows recorded, the policy still authorizes it, and
    /// every row for it came from an instance inspection that ran and answered.
    /// A caller holding that may publish the rows instead of spawning the
    /// helpers again.
    ///
    /// The inspection condition is what makes the reuse converge rather than
    /// freeze. A row whose inspection was refused, or never ran at all, records
    /// less than a scan can learn about that file — so it is rescanned on every
    /// run until one of them answers, instead of pinning an incomplete answer
    /// for as long as the file sits still.
    ///
    /// All-or-nothing per file, because the rows of one bundle are one scan's
    /// output: reusing the answered half and re-inspecting the rest would
    /// publish a list assembled from two different reads of the same file.
    pub fn reusable_rows(
        &self,
        path: &Path,
        scan_policy: &PluginScanPolicy,
    ) -> Option<Vec<ScannedPlugin>> {
        let path_as_scanned = path.display().to_string();
        let stored = self.lock_stored();
        let mut rows: Vec<&PersistedPluginEntry> = stored
            .entries
            .values()
            .filter(|entry| entry.plugin.path == path_as_scanned)
            .collect();
        if rows.is_empty() {
            return None;
        }
        if !rows
            .iter()
            .all(|entry| entry_is_still_the_scanned_file(entry, scan_policy))
        {
            return None;
        }
        if !rows
            .iter()
            .all(|entry| entry.instance_inspection_answered())
        {
            return None;
        }

        rows.sort_by_key(|entry| entry.bundle_position);
        // One plugin holds a row under each key it answers to, and the scan
        // result carries it once.
        let mut published = BTreeSet::new();
        Some(
            rows.into_iter()
                .filter(|entry| published.insert(entry.plugin.id.clone()))
                .map(|entry| entry.plugin.clone())
                .collect(),
        )
    }

    /// Whether `path` is currently quarantined, and why.
    pub fn is_quarantined(&self, path: &Path) -> Option<PersistedQuarantineEntry> {
        self.lock_stored()
            .quarantine
            .get(&path.display().to_string())
            .cloned()
    }

    /// Record a scan helper's process-level failure against `path`, replacing
    /// any earlier record for it.
    ///
    /// Called only for a crash or a timeout — see
    /// `plugin_scan_worker::is_process_failure` — never for a data-level
    /// refusal, so a candidate that merely failed to parse is retried on every
    /// ordinary scan rather than blacklisted from one bad read.
    pub fn quarantine_failure(&self, path: &Path, reason: String, quarantined_at_ms: u64) {
        let key = path.display().to_string();
        let mut stored = self.lock_stored();
        stored.quarantine.insert(
            key.clone(),
            PersistedQuarantineEntry {
                path: key.clone(),
                reason,
                quarantined_at_ms,
            },
        );
        stored.quarantine_touched.insert(key);
    }

    /// Clear `path`'s quarantine record, if it has one.
    ///
    /// Called before a retry's helper runs — never after — so a fresh crash
    /// re-quarantines from a clean slate and a clean scan leaves nothing
    /// behind.
    pub fn clear_quarantine(&self, path: &Path) {
        let key = path.display().to_string();
        let mut stored = self.lock_stored();
        stored.quarantine.remove(&key);
        stored.quarantine_touched.insert(key);
    }

    /// Every currently quarantined binary, for the scan response.
    pub fn quarantined_snapshot(&self) -> Vec<PersistedQuarantineEntry> {
        self.lock_stored().quarantine.values().cloned().collect()
    }

    /// Drop quarantine records this scan proves gone from disk.
    ///
    /// `keeps_quarantine_row` is deliberately not
    /// [`apply_completed_scan_removals`](Self::apply_completed_scan_removals)'s
    /// predicate reused: that one drops a registry entry the instant its root
    /// is scanned, which for a *skipped* quarantined candidate would clear the
    /// record on this very scan and let the next default scan retry the crash
    /// quarantine exists to stop retrying silently (AC-002). The caller's
    /// predicate must only say a path is gone when the scan actually walked
    /// its containing root and did not find it there.
    pub fn apply_quarantine_removals(&self, keeps_quarantine_row: impl Fn(&Path) -> bool) {
        let mut stored = self.lock_stored();
        let removed_keys: Vec<String> = stored
            .quarantine
            .iter()
            .filter(|(_, entry)| !keeps_quarantine_row(Path::new(&entry.path)))
            .map(|(key, _)| key.clone())
            .collect();
        stored
            .quarantine
            .retain(|_, entry| keeps_quarantine_row(Path::new(&entry.path)));
        stored.quarantine_touched.extend(removed_keys);
    }

    /// Claim the one targeted rescan a registry key gets this process.
    ///
    /// The in-memory registry is the only thing bounding how often activation
    /// asks for a plugin it cannot resolve, and it bounds nothing: the frontend
    /// rebuilds a project's live strip on every transport start and fires an
    /// activation per external device, so a project whose plugins have all
    /// moved asks again on every Play. Without this record each of those asks
    /// spawns its own scan-worker child process, up to the rescan timeout each,
    /// and `load_plugin` is holding a fair `RwLock` in read mode the whole time
    /// — one queued writer behind them stalls every later reader.
    ///
    /// Concurrent callers for the same key do not queue. The second one is told
    /// [`RescanClaim::InProgress`] and refuses immediately, because the
    /// alternative is parking a blocking-pool thread for the length of a child
    /// process to arrive at an answer the first caller is about to publish to
    /// the registry anyway.
    pub fn claim_rescan(&self, plugin_id: &str) -> RescanClaim<'_> {
        let mut stored = self.lock_stored();
        match stored.resolutions.get(plugin_id) {
            Some(ResolutionOutcome::Refused(reason)) => {
                return RescanClaim::Refused(reason.clone())
            }
            Some(ResolutionOutcome::InProgress) => return RescanClaim::InProgress,
            None => {}
        }
        stored
            .resolutions
            .insert(plugin_id.to_string(), ResolutionOutcome::InProgress);
        drop(stored);

        RescanClaim::Granted(RescanAttempt {
            store: self,
            plugin_id: plugin_id.to_string(),
            settled: false,
        })
    }

    /// Apply a completed scan's removals to the persisted view.
    ///
    /// `keeps_persisted_row` is the scan publisher's own retention predicate,
    /// and it has to run here as well as against the in-memory registry.
    /// [`persist`](Self::persist) unions the live registry over this view, so a
    /// row the scan legitimately dropped — a plugin uninstalled from a root the
    /// scan covered — would otherwise be written straight back out of the
    /// view's own copy and outlive the deletion forever.
    ///
    /// Recorded rescan refusals are dropped too. Every one of them predates
    /// this scan, and the scan is a fresh authoritative look at the same disk:
    /// a plugin that was missing an hour ago and is indexed now must not keep
    /// answering from the older verdict.
    pub fn apply_completed_scan_removals(&self, keeps_persisted_row: impl Fn(&Path) -> bool) {
        let mut stored = self.lock_stored();
        stored
            .entries
            .retain(|_, entry| keeps_persisted_row(Path::new(&entry.plugin.path)));
        stored.resolutions.clear();
    }

    /// Write these scan rows to the file, merged over what the file already
    /// holds.
    ///
    /// A union, not a replacement. What one caller scanned is not the whole
    /// truth about the file: hydration deliberately refuses stale rows while
    /// keeping them as last-known locations, and a targeted rescan publishes
    /// exactly one plugin. Replacing the document with one caller's rows alone
    /// deleted every row hydration had refused — so a user whose plugins had
    /// all been updated in place lost every last-known location the moment one
    /// of them resolved, and every other plugin's activation fell into the
    /// "no scanned location is recorded" dead end this module exists to close.
    ///
    /// The union source is the view this store maintains, which already has
    /// [`apply_completed_scan_removals`](Self::apply_completed_scan_removals)
    /// applied, so a merge cannot resurrect a row a scan removed this session.
    ///
    /// A row whose file cannot be fingerprinted at all is dropped, not kept:
    /// the scan publisher applies its removals before calling this, so the
    /// union source no longer holds a previous row for that key either. That is
    /// the intended outcome for the only case that reaches it — the scanned
    /// path is not on disk — and it is why [`scanned_file_path`] falls back to
    /// the scanned path rather than reporting nothing whenever a *binary*
    /// inside it cannot be resolved.
    ///
    /// `rows` is ordered, and the order is what records each plugin's position
    /// in the file it came from — see [`PersistedPluginEntry::bundle_position`].
    ///
    /// Failure is reported and swallowed. A scan that found plugins has already
    /// succeeded for this session, and turning a full disk into a failed scan
    /// would take away the working half too.
    pub fn persist(&self, rows: &[ScanRow]) {
        let Some(location) = self.location.as_deref() else {
            return;
        };

        let mut fingerprints: HashMap<&str, Option<(u64, u64)>> = HashMap::new();
        let mut plugins_seen_per_file: HashMap<&str, u32> = HashMap::new();
        let mut scanned_this_session = BTreeMap::new();
        for row in rows {
            let path = row.plugin.path.as_str();
            let fingerprint = *fingerprints
                .entry(path)
                .or_insert_with(|| scanned_file_fingerprint(&row.plugin));
            let Some((file_size_bytes, file_modified_ms)) = fingerprint else {
                continue;
            };
            let bundle_position = plugins_seen_per_file.entry(path).or_insert(0);
            let entry = PersistedPluginEntry {
                plugin: row.plugin.clone(),
                bundle_position: *bundle_position,
                file_size_bytes,
                file_modified_ms,
            };
            *bundle_position += 1;
            for key in &row.keys {
                scanned_this_session.insert(key.clone(), entry.clone());
            }
        }

        let mut stored = self.lock_stored();
        stored.entries.extend(scanned_this_session);

        // The quarantine column gets the same "never resurrect what a sibling
        // removed, never erase what a sibling added" treatment as `entries`,
        // but by a different mechanism: quarantine decisions are keyed and
        // binary (present or absent), so a union of maps cannot express a
        // clear. Instead, re-read whatever the file currently holds and
        // overlay only the keys this process has itself decided about
        // (`quarantine_touched`) — every other key defers entirely to the
        // fresh disk read, which is how a sibling process's own quarantine or
        // clear survives a persist from this one.
        let mut quarantine = read_quarantine_column(location);
        for key in &stored.quarantine_touched {
            match stored.quarantine.get(key) {
                Some(entry) => {
                    quarantine.insert(key.clone(), entry.clone());
                }
                None => {
                    quarantine.remove(key);
                }
            }
        }

        // The union is already in `stored.entries`, so a failed write leaves
        // memory ahead of disk rather than behind it. That is the recoverable
        // direction: the next persist writes the same union again, while
        // rolling memory back would drop this scan's rows for the session that
        // just produced them.
        let written = write_registry_document(
            location,
            &PersistedScanRegistryRef {
                schema_version: SCAN_REGISTRY_SCHEMA_VERSION,
                entries: &stored.entries,
                quarantine: &quarantine,
            },
        );
        match written {
            Ok(()) => stored.quarantine = quarantine,
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
            .join(APP_DIR_NAME)
            .join(REGISTRY_FILE_NAME),
    )
}

/// Whether the file this entry describes is still the file that was scanned.
fn entry_is_still_the_scanned_file(
    entry: &PersistedPluginEntry,
    scan_policy: &PluginScanPolicy,
) -> bool {
    let path = Path::new(&entry.plugin.path);
    if !path.is_absolute() {
        return false;
    }
    if scan_policy.authorize_scan_root(path).is_err() {
        return false;
    }

    scanned_file_fingerprint(&entry.plugin).is_some_and(|(size, modified)| {
        size == entry.file_size_bytes && modified == entry.file_modified_ms
    })
}

/// The fingerprint of the file this plugin is actually loaded from, or nothing.
///
/// The one reader and writer of a row's fingerprint. Both sides go through it
/// so that a stored fingerprint and a compared fingerprint always describe the
/// same file: a capture that stats one file and a comparison that stats another
/// answers "unchanged" about a question nobody asked.
///
/// `None` means the scanned path is not there at all, and that is a refusal on
/// both sides — the row is not written with a fingerprint it could never be
/// checked against, and a row already holding one is neither hydrated nor
/// reused. Skipping is right in exactly that case, because the plugin is gone.
pub(crate) fn scanned_file_fingerprint(plugin: &ScannedPlugin) -> Option<(u64, u64)> {
    file_fingerprint(&scanned_file_path(plugin)?)
}

/// The file whose size and modification time stand for this plugin's version.
///
/// The resolved binary when there is one, and the scanned path itself when
/// there is not. The fallback is what keeps a bundle this build cannot resolve
/// a module inside — a VST3 whose `Info.plist` names an executable by some
/// other route, a layout added after this code was written — exactly as
/// fingerprintable as it was before any of it was resolved: its row is written,
/// hydrated and compared against the bundle directory, which is the weaker
/// answer the store gave every plugin until now. Weaker, because a directory
/// does not change when a file inside it is rewritten, so such a bundle's rows
/// are reused until something about the directory itself moves. Losing the row
/// instead would be worse than weak reuse: the scan would find the plugin,
/// publish it, persist nothing, and the next launch could not activate it.
pub(crate) fn scanned_file_path(plugin: &ScannedPlugin) -> Option<PathBuf> {
    let resolved = scanned_binary_location(plugin).filter(|location| location.is_file());
    if let Some(binary) = resolved {
        return Some(binary);
    }
    let candidate = Path::new(&plugin.path);
    fs::metadata(candidate)
        .is_ok()
        .then(|| candidate.to_path_buf())
}

/// Where this plugin's binary belongs, whether or not it is there yet.
///
/// A scanned path is the candidate the walk found, and for both hosted formats
/// that candidate is a bundle *directory* on at least one platform. A directory
/// carries the size and modification time of its own listing, and rewriting a
/// binary inside it moves neither: fingerprinting the candidate would read an
/// in-place plugin update as unchanged for as long as the bundle's own entries
/// stayed put, which on macOS is forever. So the fingerprint follows the file
/// the loader opens, resolved through the same public resolvers the loaders
/// themselves use rather than a second copy of each layout.
///
/// Separate from [`scanned_file_path`] because existence is a different
/// question from location: a bundle whose executable is missing still has a
/// place that executable belongs, which is what a fixture needs to know and
/// what a fingerprint must not be taken from.
pub(crate) fn scanned_binary_location(plugin: &ScannedPlugin) -> Option<PathBuf> {
    let candidate = Path::new(&plugin.path);
    if !candidate.is_dir() {
        return Some(candidate.to_path_buf());
    }
    match PluginFormat::from_wire_name(&plugin.format)? {
        PluginFormat::Clap => scanner::clap_library_path(candidate).ok(),
        PluginFormat::Vst3 => vst3_bundle_binary_location(candidate),
        PluginFormat::Vst2 | PluginFormat::AudioUnit => None,
    }
    .filter(|location| !location.is_dir())
}

/// The VST3 module inside a bundle, by this platform's layout.
///
/// macOS loads a bundle through `CFBundleCreate`, which takes its executable
/// from `Info.plist`'s `CFBundleExecutable` and is under no obligation to name
/// it after the bundle. So the plist's answer is asked for first, through the
/// same CoreFoundation call the loader makes: a bundle whose executable is
/// named for the vendor rather than for the bundle is fingerprinted from the
/// file the loader opens, not from a conventional name that is not there.
///
/// The remaining two answers are for a bundle CoreFoundation will not name an
/// executable for — no `Info.plist`, and nothing where it infers the executable
/// to be. The stem-named path is the convention, and when it is absent the one
/// regular file in `Contents/MacOS` is the only candidate left. Lowest path
/// wins among several, so repeated runs resolve the same file — `read_dir`
/// order is not stable, and an unstable pick would read as a plugin that
/// changes every scan.
#[cfg(target_os = "macos")]
fn vst3_bundle_binary_location(bundle: &Path) -> Option<PathBuf> {
    let declared = vst3_module::bundle_executable_path(bundle);
    if let Some(executable) = declared.filter(|executable| executable.is_file()) {
        return Some(executable);
    }

    let stem_named = vst3_module::macos_executable_path(bundle).ok()?;
    if stem_named.is_file() {
        return Some(stem_named);
    }
    lowest_regular_file(&bundle.join("Contents").join("MacOS")).or(Some(stem_named))
}

/// The lexicographically lowest regular file directly inside `directory`,
/// ignoring the dot-prefixed ones.
///
/// Finder leaves `.DS_Store` behind and AppleDouble leaves `._Name`, and both
/// sort below every executable name a vendor would choose. An unfiltered
/// minimum would fingerprint a sidecar the loader never opens — and then an
/// update that rewrote the real module would read as unchanged, because the
/// sidecar had not moved.
#[cfg(target_os = "macos")]
fn lowest_regular_file(directory: &Path) -> Option<PathBuf> {
    fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .min()
}

/// The VST3 module inside a bundle, by this platform's layout.
///
/// Windows names several architecture directories a host tries in order, so an
/// existing module decides; with none present the preferred one is still the
/// place the module belongs, and the existence gate above rejects it.
#[cfg(target_os = "windows")]
fn vst3_bundle_binary_location(bundle: &Path) -> Option<PathBuf> {
    let candidates = vst3_module::windows_module_paths(bundle, std::env::consts::ARCH).ok()?;
    candidates
        .iter()
        .find(|path| path.is_file())
        .or_else(|| candidates.first())
        .cloned()
}

/// The VST3 module inside a bundle, by this platform's layout.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn vst3_bundle_binary_location(bundle: &Path) -> Option<PathBuf> {
    vst3_module::linux_module_path(bundle, std::env::consts::ARCH)
        .ok()
        .flatten()
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

/// Counts the bytes taken out of `inner`, so a bounded parse can say afterwards
/// how far it read.
struct CountingReader<R> {
    inner: R,
    bytes: u64,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buffer)?;
        self.bytes += read as u64;
        Ok(read)
    }
}

/// What a bounded parse found.
///
/// The two failures are told apart because only one of them is worth saying out
/// loud: a malformed document is the ordinary first-run and corrupt-file state
/// this module already treats as absent, while a document past the byte bound
/// is a file that is not this file at all.
enum BoundedRead<T> {
    Parsed(T),
    Malformed,
    PastByteBound,
}

/// Parse `source`, refusing anything that reads past `max_bytes`.
///
/// Streamed rather than buffered: the parser pulls from the reader, so the
/// bound limits what is *read*, not merely what is accepted. Collecting the
/// bytes first in order to reject them spends the whole bound in memory to
/// answer a question the count alone answers.
///
/// The bound is enforced on the read itself rather than on a `metadata` call
/// first. Two reasons, and both of them are the same file: `metadata` follows
/// symlinks and reports a length that need not describe what a subsequent read
/// will produce, so a registry replaced by a link to a character device reads a
/// declared length of zero and then returns bytes until memory runs out; and
/// even for an ordinary file the size can change between the stat and the read.
/// Reading one byte past the limit and refusing on overflow answers both
/// without trusting anything the filesystem said earlier.
fn read_within_byte_bound<T: DeserializeOwned>(
    source: impl Read,
    max_bytes: u64,
) -> BoundedRead<T> {
    let mut reader = CountingReader {
        inner: BufReader::new(source.take(max_bytes + 1)),
        bytes: 0,
    };
    let parsed = serde_json::from_reader(&mut reader).ok();
    if reader.bytes > max_bytes {
        return BoundedRead::PastByteBound;
    }
    match parsed {
        Some(value) => BoundedRead::Parsed(value),
        None => BoundedRead::Malformed,
    }
}

/// Read one shape out of the registry file, under the byte bound.
fn read_bounded_registry_file<T: DeserializeOwned>(location: &Path) -> Option<T> {
    let file = File::open(location).ok()?;
    match read_within_byte_bound(file, MAX_REGISTRY_FILE_BYTES) {
        BoundedRead::Parsed(value) => Some(value),
        BoundedRead::Malformed => None,
        BoundedRead::PastByteBound => {
            eprintln!(
                "[Plugin] Ignoring an oversized plugin scan registry at {}",
                location.display()
            );
            None
        }
    }
}

/// The quarantine column of whatever is on disk now, whether or not the rest of
/// the document parses.
///
/// [`PluginRegistryStore::persist`] needs this column and nothing else, and it
/// needs it from a file another writer owns half of. Deserializing the whole
/// document to reach one column ties a sibling's quarantine record to this
/// build's ability to parse the sibling's rows — a row shape from a newer build,
/// or a row this one corrupted, and the column reads as empty and the persist
/// erases every quarantine decision in it.
fn read_quarantine_column(location: &Path) -> BTreeMap<String, PersistedQuarantineEntry> {
    read_bounded_registry_file::<QuarantineColumn>(location)
        .map(|column| column.quarantine)
        .unwrap_or_default()
}

/// Read the registry document, or nothing.
fn read_registry_document(location: &Path) -> Option<PersistedScanRegistry> {
    let document: PersistedScanRegistry = read_bounded_registry_file(location)?;
    if document.schema_version != SCAN_REGISTRY_SCHEMA_VERSION {
        return None;
    }
    if document.entries.len() > MAX_REGISTRY_ENTRIES {
        // Absent, not truncated, for the reason a corrupt file is absent: a
        // registry this build reads in part is a lookup table that says "no
        // such plugin" for plugins the user has already scanned, and nothing
        // downstream can tell that apart from a genuine miss.
        eprintln!(
            "[Plugin] Ignoring a plugin scan registry with more rows than a scan can produce at {}",
            location.display()
        );
        return None;
    }
    Some(document)
}

/// Write through a temporary file and rename over the target, so a process that
/// dies mid-write leaves the previous registry intact rather than a truncated
/// one the next boot has to discard.
///
/// The temporary file is named per writer, not per registry. The atomicity the
/// rename buys is only worth having if the bytes being renamed are one writer's:
/// a shared name lets a second instance truncate this one's half-written file
/// and publish the interleaving of both. Same directory, because a rename is
/// only atomic within a filesystem.
fn write_registry_document(
    location: &Path,
    document: &PersistedScanRegistryRef<'_>,
) -> Result<(), String> {
    let directory = location
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", location.display()))?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("cannot create {}: {error}", directory.display()))?;

    let bytes = serde_json::to_vec(document)
        .map_err(|error| format!("cannot serialize the registry: {error}"))?;
    let nonce = TEMPORARY_FILE_NONCE.fetch_add(1, Ordering::Relaxed);
    let temporary_location = directory.join(format!(
        "{REGISTRY_TEMPORARY_FILE_STEM}.{}.{nonce}.tmp",
        std::process::id()
    ));
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
    use daw_plugin_host::scanner::ScannedParameterDescriptor;
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

    /// A fully inspected scan result: an instance was created, so `parameters`
    /// is an answer and there is no parameter reason.
    fn scanned_plugin(path: &Path, stable_id: &str) -> ScannedPlugin {
        ScannedPlugin {
            id: stable_id.to_string(),
            name: "Vendor Reverb".to_string(),
            vendor: "Vendor".to_string(),
            format: "clap".to_string(),
            category: "effect".to_string(),
            path: path.display().to_string(),
            version: "1.0.0".to_string(),
            descriptor_id: "com.vendor.reverb".to_string(),
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: true,
            parameters: Some(Vec::new()),
            parameter_metadata_reason: None,
            capability_metadata_reason: None,
        }
    }

    /// One scan row per `(key, plugin)` pair, the shape `persist` takes.
    fn rows_for(plugins: Vec<(&str, ScannedPlugin)>) -> Vec<ScanRow> {
        plugins
            .into_iter()
            .map(|(key, plugin)| ScanRow {
                keys: vec![key.to_string()],
                plugin,
            })
            .collect()
    }

    fn one_row(path: &Path, stable_id: &str) -> Vec<ScanRow> {
        rows_for(vec![(stable_id, scanned_plugin(path, stable_id))])
    }

    /// The defect: nothing survived the process, so a saved project reopened
    /// against an empty registry and failed every plugin in it.
    #[test]
    fn a_persisted_entry_resolves_again_in_a_new_process() {
        let test_root = TestRegistryRoot::create("registry-hydrate");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

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
        assert_eq!(entry.descriptor_id, "com.vendor.reverb");
        assert_eq!(entry.name, "Vendor Reverb");
        assert_eq!(entry.format, "clap");
        assert_eq!(entry.stable_id, "aaaa1111");
    }

    /// A live scan owns the registry; the file is the older view and may not
    /// overwrite it.
    #[test]
    fn hydration_does_not_displace_an_entry_this_session_scanned() {
        let test_root = TestRegistryRoot::create("registry-hydrate-additive");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

        let mut rescanned =
            PluginRegistryEntry::from_scanned(&scanned_plugin(&plugin_path, "aaaa1111"));
        rescanned.name = "Vendor Reverb 2".to_string();
        let session_registry = Mutex::new(HashMap::from([("aaaa1111".to_string(), rescanned)]));
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
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

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
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

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
        store.persist(&one_row(&plugin_path, "aaaa1111"));
        fs::remove_file(&plugin_path).expect("plugin file should be removable");

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());

        let last_known = next_launch
            .last_known_entry("aaaa1111")
            .expect("the removed plugin's last known location must survive");
        assert_eq!(last_known.plugin.path, plugin_path.display().to_string());
        assert_eq!(last_known.plugin.name, "Vendor Reverb");
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
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

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

    /// The version 4 document an upgrading user actually has on disk, written
    /// out literally rather than derived from a current one.
    ///
    /// A real version 4 row has no `plugin` object at all — no vendor, no
    /// category, no version, no parameter contract — so serde discards the
    /// document before the version gate is ever consulted, exactly as it does
    /// for version 2. What this pins is the outcome an upgrading user gets: one
    /// full rescan, never a row read in part. The version gate itself is pinned
    /// by [`a_current_row_labelled_with_the_previous_schema_version_does_not_hydrate`].
    ///
    /// Mutation this catches: giving `PersistedPluginEntry::plugin` a serde
    /// default admits this row with an invented scan result, and hydration then
    /// resolves a plugin whose vendor, version and parameters are fabrications.
    #[test]
    fn a_literal_version_four_document_reads_as_an_absent_one() {
        let test_root = TestRegistryRoot::create("registry-schema-v4");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let metadata = fs::metadata(&plugin_path).expect("plugin metadata should be readable");
        let size = metadata.len();
        let modified = metadata
            .modified()
            .expect("plugin mtime should be readable")
            .duration_since(UNIX_EPOCH)
            .expect("plugin mtime should be after the unix epoch")
            .as_millis() as u64;
        // Fingerprinted so it would hydrate on every other ground: the file is
        // there, unmodified, inside an authorized root. Only the schema version
        // stops it.
        let document = format!(
            r#"{{"schema_version":4,"entries":{{"aaaa1111":{{"path":{},"stable_id":"aaaa1111","descriptor_id":"com.vendor.reverb","format":"clap","name":"Vendor Reverb","num_inputs":2,"num_outputs":2,"has_custom_ui":true,"file_size_bytes":{size},"file_modified_ms":{modified}}}}},"quarantine":{{}}}}"#,
            serde_json::to_string(&plugin_path.display().to_string())
                .expect("a path should serialize as a JSON string")
        );
        fs::write(test_root.root.join(REGISTRY_FILE_NAME), document)
            .expect("version 4 registry should be written");

        let next_launch_registry = Mutex::new(HashMap::new());
        let store = test_root.store();
        store.hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "a version 4 row carries no scanned plugin to stand in for a scan; it must read as absent"
        );
        assert!(
            store.last_known_entry("aaaa1111").is_none(),
            "the whole document must be absent, not admitted into the persisted view"
        );
    }

    /// The version gate on its own, with a body this build can parse: only the
    /// declared version stops it. Version 4 is written literally rather than
    /// derived from the constant, because a test that says
    /// `SCAN_REGISTRY_SCHEMA_VERSION - 1` moves with the constant and can never
    /// notice a bump that was not made.
    ///
    /// Mutation this catches: leaving `SCAN_REGISTRY_SCHEMA_VERSION` at 4
    /// admits this document, and the row hydrates.
    #[test]
    fn a_current_row_labelled_with_the_previous_schema_version_does_not_hydrate() {
        let test_root = TestRegistryRoot::create("registry-schema-previous");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        test_root
            .store()
            .persist(&one_row(&plugin_path, "aaaa1111"));

        let location = test_root.root.join(REGISTRY_FILE_NAME);
        let mut document: PersistedScanRegistry =
            serde_json::from_slice(&fs::read(&location).expect("registry should be readable"))
                .expect("registry should parse");
        document.schema_version = 4;
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
            "the row shape changed under version 5; a document still claiming 4 must read as absent"
        );
    }

    /// The row has to carry the scan's whole answer, not the columns activation
    /// happens to read: the walk republishes it in place of re-inspecting an
    /// unchanged file, so anything it drops is a field the browse list loses on
    /// every run that reuses the row.
    ///
    /// Mutation this catches: persisting any projection of `ScannedPlugin`
    /// instead of the value itself — dropping `vendor`, `category`, `version`,
    /// `num_parameters` or `parameters` — fails the field it dropped.
    #[test]
    fn a_persisted_row_round_trips_the_whole_scanned_plugin() {
        let test_root = TestRegistryRoot::create("registry-round-trip");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let mut plugin = scanned_plugin(&plugin_path, "aaaa1111");
        plugin.vendor = "Valhalla".to_string();
        plugin.category = "reverb".to_string();
        plugin.version = "3.2.1".to_string();
        plugin.num_parameters = 1;
        plugin.parameters = Some(vec![ScannedParameterDescriptor {
            id: 7,
            name: "Mix".to_string(),
            module: Some("Master".to_string()),
            min_value: 0.0,
            max_value: 1.0,
            default_value: 0.5,
            is_automatable: true,
            is_modulatable: false,
            is_stepped: false,
            is_enum: false,
        }]);
        test_root
            .store()
            .persist(&rows_for(vec![("aaaa1111", plugin.clone())]));

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        let persisted = next_launch
            .last_known_entry("aaaa1111")
            .expect("the persisted row must survive the file")
            .plugin;

        assert_eq!(persisted.vendor, "Valhalla");
        assert_eq!(persisted.category, "reverb");
        assert_eq!(persisted.version, "3.2.1");
        assert_eq!(persisted.num_parameters, 1);
        assert_eq!(persisted.parameters, plugin.parameters);
        assert_eq!(persisted.name, plugin.name);
        assert_eq!(persisted.descriptor_id, plugin.descriptor_id);
        assert_eq!(persisted.num_inputs, plugin.num_inputs);
        assert_eq!(persisted.num_outputs, plugin.num_outputs);
        assert_eq!(persisted.has_custom_ui, plugin.has_custom_ui);
    }

    /// The version 1 document this build actually has to survive, written out
    /// literally rather than derived from a current one.
    ///
    /// Reading it as absent is the stated policy for the schema bump, and the
    /// test above cannot pin it: that one takes a version 2 body and only
    /// raises its version number, so every row still carries the capability
    /// fields and it would keep passing even if the rejection were coming from
    /// serde failing on missing fields rather than from the version check. A
    /// real version 1 row has no `num_inputs`, no `num_outputs`, no
    /// `has_custom_ui` — the fields whose absence is exactly why the document
    /// may not be read in part.
    #[test]
    fn a_literal_version_one_document_reads_as_an_absent_one() {
        let test_root = TestRegistryRoot::create("registry-schema-v1");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let metadata = fs::metadata(&plugin_path).expect("plugin metadata should be readable");
        let size = metadata.len();
        let modified = metadata
            .modified()
            .expect("plugin mtime should be readable")
            .duration_since(UNIX_EPOCH)
            .expect("plugin mtime should be after the unix epoch")
            .as_millis() as u64;
        // Fingerprinted so it would hydrate on every other ground: the file is
        // there, unmodified, inside an authorized root. Only the schema version
        // stops it.
        let document = format!(
            r#"{{"schema_version":1,"entries":{{"aaaa1111":{{"path":{},"stable_id":"aaaa1111","descriptor_id":"com.vendor.reverb","format":"clap","name":"Vendor Reverb","file_size_bytes":{size},"file_modified_ms":{modified}}}}}}}"#,
            serde_json::to_string(&plugin_path.display().to_string())
                .expect("a path should serialize as a JSON string")
        );
        fs::write(test_root.root.join(REGISTRY_FILE_NAME), document)
            .expect("version 1 registry should be written");

        let next_launch_registry = Mutex::new(HashMap::new());
        test_root
            .store()
            .hydrate_into(&next_launch_registry, &test_root.scan_policy());

        assert!(
            next_launch_registry
                .lock()
                .expect("registry lock")
                .is_empty(),
            "a version 1 document has no record of whether its zeros were queried; it must read as absent"
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
        test_root
            .store()
            .persist(&one_row(&outside_path, "aaaa1111"));

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

    /// The defect a wholesale rewrite produced: `persist` rebuilt the document
    /// from the live registry alone, so every row hydration had refused as
    /// stale — deliberately kept as a last known location — was deleted from
    /// disk by the next save. In the shape that matters, a vendor updates a
    /// folder of plugins in place, the user relaunches, activating one of them
    /// re-indexes just that one, and the save that follows takes every other
    /// plugin's last known location with it.
    #[test]
    fn persisting_a_partial_registry_keeps_the_rows_hydration_refused() {
        let test_root = TestRegistryRoot::create("registry-persist-union");
        let fresh_path = test_root.write_plugin_file("Fresh.clap", b"clap-bytes");
        let stale_path = test_root.write_plugin_file("Stale.clap", b"clap-bytes");
        test_root.store().persist(&rows_for(vec![
            ("fresh0001", scanned_plugin(&fresh_path, "fresh0001")),
            ("stale0001", scanned_plugin(&stale_path, "stale0001")),
        ]));
        // Only the second plugin is updated in place, so only its row goes
        // stale: hydration admits one and refuses the other.
        fs::write(&stale_path, b"clap-bytes-version-2").expect("the plugin should be updated");

        let second_launch = test_root.store();
        let registry = Mutex::new(HashMap::new());
        second_launch.hydrate_into(&registry, &test_root.scan_policy());
        assert_eq!(
            registry.lock().expect("registry lock").len(),
            1,
            "the fixture must produce one admitted row and one refused one"
        );
        // The save any activation triggers: only the plugin that resolved is
        // written, and the refused row is not part of it.
        second_launch.persist(&one_row(&fresh_path, "fresh0001"));

        let third_launch = test_root.store();
        third_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        let last_known = third_launch
            .last_known_entry("stale0001")
            .expect("a row refused as stale must survive a save it was not part of");
        assert_eq!(last_known.plugin.path, stale_path.display().to_string());
    }

    /// The other half of the union: a plugin the user actually uninstalled must
    /// not come back out of the file's own copy of it.
    #[test]
    fn persisting_does_not_resurrect_a_row_a_completed_scan_removed() {
        let test_root = TestRegistryRoot::create("registry-persist-removal");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let store = test_root.store();
        store.persist(&one_row(&plugin_path, "aaaa1111"));

        // The scan publisher's retention predicate for a completed scan of the
        // plugin root, run when the scan found nothing there any more.
        let scanned_root = test_root.root.join("plugins");
        store.apply_completed_scan_removals(|path| !path.starts_with(&scanned_root));
        store.persist(&[]);

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        assert!(
            next_launch.last_known_entry("aaaa1111").is_none(),
            "a row a completed scan removed must not be written back from the persisted view"
        );
    }

    #[test]
    fn a_registry_file_with_more_rows_than_a_scan_can_produce_reads_as_absent() {
        let test_root = TestRegistryRoot::create("registry-row-cap");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");
        let mut entries = BTreeMap::new();
        for index in 0..=MAX_REGISTRY_ENTRIES {
            entries.insert(
                format!("key-{index:05}"),
                PersistedPluginEntry {
                    plugin: scanned_plugin(&plugin_path, &format!("key-{index:05}")),
                    bundle_position: 0,
                    file_size_bytes: 10,
                    file_modified_ms: 0,
                },
            );
        }
        fs::write(
            test_root.root.join(REGISTRY_FILE_NAME),
            serde_json::to_vec(&PersistedScanRegistry {
                schema_version: SCAN_REGISTRY_SCHEMA_VERSION,
                entries,
                quarantine: BTreeMap::new(),
            })
            .expect("the oversized registry should serialize"),
        )
        .expect("the oversized registry should be written");

        let store = test_root.store();
        store.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());

        assert!(
            store.last_known_entry("key-00000").is_none(),
            "a document past the row cap must be read as absent, not in part"
        );
    }

    /// A document is refused for its byte count, and the count is the reader's
    /// own rather than anything the filesystem declared. Both edges are pinned
    /// because only the pair distinguishes a bound from an absence of one: a
    /// reader with no count at all admits the oversized document, and a reader
    /// that miscounts by one refuses the largest legal one at every launch.
    ///
    /// Bounded here rather than at [`MAX_REGISTRY_FILE_BYTES`] because the real
    /// bound is two gigabytes, and a spec that materialised two gigabytes to
    /// watch them be refused would cost more than the defect.
    /// `the_byte_bound_admits_a_registry_full_of_maximal_rows` pins the
    /// production number itself.
    ///
    /// Mutation this catches: dropping the byte count and letting the parse
    /// decide, which reads the whole document and reports it as parsed.
    #[test]
    fn a_document_read_past_the_byte_bound_is_refused_rather_than_parsed() {
        let document = br#"{"schema_version":5,"entries":{},"quarantine":{}}"#;
        let document_bytes = document.len() as u64;

        assert!(
            matches!(
                read_within_byte_bound::<PersistedScanRegistry>(&document[..], document_bytes - 1),
                BoundedRead::PastByteBound
            ),
            "a document one byte past the bound must be refused for its size, \
             not accepted because it happened to parse"
        );
        assert!(
            matches!(
                read_within_byte_bound::<PersistedScanRegistry>(&document[..], document_bytes),
                BoundedRead::Parsed(_)
            ),
            "a document exactly at the bound is the largest legal one and must parse"
        );
    }

    /// The bound has to hold against a file whose declared length is a lie —
    /// a registry replaced by a symlink to a character device declares zero and
    /// then reads forever.
    #[cfg(unix)]
    #[test]
    fn a_registry_symlinked_to_an_endless_device_does_not_read_endlessly() {
        let test_root = TestRegistryRoot::create("registry-endless");
        let location = test_root.root.join(REGISTRY_FILE_NAME);
        std::os::unix::fs::symlink("/dev/zero", &location)
            .expect("the endless-device symlink should be created");

        assert!(
            read_registry_document(&location).is_none(),
            "an endless read must be refused by the bound, not followed"
        );
    }

    /// A `.vst3` bundle as CoreFoundation reads one: the executables under
    /// `Contents/MacOS`, and an `Info.plist` naming which of them is the
    /// bundle's own when `declared_executable` is given.
    #[cfg(target_os = "macos")]
    fn write_vst3_bundle(
        root: &Path,
        bundle_name: &str,
        declared_executable: Option<&str>,
        executables: &[&str],
    ) -> PathBuf {
        let bundle = root.join(bundle_name);
        let executable_directory = bundle.join("Contents").join("MacOS");
        fs::create_dir_all(&executable_directory)
            .expect("the bundle's executable directory should be created");
        for executable in executables {
            fs::write(executable_directory.join(executable), b"mach-o")
                .expect("a bundle executable should be written");
        }
        if let Some(declared) = declared_executable {
            fs::write(
                bundle.join("Contents").join("Info.plist"),
                format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>{declared}</string>
    <key>CFBundleIdentifier</key>
    <string>com.sourdaw.test.{declared}</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
</dict>
</plist>
"#
                ),
            )
            .expect("the bundle's Info.plist should be written");
        }
        bundle
    }

    /// The fingerprint has to follow the file the loader opens, and on macOS
    /// that file is whichever one the plist names. A vendor is free to ship
    /// `Contents/MacOS/Vendor` beside a stem-named stub, and fingerprinting the
    /// stub reads an update to the real module as no change at all — so the
    /// plugin is never rescanned and the stale row is reused forever.
    ///
    /// Mutation this catches: resolving the stem-named path first, which is
    /// what this did before the plist was read.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_macos_bundle_resolves_the_executable_its_plist_names() {
        let test_root = TestRegistryRoot::create("registry-macos-plist-executable");
        let bundle = write_vst3_bundle(
            &test_root.root.join("plugins"),
            "Reverb.vst3",
            Some("Renamed"),
            &["Renamed", "Reverb"],
        );

        assert_eq!(
            vst3_bundle_binary_location(&bundle),
            Some(bundle.join("Contents").join("MacOS").join("Renamed")),
            "the executable the bundle declares wins over the conventional name, \
             even when the conventional name is there"
        );
    }

    /// A bundle with no `Info.plist` still resolves. CoreFoundation falls back
    /// to the bundle's own name here exactly as the convention does, so this
    /// pins the answer rather than the route to it: a resolver that stopped
    /// answering for a plist-less bundle would leave it unfingerprintable, and
    /// its rows would never be reused again.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_macos_bundle_with_no_plist_resolves_the_stem_named_executable() {
        let test_root = TestRegistryRoot::create("registry-macos-no-plist");
        let bundle = write_vst3_bundle(
            &test_root.root.join("plugins"),
            "Reverb.vst3",
            None,
            &["Reverb"],
        );

        assert_eq!(
            vst3_bundle_binary_location(&bundle),
            Some(bundle.join("Contents").join("MacOS").join("Reverb")),
            "a bundle with no declared executable still resolves by convention"
        );
    }

    /// Neither the plist nor the convention answers here: there is no plist to
    /// read, and the file in `Contents/MacOS` is not named after the bundle.
    /// The directory itself is the last answer, and it is the one CoreFoundation
    /// would have opened — dropping it fingerprints the bundle directory
    /// instead, which does not move when the module inside it is rewritten, so
    /// an updated plugin reads as unchanged forever.
    ///
    /// Mutation this catches: resolving through the declared and conventional
    /// paths alone.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_macos_bundle_naming_neither_executable_resolves_the_file_that_is_there() {
        let test_root = TestRegistryRoot::create("registry-macos-unconventional");
        let bundle = write_vst3_bundle(
            &test_root.root.join("plugins"),
            "Reverb.vst3",
            None,
            &["Actual"],
        );

        assert_eq!(
            vst3_bundle_binary_location(&bundle),
            Some(bundle.join("Contents").join("MacOS").join("Actual")),
            "the only regular file in Contents/MacOS is the only module there is"
        );
    }

    /// One rescan per key per process. Without the record, every activation
    /// that misses spawns its own scan-worker child — and the frontend
    /// re-activates a project's devices on every transport start.
    #[test]
    fn a_key_already_refused_this_process_is_not_rescanned_again() {
        let store = PluginRegistryStore::in_memory_only();

        let RescanClaim::Granted(attempt) = store.claim_rescan("aaaa1111") else {
            panic!("the first caller must be granted the attempt");
        };
        attempt.refuse("Plugin 'Vendor Reverb' is gone".to_string());

        let RescanClaim::Refused(reason) = store.claim_rescan("aaaa1111") else {
            panic!("a key refused this process must answer from the record");
        };
        assert_eq!(reason, "Plugin 'Vendor Reverb' is gone");
    }

    /// A completed scan is a fresh look at the same disk: a plugin that was
    /// missing before it ran must not keep answering from the older verdict.
    #[test]
    fn a_completed_scan_clears_a_recorded_refusal() {
        let store = PluginRegistryStore::in_memory_only();
        let RescanClaim::Granted(attempt) = store.claim_rescan("aaaa1111") else {
            panic!("the first caller must be granted the attempt");
        };
        attempt.refuse("Plugin 'Vendor Reverb' is gone".to_string());

        store.apply_completed_scan_removals(|_| true);

        assert!(
            matches!(store.claim_rescan("aaaa1111"), RescanClaim::Granted(_)),
            "a scan that has run since the refusal must let the key be resolved again"
        );
    }

    /// A rescan that unwound without settling — a panicking worker, an early
    /// return — must not leave a marker nothing can clear, because that key
    /// would then refuse for the rest of the process.
    #[test]
    fn an_attempt_dropped_without_an_outcome_leaves_the_key_claimable() {
        let store = PluginRegistryStore::in_memory_only();
        {
            let RescanClaim::Granted(attempt) = store.claim_rescan("aaaa1111") else {
                panic!("the first caller must be granted the attempt");
            };
            assert!(matches!(
                store.claim_rescan("aaaa1111"),
                RescanClaim::InProgress
            ));
            drop(attempt);
        }

        assert!(matches!(
            store.claim_rescan("aaaa1111"),
            RescanClaim::Granted(_)
        ));
    }

    /// AC-001: a quarantine recorded and persisted in one process must survive
    /// into the next one, the same way a scanned entry does.
    #[test]
    fn a_persisted_quarantine_survives_reload() {
        let test_root = TestRegistryRoot::create("registry-quarantine-reload");
        let plugin_path = test_root.write_plugin_file("Hostile.clap", b"clap-bytes");
        let store = test_root.store();
        store.quarantine_failure(
            &plugin_path,
            "Plugin scan helper exited unsuccessfully for Hostile.clap".to_string(),
            1_700_000_000_000,
        );
        store.persist(&[]);

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());

        let quarantined = next_launch
            .is_quarantined(&plugin_path)
            .expect("the quarantine record must survive a reload");
        assert_eq!(quarantined.path, plugin_path.display().to_string());
        assert_eq!(
            quarantined.reason,
            "Plugin scan helper exited unsuccessfully for Hostile.clap"
        );
        assert_eq!(quarantined.quarantined_at_ms, 1_700_000_000_000);
    }

    /// A clean scan of a healthy set must not carry a stray quarantine record
    /// through `persist`'s union: clearing it in memory and persisting must
    /// remove it from the file, not just from this process's view.
    #[test]
    fn clearing_a_quarantine_and_persisting_removes_it_from_disk() {
        let test_root = TestRegistryRoot::create("registry-quarantine-clear");
        let plugin_path = test_root.write_plugin_file("Recovered.clap", b"clap-bytes");
        let store = test_root.store();
        store.quarantine_failure(&plugin_path, "Plugin scan helper timed out".to_string(), 1);
        store.persist(&[]);

        store.clear_quarantine(&plugin_path);
        store.persist(&[]);

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        assert!(
            next_launch.is_quarantined(&plugin_path).is_none(),
            "a cleared quarantine must not survive its own persist"
        );
    }

    /// The scan runs in a forked process with its own store while the main
    /// process persists on its own paths (a targeted rescan, another scan) —
    /// two writers over the same file is the normal topology, not an edge
    /// case. A store that never itself decided about a key must not erase a
    /// sibling's quarantine of that key merely by persisting something else.
    #[test]
    fn a_sibling_processs_quarantine_survives_a_persist_that_never_touched_it() {
        let test_root = TestRegistryRoot::create("registry-quarantine-cross-process");
        let plugin_path = test_root.write_plugin_file("Hostile.clap", b"clap-bytes");

        // Store A: the main process, hydrated before the scan process ever
        // quarantines anything.
        let store_a = test_root.store();
        store_a.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());

        // Store B: the forked scan process, with its own in-memory state,
        // quarantines the binary and persists.
        let store_b = test_root.store();
        store_b.quarantine_failure(
            &plugin_path,
            "Plugin scan helper exited unsuccessfully for Hostile.clap".to_string(),
            1_700_000_000_000,
        );
        store_b.persist(&[]);

        // Store A persists next, having never touched the quarantine column
        // at all. A straight replace with A's stale in-memory copy (empty)
        // would erase B's row here.
        store_a.persist(&[]);

        // Store C: a fresh launch, must still see the row B wrote.
        let store_c = test_root.store();
        store_c.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        let quarantined = store_c
            .is_quarantined(&plugin_path)
            .expect("a persist from a store that never touched the key must not erase it");
        assert_eq!(quarantined.path, plugin_path.display().to_string());
    }

    /// A sibling's quarantine record must not depend on this build's ability to
    /// read the sibling's rows. The two columns fail independently — a row
    /// shape from a newer build, or one file corruption — and reading the whole
    /// document to reach one column ties them together: the parse fails, the
    /// column reads as empty, and the persist writes that emptiness back,
    /// un-quarantining a binary whose scan helper crashed.
    ///
    /// Mutation this catches: reaching the quarantine column through
    /// `read_registry_document` again.
    #[test]
    fn a_persist_keeps_a_siblings_quarantine_when_the_entries_column_is_unreadable() {
        let test_root = TestRegistryRoot::create("registry-quarantine-unreadable-entries");
        let plugin_path = test_root.write_plugin_file("Hostile.clap", b"clap-bytes");
        let quarantined_key = plugin_path.display().to_string();

        // A row of the wrong shape: `bundle_position` is a number in every
        // document this build writes, so the whole document fails to
        // deserialize while staying valid JSON.
        let unreadable = format!(
            r#"{{"schema_version":{SCAN_REGISTRY_SCHEMA_VERSION},
                "entries":{{"aaaa1111":{{"bundle_position":"first"}}}},
                "quarantine":{{{key}:{{"path":{key},
                    "reason":"Plugin scan helper exited unsuccessfully for Hostile.clap",
                    "quarantined_at_ms":1700000000000}}}}}}"#,
            key = serde_json::to_string(&quarantined_key)
                .expect("a path should serialize as a JSON string"),
        );
        let location = test_root.root.join(REGISTRY_FILE_NAME);
        fs::write(&location, unreadable).expect("the fixture document should be written");
        assert!(
            read_registry_document(&location).is_none(),
            "the fixture must be a document this build cannot read whole, or it \
             proves nothing about reading one column out of one it cannot"
        );

        // A store that has decided nothing about the quarantine column, doing
        // the one thing that rewrites the file.
        test_root.store().persist(&[]);

        let next_launch = test_root.store();
        next_launch.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        let quarantined = next_launch
            .is_quarantined(&plugin_path)
            .expect("a quarantine beside an unreadable entries column must survive the persist");
        assert_eq!(quarantined.path, quarantined_key);
    }

    /// The inverse of the cross-process survival guarantee: a writer's own
    /// clear of a key must still win even when another store's intervening,
    /// untouched persist re-reads and re-writes the very file the clear will
    /// later overlay.
    #[test]
    fn a_clear_by_the_writer_that_owns_it_stays_cleared_across_an_intervening_persist() {
        let test_root = TestRegistryRoot::create("registry-quarantine-cross-process-clear");
        let plugin_path = test_root.write_plugin_file("Recovered.clap", b"clap-bytes");

        // Store A quarantines and persists first, so there is a row on disk.
        let store_a = test_root.store();
        store_a.quarantine_failure(&plugin_path, "Plugin scan helper timed out".to_string(), 1);
        store_a.persist(&[]);

        // Store B hydrates, sees the row, and decides to clear it — but has
        // not persisted that decision yet.
        let store_b = test_root.store();
        store_b.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        store_b.clear_quarantine(&plugin_path);

        // Store A persists again in between, having never touched the key
        // itself: this must be a no-op for the quarantine column, leaving the
        // row exactly as B is about to find it.
        store_a.persist(&[]);

        // Store B's persist must still remove the row, not resurrect it from
        // A's untouched re-write.
        store_b.persist(&[]);

        let store_c = test_root.store();
        store_c.hydrate_into(&Mutex::new(HashMap::new()), &test_root.scan_policy());
        assert!(
            store_c.is_quarantined(&plugin_path).is_none(),
            "the owning writer's clear must survive an intervening untouched persist"
        );
    }

    /// `apply_quarantine_removals` only drops a row when the caller's
    /// predicate says so — the caller decides what "gone" means, and this
    /// store does not substitute its own opinion.
    #[test]
    fn apply_quarantine_removals_keeps_rows_the_predicate_keeps() {
        let store = PluginRegistryStore::in_memory_only();
        let quarantined_path = Path::new("/plugins/Broken.clap");
        store.quarantine_failure(
            quarantined_path,
            "Plugin scan helper timed out".to_string(),
            1,
        );

        store.apply_quarantine_removals(|_| true);
        assert!(
            store.is_quarantined(quarantined_path).is_some(),
            "a predicate that keeps every row must not lose one"
        );

        store.apply_quarantine_removals(|_| false);
        assert!(
            store.is_quarantined(quarantined_path).is_none(),
            "a predicate that keeps nothing must clear the row"
        );
    }

    /// The largest parameter contract the scanner will emit, at its own caps:
    /// 256 descriptors (`MAX_SCANNED_PARAMETER_DESCRIPTORS`) whose names and
    /// modules are each 128 bytes (`MAX_SCANNED_PARAMETER_NAME_BYTES`). Both
    /// are private to the scanner, so they are spelled out here; the assertion
    /// they feed is an upper bound, and over-stating them only makes it safer.
    fn maximal_scanned_plugin(path: &Path) -> ScannedPlugin {
        let filler = "p".repeat(128);
        let mut plugin = scanned_plugin(path, "aaaa1111");
        plugin.num_parameters = 256;
        plugin.parameters = Some(
            (0..256)
                .map(|id| ScannedParameterDescriptor {
                    id,
                    name: filler.clone(),
                    module: Some(filler.clone()),
                    min_value: f64::MIN,
                    max_value: f64::MAX,
                    default_value: 0.0,
                    is_automatable: true,
                    is_modulatable: true,
                    is_stepped: true,
                    is_enum: true,
                })
                .collect(),
        );
        plugin.capability_metadata_reason = Some(filler);
        plugin
    }

    /// The row now carries the scan's whole answer rather than the few columns
    /// activation reads, so the byte bound is no longer a round number with
    /// slack in it — it is a number the row size decides. A bound the largest
    /// legal registry exceeds is not a limit but a permanent refusal: every
    /// launch reads the file, rejects it, and the user's only recovery is
    /// deleting it by hand.
    ///
    /// Mutation this catches: shrinking `MAX_REGISTRY_FILE_BYTES`, or growing
    /// the persisted row without revisiting the bound.
    #[test]
    fn the_byte_bound_admits_a_registry_full_of_maximal_rows() {
        let entry = PersistedPluginEntry {
            plugin: maximal_scanned_plugin(Path::new("/plugins/Reverb.clap")),
            bundle_position: 0,
            file_size_bytes: u64::MAX,
            file_modified_ms: u64::MAX,
        };
        let row_bytes = serde_json::to_vec(&entry)
            .expect("a persisted row should serialize")
            .len() as u64;

        let largest_document = MAX_REGISTRY_ENTRIES as u64 * row_bytes;
        assert!(
            largest_document <= MAX_REGISTRY_FILE_BYTES,
            "the byte bound must admit the largest registry a scan can write: \
             {MAX_REGISTRY_ENTRIES} rows of {row_bytes} bytes is {largest_document}, \
             over a bound of {MAX_REGISTRY_FILE_BYTES}"
        );
    }

    #[test]
    fn a_store_with_no_file_neither_reads_nor_writes() {
        let test_root = TestRegistryRoot::create("registry-in-memory");
        let plugin_path = test_root.write_plugin_file("Reverb.clap", b"clap-bytes");

        let store = PluginRegistryStore::in_memory_only();
        store.persist(&one_row(&plugin_path, "aaaa1111"));
        let registry = Mutex::new(HashMap::new());
        store.hydrate_into(&registry, &test_root.scan_policy());

        assert!(registry.lock().expect("registry lock").is_empty());
        assert!(store.last_known_entry("aaaa1111").is_none());
    }
}
