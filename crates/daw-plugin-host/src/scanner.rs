use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use libloading::Library;
use std::ffi::{CStr, CString};

/// Metadata extracted from a single plugin bundle on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedPlugin {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub format: String,
    pub category: String,
    pub path: String,
    pub version: String,
    /// The CLAP descriptor's own id — stable across installs and versions,
    /// unlike `id`, which is a hash of the current file path. Empty for formats
    /// that carry no CLAP descriptor.
    pub clap_id: String,
    pub num_inputs: u32,
    pub num_outputs: u32,
    pub num_parameters: u32,
    pub has_custom_ui: bool,
}

/// What a CLAP plugin's own descriptor says about it.
///
/// Read once per plugin during the scan. Everything here is free — the
/// descriptor is already in hand — which is the point: it used to be read,
/// partly used, and thrown away, and then read a second time by the caller that
/// wanted the id.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClapDescriptorMetadata {
    pub vendor: String,
    pub id: String,
    pub version: String,
    pub features: Vec<String>,
}

/// Map a CLAP feature list onto the category string the UI routes on.
///
/// Routing is the reason this exists: the plugin browser sends anything
/// categorised `instrument` down a different path from an effect, so reporting
/// every plugin as an effect puts instruments in the wrong place.
///
/// `instrument` wins over any co-listed effect feature, because a plugin that
/// both synthesises and processes is an instrument as far as routing goes. The
/// synthesizer/sampler/drum sub-features are accepted on their own: the spec
/// lists `instrument` as the primary category, but plugins in the wild ship the
/// sub-feature alone. Anything unrecognised stays `effect`, which is the answer
/// the previous hardcode gave, so no existing behaviour changes.
pub fn category_from_clap_features(features: &[String]) -> String {
    let has = |needle: &str| features.iter().any(|feature| feature == needle);

    if has("instrument") || has("synthesizer") || has("sampler") || has("drum") || has("drum-machine")
    {
        return "instrument".to_string();
    }
    if has("note-effect") || has("note-detector") {
        return "note-effect".to_string();
    }
    if has("analyzer") {
        return "analyzer".to_string();
    }
    "effect".to_string()
}

/// Aggregate result from scanning one or more directories.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub plugins: Vec<ScannedPlugin>,
    pub errors: Vec<String>,
    pub scan_duration_ms: u64,
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Compute a stable, version-independent ID for a plugin path.
/// Uses the first 8 bytes of SHA-256 of the canonical path string.
/// Safe to persist in project files — deterministic across Rust versions and builds.
pub fn stable_id(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    format!(
        "{:016x}",
        u64::from_be_bytes(digest[..8].try_into().expect("sha256 is 32 bytes"))
    )
}

fn detect_format(path: &Path, is_dir: bool) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    match (ext, is_dir) {
        ("vst3", true) => Some("vst3"),
        ("clap", false) => Some("clap"),
        ("component", true) => Some("au"),
        _ => None,
    }
}

fn plugin_name_from_path(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown".to_string())
}

// ── Directory scanning ──────────────────────────────────────────────────

pub fn scan_directory(dir: &Path, plugins: &mut Vec<ScannedPlugin>, errors: &mut Vec<String>) {
    match path_has_symlink_component(dir) {
        Ok(true) => {
            errors.push(format!("Skipping symlinked plugin path: {}", dir.display()));
            return;
        }
        Ok(false) => {}
        Err(error) => {
            errors.push(error);
            return;
        }
    }

    let dir_metadata = match fs::symlink_metadata(dir) {
        Ok(metadata) => metadata,
        Err(e) => {
            errors.push(format!("Cannot inspect {}: {}", dir.display(), e));
            return;
        }
    };

    if dir_metadata.file_type().is_symlink() {
        errors.push(format!("Skipping symlinked plugin path: {}", dir.display()));
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            errors.push(format!("Cannot read {}: {}", dir.display(), e));
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("Error reading entry in {}: {}", dir.display(), e));
                continue;
            }
        };

        let entry_path = entry.path();
        let entry_metadata = match fs::symlink_metadata(&entry_path) {
            Ok(metadata) => metadata,
            Err(e) => {
                errors.push(format!("Cannot inspect {}: {}", entry_path.display(), e));
                continue;
            }
        };

        if entry_metadata.file_type().is_symlink() {
            errors.push(format!(
                "Skipping symlinked plugin path: {}",
                entry_path.display()
            ));
            continue;
        }

        let is_dir = entry_metadata.is_dir();

        if let Some(format) = detect_format(&entry_path, is_dir) {
            let name = plugin_name_from_path(&entry_path);

            // Only CLAP exposes a descriptor without instantiating the plugin.
            // VST3 and AU would each need their own bundle reader; until then
            // they keep the filename-derived name and an empty vendor rather
            // than inventing values.
            let descriptor = if format == "clap" {
                extract_clap_metadata(&entry_path)
            } else {
                ClapDescriptorMetadata::default()
            };

            let category = if format == "clap" {
                category_from_clap_features(&descriptor.features)
            } else {
                "effect".to_string()
            };

            plugins.push(ScannedPlugin {
                id: stable_id(&entry_path),
                name,
                vendor: descriptor.vendor,
                format: format.to_string(),
                category,
                path: entry_path.to_string_lossy().into_owned(),
                version: descriptor.version,
                clap_id: descriptor.id,
                // Port and parameter counts are per-instance in CLAP: reading
                // them means creating the plugin, which scanning must not do.
                // They stay at these placeholders, and nothing should present
                // them as measured facts.
                num_inputs: 2,
                num_outputs: 2,
                num_parameters: 0,
                has_custom_ui: true,
            });
        } else if is_dir {
            scan_directory(&entry_path, plugins, errors);
        }
    }
}

