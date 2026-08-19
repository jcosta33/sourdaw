//! Single owner of the application data-directory name.
//!
//! The shipped bundle identifier is `com.sourdaw.daw` (`src-tauri/tauri.conf.json`),
//! but the native bodies historically wrote under `com.sourdaw.app`, so models and
//! native file roots lived under a different bundle id than the app. `APP_DIR_NAME`
//! is the one definition every native call site shares, and `resolve_app_dir` is the
//! migration seam: the first resolution that finds only the legacy directory renames
//! it (same parent, so the rename is atomic and free), instead of orphaning multi-GB
//! model caches and forcing a re-download.

use std::path::{Path, PathBuf};

/// Application directory name, aligned with the bundle `identifier` in
/// `src-tauri/tauri.conf.json`. Diverging the two splits the on-disk state the
/// moment any path is resolved through Tauri's path API.
pub const APP_DIR_NAME: &str = "com.sourdaw.daw";

/// The pre-alignment directory name. Read only by the one-time migration below.
const LEGACY_APP_DIR_NAME: &str = "com.sourdaw.app";

/// Resolve the app-owned directory under `base`, migrating a legacy directory.
///
/// - Legacy exists and the aligned directory does not: rename legacy to the
///   aligned name and return it. The rename happens at most once — afterwards
///   the legacy path no longer exists, so re-resolution is a pure join.
/// - Both exist: prefer the aligned directory and leave the legacy untouched.
/// - Rename fails while the aligned directory is still absent: fall back to
///   the legacy path so existing model caches stay reachable.
pub fn resolve_app_dir(base: &Path) -> PathBuf {
    let current = base.join(APP_DIR_NAME);
    let legacy = base.join(LEGACY_APP_DIR_NAME);
    if current.exists() || !legacy.exists() {
        return current;
    }
    match std::fs::rename(&legacy, &current) {
        Ok(()) => current,
        Err(error) => {
            eprintln!(
                "[AppDirs] Failed to migrate {} to {}: {error}",
                legacy.display(),
                current.display()
            );
            legacy
        }
    }
}

/// The app data directory (`dirs::data_dir()` + `APP_DIR_NAME`), post-migration.
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|base| resolve_app_dir(&base))
}

/// The app cache directory (`dirs::cache_dir()` + `APP_DIR_NAME`), post-migration.
pub fn app_cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|base| resolve_app_dir(&base))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A unique, empty base directory per test, injected as the resolution base
    /// so the seam is exercised without touching the real user data dir.
    fn scratch_base(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let base = std::env::temp_dir().join(format!(
            "sourdaw_app_dirs_{tag}_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&base).expect("scratch base must be creatable");
        base
    }

    fn write_marker(dir: &Path, name: &str, contents: &str) {
        std::fs::create_dir_all(dir).expect("marker dir must be creatable");
        std::fs::write(dir.join(name), contents).expect("marker must be writable");
    }

    fn read_marker(dir: &Path, name: &str) -> Option<String> {
        std::fs::read_to_string(dir.join(name)).ok()
    }

    #[test]
    fn migrates_legacy_dir_by_rename_when_aligned_dir_is_absent() {
        let base = scratch_base("migrate");
        write_marker(&base.join(LEGACY_APP_DIR_NAME), "model.bin", "weights");

        let resolved = resolve_app_dir(&base);

        assert_eq!(resolved, base.join(APP_DIR_NAME));
        assert_eq!(
            read_marker(&resolved, "model.bin").as_deref(),
            Some("weights")
        );
        assert!(
            !base.join(LEGACY_APP_DIR_NAME).exists(),
            "rename must move, not copy, the legacy directory"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migration_happens_once_and_re_resolution_is_idempotent() {
        let base = scratch_base("idempotent");
        write_marker(&base.join(LEGACY_APP_DIR_NAME), "model.bin", "weights");

        let first = resolve_app_dir(&base);
        let second = resolve_app_dir(&base);

        assert_eq!(first, second);
        assert_eq!(
            read_marker(&second, "model.bin").as_deref(),
            Some("weights")
        );
        assert!(
            !base.join(LEGACY_APP_DIR_NAME).exists(),
            "a second resolution must find nothing left to migrate"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn both_existing_prefers_aligned_dir_and_leaves_legacy_untouched() {
        let base = scratch_base("both");
        write_marker(&base.join(LEGACY_APP_DIR_NAME), "marker.txt", "legacy");
        write_marker(&base.join(APP_DIR_NAME), "marker.txt", "aligned");

        let resolved = resolve_app_dir(&base);

        assert_eq!(resolved, base.join(APP_DIR_NAME));
        assert_eq!(
            read_marker(&resolved, "marker.txt").as_deref(),
            Some("aligned")
        );
        assert_eq!(
            read_marker(&base.join(LEGACY_APP_DIR_NAME), "marker.txt").as_deref(),
            Some("legacy"),
            "an existing aligned directory must leave the legacy directory untouched"
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn absent_dirs_resolve_to_the_aligned_name_without_creating_anything() {
        let base = scratch_base("absent");

        let resolved = resolve_app_dir(&base);

        assert_eq!(resolved, base.join(APP_DIR_NAME));
        assert!(!resolved.exists());
        assert!(!base.join(LEGACY_APP_DIR_NAME).exists());

        std::fs::remove_dir_all(&base).ok();
    }
}