fn path_has_symlink_component(path: &Path) -> Result<bool, String> {
    let mut current_path = std::path::PathBuf::new();

    for component in path.components() {
        current_path.push(component.as_os_str());
        match fs::symlink_metadata(&current_path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Ok(true);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => {
                return Err(format!(
                    "Cannot inspect {}: {}",
                    current_path.display(),
                    error
                ));
            }
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[cfg(unix)]
    fn unique_temp_scan_root(test_name: &str) -> PathBuf {
        let unique_suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "sourdaw-{test_name}-{}-{unique_suffix}",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn scan_directory_skips_symlinked_plugin_paths() {
        let temp_root = unique_temp_scan_root("scanner-symlink-plugin");
        let scan_root = temp_root.join("scan-root");
        let outside_root = temp_root.join("outside");
        let outside_plugin = outside_root.join("escape.clap");
        let symlinked_plugin = scan_root.join("escape.clap");
        std::fs::create_dir_all(&scan_root).expect("scan root should be created");
        std::fs::create_dir_all(&outside_root).expect("outside root should be created");
        std::fs::write(&outside_plugin, b"not a real clap plugin")
            .expect("outside plugin placeholder should be written");
        std::os::unix::fs::symlink(&outside_plugin, &symlinked_plugin)
            .expect("symlink should be created");

        let mut plugins = Vec::new();
        let mut errors = Vec::new();
        scan_directory(&scan_root, &mut plugins, &mut errors);
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(
            plugins.is_empty(),
            "scanner must not register symlinked plugin paths: {plugins:?}"
        );
        assert!(
            errors
                .iter()
                .any(|error| error.contains("Skipping symlinked plugin path")),
            "expected symlink skip error, got {errors:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn scan_directory_skips_scan_roots_with_symlink_ancestors() {
        let temp_root = unique_temp_scan_root("scanner-symlink-root");
        let symlinked_scan_root = temp_root.join("scan-root");
        let outside_root = temp_root.join("outside");
        let outside_child = outside_root.join("Vendor");
        let outside_plugin = outside_child.join("escape.clap");
        std::fs::create_dir_all(&outside_child).expect("outside child should be created");
        std::fs::write(&outside_plugin, b"not a real clap plugin")
            .expect("outside plugin placeholder should be written");
        std::os::unix::fs::symlink(&outside_root, &symlinked_scan_root)
            .expect("scan root symlink should be created");

        let mut plugins = Vec::new();
        let mut errors = Vec::new();
        scan_directory(
            &symlinked_scan_root.join("Vendor"),
            &mut plugins,
            &mut errors,
        );
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(
            plugins.is_empty(),
            "scanner must not register plugins below symlinked scan roots: {plugins:?}"
        );
        assert!(
            errors
                .iter()
                .any(|error| error.contains("Skipping symlinked plugin path")),
            "expected symlink skip error, got {errors:?}"
        );
    }

    // ── Category derived from CLAP features ─────────────────────────────
    //
    // Every scanned plugin used to be reported as an "effect". The plugin
    // browser routes on that string — an instrument added as an effect lands in
    // the wrong place — and the descriptor that answers the question was already
    // being read and thrown away.

    fn features(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn an_instrument_is_categorised_as_an_instrument_not_an_effect() {
        assert_eq!(
            category_from_clap_features(&features(&["instrument", "synthesizer", "stereo"])),
            "instrument"
        );
    }

    #[test]
    fn a_synthesizer_or_sampler_without_the_instrument_feature_still_reads_as_one() {
        // The spec lists `instrument` as the primary category, but plugins in
        // the wild ship the sub-feature alone. Routing on it is still correct.
        assert_eq!(category_from_clap_features(&features(&["synthesizer"])), "instrument");
        assert_eq!(category_from_clap_features(&features(&["sampler", "stereo"])), "instrument");
        assert_eq!(category_from_clap_features(&features(&["drum-machine"])), "instrument");
    }

    #[test]
    fn a_note_effect_is_not_an_audio_effect() {
        // An arpeggiator takes notes and emits notes; sending it down an audio
        // chain is the wrong routing decision.
        assert_eq!(category_from_clap_features(&features(&["note-effect"])), "note-effect");
    }

    #[test]
    fn an_analyzer_is_reported_as_an_analyzer() {
        assert_eq!(category_from_clap_features(&features(&["analyzer", "stereo"])), "analyzer");
    }

    #[test]
    fn an_audio_effect_and_an_unlabelled_plugin_both_read_as_effect() {
        assert_eq!(
            category_from_clap_features(&features(&["audio-effect", "reverb"])),
            "effect"
        );
        // No features at all: "effect" is the safe default, and it is the same
        // answer the old hardcode gave, so nothing regresses.
        assert_eq!(category_from_clap_features(&[]), "effect");
    }

    #[test]
    fn instrument_wins_over_a_co_listed_effect_feature() {
        // Plugins that both synthesise and process list several categories.
        // Instrument is the routing-relevant one.
        assert_eq!(
            category_from_clap_features(&features(&["audio-effect", "instrument"])),
            "instrument"
        );
    }
}

// ── CLAP metadata extraction ────────────────────────────────────────────

/// Load a CLAP plugin temporarily to read its descriptor.
///
/// Returns everything the descriptor carries in one pass. It used to return
/// only vendor and id, and the caller that wanted the id `dlopen`ed the plugin a
/// second time to get it — so every CLAP was loaded, init'd and deinit'd twice
/// per scan.
///
/// # Safety
/// Calls into native CLAP plugin entry points.
pub fn extract_clap_metadata(path: &Path) -> ClapDescriptorMetadata {
    unsafe {
        let lib = match Library::new(path) {
            Ok(l) => l,
            Err(_) => return ClapDescriptorMetadata::default(),
        };

        let entry: libloading::Symbol<*const clap_plugin_entry> = match lib.get(b"clap_entry\0") {
            Ok(s) => s,
            Err(_) => return ClapDescriptorMetadata::default(),
        };

        let entry_ptr = *entry;
        if entry_ptr.is_null() {
            return ClapDescriptorMetadata::default();
        }

        let entry_ref = &*entry_ptr;

        let path_c = match CString::new(path.to_string_lossy().as_bytes()) {
            Ok(c) => c,
            Err(_) => return ClapDescriptorMetadata::default(),
        };

        if let Some(init_fn) = entry_ref.init {
            if !init_fn(path_c.as_ptr()) {
                return ClapDescriptorMetadata::default();
            }
        }

        let result = extract_from_factory(entry_ref);

        if let Some(deinit) = entry_ref.deinit {
            deinit();
        }

        result
    }
}

/// Read a C string that may be null, as an owned `String`.
unsafe fn owned_c_string(value: *const i8) -> String {
    if value.is_null() {
        return String::new();
    }
    CStr::from_ptr(value).to_string_lossy().into_owned()
}

/// Read the CLAP feature list, a null-terminated array of C strings.
///
/// A null array pointer means the plugin declared no features, which is legal
/// and reads as an empty list rather than as an error.
unsafe fn owned_feature_list(features: *const *const i8) -> Vec<String> {
    if features.is_null() {
        return Vec::new();
    }

    let mut collected = Vec::new();
    let mut index = 0;
    loop {
        let feature = *features.add(index);
        if feature.is_null() {
            break;
        }
        collected.push(CStr::from_ptr(feature).to_string_lossy().into_owned());
        index += 1;
    }
    collected
}

/// Read the descriptor of the factory's first plugin. Called with the entry
/// already init'd — the caller is responsible for deinit.
unsafe fn extract_from_factory(entry_ref: &clap_plugin_entry) -> ClapDescriptorMetadata {
    let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
    let factory_ptr = match entry_ref.get_factory {
        Some(f) => f(factory_id),
        None => return ClapDescriptorMetadata::default(),
    };

    if factory_ptr.is_null() {
        return ClapDescriptorMetadata::default();
    }

    let factory = &*(factory_ptr as *const clap_plugin_factory);

    let count = match factory.get_plugin_count {
        Some(f) => f(factory),
        None => return ClapDescriptorMetadata::default(),
    };

    if count == 0 {
        return ClapDescriptorMetadata::default();
    }

    let get_desc = match factory.get_plugin_descriptor {
        Some(f) => f,
        None => return ClapDescriptorMetadata::default(),
    };

    let desc = get_desc(factory, 0);
    if desc.is_null() {
        return ClapDescriptorMetadata::default();
    }

    let desc_ref = &*desc;
    ClapDescriptorMetadata {
        vendor: owned_c_string(desc_ref.vendor),
        id: owned_c_string(desc_ref.id),
        version: owned_c_string(desc_ref.version),
        features: owned_feature_list(desc_ref.features),
    }
}
