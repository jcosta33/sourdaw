use crate::clap_host::create_host_descriptor;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::mem;
use std::path::{Path, PathBuf};
use std::time::Instant;

use clap_sys::entry::clap_plugin_entry;
use clap_sys::ext::params::{
    clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
    CLAP_PARAM_IS_ENUM, CLAP_PARAM_IS_MODULATABLE, CLAP_PARAM_IS_READONLY, CLAP_PARAM_IS_STEPPED,
};
use clap_sys::factory::plugin_factory::{clap_plugin_factory, CLAP_PLUGIN_FACTORY_ID};
use clap_sys::id::CLAP_INVALID_ID;
use libloading::Library;
use std::ffi::{CStr, CString};

const MAX_SCANNED_PARAMETER_DESCRIPTORS: u32 = 256;
const MAX_SCANNED_PARAMETER_NAME_BYTES: usize = 128;
const MAX_SCANNED_PARAMETER_METADATA_BYTES: usize = 32 * 1024;
pub const PARAMETER_METADATA_UNAVAILABLE_REASON: &str =
    "The scanner could not safely complete external parameter inspection.";

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<ClapParameterDescriptor>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_metadata_reason: Option<String>,
}

/// A bounded, scan-time CLAP parameter contract. Values are descriptor facts only:
/// units, step sizes, and enum choices are not part of `clap_param_info` and stay
/// unavailable to consumers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClapParameterDescriptor {
    pub id: u32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
    pub is_automatable: bool,
    pub is_modulatable: bool,
    pub is_stepped: bool,
    pub is_enum: bool,
}

/// What a CLAP plugin's own descriptor says about it.
///
/// Read once per plugin during the scan. Everything here is free — the
/// descriptor is already in hand — which is the point: it used to be read,
/// partly used, and thrown away, and then read a second time by the caller that
/// wanted the id.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ClapDescriptorMetadata {
    pub vendor: String,
    pub id: String,
    pub version: String,
    pub features: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<ClapParameterDescriptor>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_metadata_reason: Option<String>,
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

    if has("instrument")
        || has("synthesizer")
        || has("sampler")
        || has("drum")
        || has("drum-machine")
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

#[cfg(test)]
fn scan_directory(dir: &Path, candidates: &mut Vec<PathBuf>, errors: &mut Vec<String>) {
    let deadline = Instant::now() + std::time::Duration::from_secs(5);
    let _ = scan_directory_bounded(dir, candidates, errors, (usize::MAX, deadline));
}

pub fn scan_directory_bounded(
    dir: &Path,
    candidates: &mut Vec<PathBuf>,
    errors: &mut Vec<String>,
    budget: (usize, Instant),
) -> bool {
    if candidates.len() >= budget.0 || Instant::now() >= budget.1 {
        return false;
    }
    match path_has_symlink_component(dir) {
        Ok(true) => {
            errors.push(format!("Skipping symlinked plugin path: {}", dir.display()));
            return true;
        }
        Ok(false) => {}
        Err(error) => {
            errors.push(error);
            return true;
        }
    }

    let dir_metadata = match fs::symlink_metadata(dir) {
        Ok(metadata) => metadata,
        Err(e) => {
            errors.push(format!("Cannot inspect {}: {}", dir.display(), e));
            return true;
        }
    };

    if dir_metadata.file_type().is_symlink() {
        errors.push(format!("Skipping symlinked plugin path: {}", dir.display()));
        return true;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            errors.push(format!("Cannot read {}: {}", dir.display(), e));
            return true;
        }
    };

    for entry in entries {
        if candidates.len() >= budget.0 || Instant::now() >= budget.1 {
            return false;
        }
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
            if format != "clap" {
                continue;
            }

            candidates.push(entry_path);
        } else if is_dir {
            if !scan_directory_bounded(&entry_path, candidates, errors, budget) {
                return false;
            }
        }
    }
    true
}

pub fn scanned_plugin(path: &Path, descriptor: ClapDescriptorMetadata) -> ScannedPlugin {
    let category = category_from_clap_features(&descriptor.features);

    ScannedPlugin {
        id: stable_id(path),
        name: plugin_name_from_path(path),
        vendor: descriptor.vendor,
        format: "clap".to_string(),
        category,
        path: path.to_string_lossy().into_owned(),
        version: descriptor.version,
        clap_id: descriptor.id,
        // Runtime capabilities require an activated live instance. Discovery
        // only exposes the scan-time CLAP parameter contract.
        num_inputs: 0,
        num_outputs: 0,
        num_parameters: descriptor
            .parameters
            .as_ref()
            .map_or(0, |parameters| parameters.len() as u32),
        has_custom_ui: false,
        parameters: descriptor.parameters,
        parameter_metadata_reason: descriptor.parameter_metadata_reason,
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

    #[test]
    fn scan_directory_does_not_advertise_unsupported_native_bundles() {
        let temp_root = std::env::current_dir()
            .expect("current directory should resolve")
            .join("target")
            .join(
                unique_temp_scan_root("scanner-vst3-capabilities")
                    .file_name()
                    .expect("temp path should have a final component"),
            );
        let plugin_bundle = temp_root.join("Unmeasured.vst3");
        let audio_unit_bundle = temp_root.join("Unmeasured.component");
        std::fs::create_dir_all(&plugin_bundle).expect("VST3 placeholder should be created");
        std::fs::create_dir_all(&audio_unit_bundle)
            .expect("Audio Unit placeholder should be created");

        let mut plugins = Vec::new();
        let mut errors = Vec::new();
        scan_directory(&temp_root, &mut plugins, &mut errors);
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(errors.is_empty(), "unexpected scan errors: {errors:?}");
        assert!(
            plugins.is_empty(),
            "unsupported VST3 and Audio Unit bundles must not appear loadable: {plugins:?}"
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
        assert_eq!(
            category_from_clap_features(&features(&["synthesizer"])),
            "instrument"
        );
        assert_eq!(
            category_from_clap_features(&features(&["sampler", "stereo"])),
            "instrument"
        );
        assert_eq!(
            category_from_clap_features(&features(&["drum-machine"])),
            "instrument"
        );
    }

    #[test]
    fn a_note_effect_is_not_an_audio_effect() {
        // An arpeggiator takes notes and emits notes; sending it down an audio
        // chain is the wrong routing decision.
        assert_eq!(
            category_from_clap_features(&features(&["note-effect"])),
            "note-effect"
        );
    }

    #[test]
    fn an_analyzer_is_reported_as_an_analyzer() {
        assert_eq!(
            category_from_clap_features(&features(&["analyzer", "stereo"])),
            "analyzer"
        );
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
pub fn extract_clap_metadata(path: &Path) -> Result<ClapDescriptorMetadata, String> {
    unsafe {
        let lib =
            Library::new(path).map_err(|error| format!("Cannot load CLAP candidate: {error}"))?;

        let entry: libloading::Symbol<*const clap_plugin_entry> = lib
            .get(b"clap_entry\0")
            .map_err(|error| format!("CLAP candidate has no clap_entry: {error}"))?;

        let entry_ptr = *entry;
        if entry_ptr.is_null() {
            return Err("CLAP candidate returned a null clap_entry".to_string());
        }

        let entry_ref = &*entry_ptr;

        let path_c = match CString::new(path.to_string_lossy().as_bytes()) {
            Ok(c) => c,
            Err(_) => return Err("CLAP candidate path contains a null byte".to_string()),
        };

        if let Some(init_fn) = entry_ref.init {
            if !init_fn(path_c.as_ptr()) {
                return Err("CLAP candidate initialization failed".to_string());
            }
        }

        let result = extract_from_factory(entry_ref);

        if let Some(deinit) = entry_ref.deinit {
            deinit();
        }

        result
    }
}

/// Create a CLAP instance inside the scan worker, inspect `CLAP_EXT_PARAMS`, and
/// destroy it without activation. The app process never receives the instance.
///
/// # Safety
/// Calls third-party CLAP entry points and must only run in the bounded scan worker.
pub fn extract_clap_parameter_metadata(
    path: &Path,
) -> Result<Vec<ClapParameterDescriptor>, String> {
    unsafe {
        let library =
            Library::new(path).map_err(|error| format!("Cannot load CLAP candidate: {error}"))?;
        let entry: libloading::Symbol<*const clap_plugin_entry> = library
            .get(b"clap_entry\0")
            .map_err(|error| format!("CLAP candidate has no clap_entry: {error}"))?;
        let entry_ptr = *entry;
        if entry_ptr.is_null() {
            return Err("CLAP candidate returned a null clap_entry".to_string());
        }
        let entry_ref = &*entry_ptr;
        let path_c = CString::new(path.to_string_lossy().as_bytes())
            .map_err(|_| "CLAP candidate path contains a null byte".to_string())?;
        if let Some(init) = entry_ref.init {
            if !init(path_c.as_ptr()) {
                return Err("CLAP candidate initialization failed".to_string());
            }
        }

        let result = extract_parameters_from_factory(entry_ref);

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

unsafe fn first_plugin_factory(
    entry_ref: &clap_plugin_entry,
) -> Result<&clap_plugin_factory, String> {
    let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
    let factory_ptr = match entry_ref.get_factory {
        Some(get_factory) => get_factory(factory_id),
        None => return Err("CLAP entry has no factory lookup".to_string()),
    };
    if factory_ptr.is_null() {
        return Err("CLAP entry returned no plugin factory".to_string());
    }
    Ok(&*(factory_ptr as *const clap_plugin_factory))
}

unsafe fn first_plugin_descriptor(
    factory: &clap_plugin_factory,
) -> Result<&clap_sys::plugin::clap_plugin_descriptor, String> {
    let count = match factory.get_plugin_count {
        Some(get_plugin_count) => get_plugin_count(factory),
        None => return Err("CLAP factory has no plugin count".to_string()),
    };
    if count == 0 {
        return Err("CLAP factory contains no plugins".to_string());
    }
    let get_descriptor = match factory.get_plugin_descriptor {
        Some(get_plugin_descriptor) => get_plugin_descriptor,
        None => return Err("CLAP factory has no descriptor lookup".to_string()),
    };
    let descriptor = get_descriptor(factory, 0);
    if descriptor.is_null() {
        return Err("CLAP factory returned a null descriptor".to_string());
    }
    Ok(&*descriptor)
}

unsafe fn bounded_parameter_name(value: &[std::os::raw::c_char]) -> Result<String, String> {
    let Some(length) = value.iter().position(|character| *character == 0) else {
        return Err("CLAP parameter name is not null terminated".to_string());
    };
    if length == 0 || length > MAX_SCANNED_PARAMETER_NAME_BYTES {
        return Err("CLAP parameter name exceeds scanner bounds".to_string());
    }
    let bytes = value[..length]
        .iter()
        .map(|character| *character as u8)
        .collect::<Vec<_>>();
    let name = std::str::from_utf8(&bytes)
        .map_err(|_| "CLAP parameter name is not valid UTF-8".to_string())?;
    if name.chars().any(char::is_control) {
        return Err("CLAP parameter name contains control characters".to_string());
    }
    Ok(name.to_string())
}

unsafe fn bounded_parameter_module(
    value: &[std::os::raw::c_char],
) -> Result<Option<String>, String> {
    let Some(length) = value.iter().position(|character| *character == 0) else {
        return Err("CLAP parameter module is not null terminated".to_string());
    };
    if length == 0 {
        return Ok(None);
    }
    if length > MAX_SCANNED_PARAMETER_NAME_BYTES {
        return Err("CLAP parameter module exceeds scanner bounds".to_string());
    }
    let bytes = value[..length]
        .iter()
        .map(|character| *character as u8)
        .collect::<Vec<_>>();
    let module = std::str::from_utf8(&bytes)
        .map_err(|_| "CLAP parameter module is not valid UTF-8".to_string())?;
    if module.chars().any(char::is_control) {
        return Err("CLAP parameter module contains control characters".to_string());
    }
    Ok(Some(module.to_string()))
}

unsafe fn extract_parameters_from_extension(
    plugin: *const clap_sys::plugin::clap_plugin,
    parameters: &clap_plugin_params,
) -> Result<Vec<ClapParameterDescriptor>, String> {
    let count = match parameters.count {
        Some(count) => count(plugin),
        None => return Err("CLAP parameter extension has no count callback".to_string()),
    };
    if count > MAX_SCANNED_PARAMETER_DESCRIPTORS {
        return Err("CLAP parameter count exceeds scanner bounds".to_string());
    }
    let get_info = match parameters.get_info {
        Some(get_info) => get_info,
        None => return Err("CLAP parameter extension has no info callback".to_string()),
    };
    let mut ids = BTreeSet::new();
    let mut metadata_bytes = 0usize;
    let mut descriptors = Vec::with_capacity(count as usize);
    for index in 0..count {
        let mut info: clap_param_info = mem::zeroed();
        if !get_info(plugin, index, &mut info) {
            return Err("CLAP parameter extension returned incomplete metadata".to_string());
        }
        if info.id == CLAP_INVALID_ID || !ids.insert(info.id) {
            return Err("CLAP parameter metadata has duplicate or invalid ids".to_string());
        }
        if !info.min_value.is_finite()
            || !info.max_value.is_finite()
            || !info.default_value.is_finite()
            || info.min_value > info.default_value
            || info.default_value > info.max_value
        {
            return Err("CLAP parameter metadata has invalid numeric bounds".to_string());
        }
        let name = bounded_parameter_name(&info.name)?;
        let module = bounded_parameter_module(&info.module)?;
        metadata_bytes = metadata_bytes.saturating_add(
            name.len() + module.as_ref().map_or(0, String::len) + std::mem::size_of::<u32>() + 32,
        );
        if metadata_bytes > MAX_SCANNED_PARAMETER_METADATA_BYTES {
            return Err("CLAP parameter metadata exceeds scanner bounds".to_string());
        }
        descriptors.push(ClapParameterDescriptor {
            id: info.id,
            name,
            module,
            min_value: info.min_value,
            max_value: info.max_value,
            default_value: info.default_value,
            is_automatable: info.flags & CLAP_PARAM_IS_AUTOMATABLE != 0
                && info.flags & CLAP_PARAM_IS_READONLY == 0,
            is_modulatable: info.flags & CLAP_PARAM_IS_MODULATABLE != 0
                && info.flags & CLAP_PARAM_IS_READONLY == 0,
            is_stepped: info.flags & CLAP_PARAM_IS_STEPPED != 0,
            is_enum: info.flags & CLAP_PARAM_IS_ENUM != 0,
        });
    }
    descriptors.sort_by_key(|descriptor| descriptor.id);
    Ok(descriptors)
}

unsafe fn extract_parameters_from_factory(
    entry_ref: &clap_plugin_entry,
) -> Result<Vec<ClapParameterDescriptor>, String> {
    let factory = first_plugin_factory(entry_ref)?;
    let descriptor = first_plugin_descriptor(factory)?;
    let plugin_id = owned_c_string(descriptor.id);
    if plugin_id.is_empty() {
        return Err("CLAP descriptor has no stable plugin id".to_string());
    }
    let plugin_id = CString::new(plugin_id)
        .map_err(|_| "CLAP descriptor id contains a null byte".to_string())?;
    let mut host = create_host_descriptor();
    let create_plugin = match factory.create_plugin {
        Some(create_plugin) => create_plugin,
        None => return Err("CLAP factory has no plugin creation callback".to_string()),
    };
    let plugin = create_plugin(factory, &mut host, plugin_id.as_ptr());
    if plugin.is_null() {
        return Err("CLAP factory could not create a metadata instance".to_string());
    }
    let plugin_ref = &*plugin;
    let destroy = plugin_ref.destroy;
    let result = (|| {
        let init = plugin_ref
            .init
            .ok_or_else(|| "CLAP metadata instance has no init callback".to_string())?;
        if !init(plugin) {
            return Err("CLAP metadata instance initialization failed".to_string());
        }
        let extension = match plugin_ref.get_extension {
            Some(get_extension) => get_extension(plugin, CLAP_EXT_PARAMS.as_ptr()),
            None => return Ok(Vec::new()),
        };
        if extension.is_null() {
            return Ok(Vec::new());
        }
        extract_parameters_from_extension(plugin, &*(extension as *const clap_plugin_params))
    })();
    if let Some(destroy) = destroy {
        destroy(plugin);
    } else {
        return Err("CLAP metadata instance has no destroy callback".to_string());
    }
    result
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
unsafe fn extract_from_factory(
    entry_ref: &clap_plugin_entry,
) -> Result<ClapDescriptorMetadata, String> {
    let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
    let factory_ptr = match entry_ref.get_factory {
        Some(f) => f(factory_id),
        None => return Err("CLAP entry has no factory lookup".to_string()),
    };

    if factory_ptr.is_null() {
        return Err("CLAP entry returned no plugin factory".to_string());
    }

    let factory = &*(factory_ptr as *const clap_plugin_factory);

    let count = match factory.get_plugin_count {
        Some(f) => f(factory),
        None => return Err("CLAP factory has no plugin count".to_string()),
    };

    if count == 0 {
        return Err("CLAP factory contains no plugins".to_string());
    }

    let get_desc = match factory.get_plugin_descriptor {
        Some(f) => f,
        None => return Err("CLAP factory has no descriptor lookup".to_string()),
    };

    let desc = get_desc(factory, 0);
    if desc.is_null() {
        return Err("CLAP factory returned a null descriptor".to_string());
    }

    let desc_ref = &*desc;
    let metadata = ClapDescriptorMetadata {
        vendor: owned_c_string(desc_ref.vendor),
        id: owned_c_string(desc_ref.id),
        version: owned_c_string(desc_ref.version),
        features: owned_feature_list(desc_ref.features),
        parameters: None,
        parameter_metadata_reason: None,
    };
    if metadata.id.is_empty() {
        return Err("CLAP descriptor has no stable plugin id".to_string());
    }
    Ok(metadata)
}

#[cfg(test)]
mod parameter_metadata_tests {
    use super::*;
    use clap_sys::ext::params::{
        clap_param_info, clap_plugin_params, CLAP_EXT_PARAMS, CLAP_PARAM_IS_AUTOMATABLE,
        CLAP_PARAM_IS_MODULATABLE, CLAP_PARAM_IS_STEPPED,
    };
    use clap_sys::factory::plugin_factory::clap_plugin_factory;
    use clap_sys::host::clap_host;
    use clap_sys::plugin::{clap_plugin, clap_plugin_descriptor};
    use clap_sys::string_sizes::{CLAP_NAME_SIZE, CLAP_PATH_SIZE};
    use clap_sys::version::CLAP_VERSION;
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static CREATE_CALLS: AtomicUsize = AtomicUsize::new(0);
    static INIT_CALLS: AtomicUsize = AtomicUsize::new(0);
    static PARAM_QUERY_CALLS: AtomicUsize = AtomicUsize::new(0);
    static DESTROY_CALLS: AtomicUsize = AtomicUsize::new(0);
    static ACTIVATE_CALLS: AtomicUsize = AtomicUsize::new(0);

    static TEST_ID: &[u8] = b"org.example.scan-safe\0";
    static TEST_VENDOR: &[u8] = b"Example\0";
    static TEST_VERSION: &[u8] = b"1.0.0\0";
    static TEST_DESCRIPTOR: clap_plugin_descriptor = clap_plugin_descriptor {
        clap_version: CLAP_VERSION,
        id: TEST_ID.as_ptr() as *const c_char,
        name: TEST_ID.as_ptr() as *const c_char,
        vendor: TEST_VENDOR.as_ptr() as *const c_char,
        url: std::ptr::null(),
        manual_url: std::ptr::null(),
        support_url: std::ptr::null(),
        version: TEST_VERSION.as_ptr() as *const c_char,
        description: std::ptr::null(),
        features: std::ptr::null(),
    };

    unsafe extern "C" fn test_parameter_count(_plugin: *const clap_plugin) -> u32 {
        1
    }

    unsafe extern "C" fn test_parameter_info(
        _plugin: *const clap_plugin,
        index: u32,
        info: *mut clap_param_info,
    ) -> bool {
        PARAM_QUERY_CALLS.fetch_add(1, Ordering::Relaxed);
        if index != 0 || info.is_null() {
            return false;
        }
        let mut parameter = clap_param_info {
            id: 7,
            flags: CLAP_PARAM_IS_AUTOMATABLE | CLAP_PARAM_IS_MODULATABLE | CLAP_PARAM_IS_STEPPED,
            cookie: std::ptr::null_mut(),
            name: [0; CLAP_NAME_SIZE],
            module: [0; CLAP_PATH_SIZE],
            min_value: -12.0,
            max_value: 12.0,
            default_value: 0.0,
        };
        let name = b"Gain\0";
        let module = b"Dynamics\0";
        std::ptr::copy_nonoverlapping(
            name.as_ptr() as *const c_char,
            parameter.name.as_mut_ptr(),
            name.len(),
        );
        std::ptr::copy_nonoverlapping(
            module.as_ptr() as *const c_char,
            parameter.module.as_mut_ptr(),
            module.len(),
        );
        *info = parameter;
        true
    }

    static TEST_PARAMETERS: clap_plugin_params = clap_plugin_params {
        count: Some(test_parameter_count),
        get_info: Some(test_parameter_info),
        get_value: None,
        value_to_text: None,
        text_to_value: None,
        flush: None,
    };

    unsafe extern "C" fn test_unbounded_parameter_info(
        _plugin: *const clap_plugin,
        _index: u32,
        info: *mut clap_param_info,
    ) -> bool {
        if info.is_null() {
            return false;
        }
        *info = clap_param_info {
            id: 8,
            flags: 0,
            cookie: std::ptr::null_mut(),
            name: [b'x' as c_char; CLAP_NAME_SIZE],
            module: [0; CLAP_PATH_SIZE],
            min_value: 0.0,
            max_value: 1.0,
            default_value: 0.5,
        };
        true
    }

    static UNBOUNDED_PARAMETERS: clap_plugin_params = clap_plugin_params {
        count: Some(test_parameter_count),
        get_info: Some(test_unbounded_parameter_info),
        get_value: None,
        value_to_text: None,
        text_to_value: None,
        flush: None,
    };

    unsafe extern "C" fn test_duplicate_parameter_count(_plugin: *const clap_plugin) -> u32 {
        2
    }

    unsafe extern "C" fn test_duplicate_parameter_info(
        _plugin: *const clap_plugin,
        _index: u32,
        info: *mut clap_param_info,
    ) -> bool {
        if info.is_null() {
            return false;
        }
        let mut parameter = clap_param_info {
            id: 9,
            flags: 0,
            cookie: std::ptr::null_mut(),
            name: [0; CLAP_NAME_SIZE],
            module: [0; CLAP_PATH_SIZE],
            min_value: 0.0,
            max_value: 1.0,
            default_value: 0.5,
        };
        let name = b"Duplicate\0";
        std::ptr::copy_nonoverlapping(
            name.as_ptr() as *const c_char,
            parameter.name.as_mut_ptr(),
            name.len(),
        );
        *info = parameter;
        true
    }

    static DUPLICATE_PARAMETERS: clap_plugin_params = clap_plugin_params {
        count: Some(test_duplicate_parameter_count),
        get_info: Some(test_duplicate_parameter_info),
        get_value: None,
        value_to_text: None,
        text_to_value: None,
        flush: None,
    };

    unsafe extern "C" fn test_plugin_init(_plugin: *const clap_plugin) -> bool {
        INIT_CALLS.fetch_add(1, Ordering::Relaxed);
        true
    }

    unsafe extern "C" fn test_plugin_destroy(plugin: *const clap_plugin) {
        DESTROY_CALLS.fetch_add(1, Ordering::Relaxed);
        drop(Box::from_raw(plugin as *mut clap_plugin));
    }

    unsafe extern "C" fn test_plugin_activate(
        _plugin: *const clap_plugin,
        _sample_rate: f64,
        _min_frames_count: u32,
        _max_frames_count: u32,
    ) -> bool {
        ACTIVATE_CALLS.fetch_add(1, Ordering::Relaxed);
        true
    }

    unsafe extern "C" fn test_plugin_get_extension(
        _plugin: *const clap_plugin,
        extension_id: *const c_char,
    ) -> *const c_void {
        if !extension_id.is_null() && CStr::from_ptr(extension_id) == CLAP_EXT_PARAMS {
            return &raw const TEST_PARAMETERS as *const c_void;
        }
        std::ptr::null()
    }

    unsafe extern "C" fn test_factory_plugin_count(_factory: *const clap_plugin_factory) -> u32 {
        1
    }

    unsafe extern "C" fn test_factory_descriptor(
        _factory: *const clap_plugin_factory,
        index: u32,
    ) -> *const clap_plugin_descriptor {
        if index == 0 {
            return &raw const TEST_DESCRIPTOR;
        }
        std::ptr::null()
    }

    unsafe extern "C" fn test_factory_create_plugin(
        _factory: *const clap_plugin_factory,
        _host: *const clap_host,
        _plugin_id: *const c_char,
    ) -> *const clap_plugin {
        CREATE_CALLS.fetch_add(1, Ordering::Relaxed);
        Box::into_raw(Box::new(clap_plugin {
            desc: &raw const TEST_DESCRIPTOR,
            plugin_data: std::ptr::null_mut(),
            init: Some(test_plugin_init),
            destroy: Some(test_plugin_destroy),
            activate: Some(test_plugin_activate),
            deactivate: None,
            start_processing: None,
            stop_processing: None,
            reset: None,
            process: None,
            get_extension: Some(test_plugin_get_extension),
            on_main_thread: None,
        }))
    }

    static TEST_FACTORY: clap_plugin_factory = clap_plugin_factory {
        get_plugin_count: Some(test_factory_plugin_count),
        get_plugin_descriptor: Some(test_factory_descriptor),
        create_plugin: Some(test_factory_create_plugin),
    };

    unsafe extern "C" fn test_entry_factory(_factory_id: *const c_char) -> *const c_void {
        &raw const TEST_FACTORY as *const c_void
    }

    #[test]
    fn scanner_creates_initializes_queries_and_destroys_parameter_metadata_without_activation() {
        CREATE_CALLS.store(0, Ordering::Relaxed);
        INIT_CALLS.store(0, Ordering::Relaxed);
        PARAM_QUERY_CALLS.store(0, Ordering::Relaxed);
        DESTROY_CALLS.store(0, Ordering::Relaxed);
        ACTIVATE_CALLS.store(0, Ordering::Relaxed);
        let entry = clap_plugin_entry {
            clap_version: CLAP_VERSION,
            init: None,
            deinit: None,
            get_factory: Some(test_entry_factory),
        };

        let parameters = unsafe { extract_parameters_from_factory(&entry) }
            .expect("parameter scan should succeed");

        assert_eq!(CREATE_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(INIT_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(PARAM_QUERY_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(DESTROY_CALLS.load(Ordering::Relaxed), 1);
        assert_eq!(ACTIVATE_CALLS.load(Ordering::Relaxed), 0);
        assert_eq!(
            parameters,
            vec![ClapParameterDescriptor {
                id: 7,
                name: "Gain".to_string(),
                module: Some("Dynamics".to_string()),
                min_value: -12.0,
                max_value: 12.0,
                default_value: 0.0,
                is_automatable: true,
                is_modulatable: true,
                is_stepped: true,
                is_enum: false,
            }]
        );
    }

    #[test]
    fn scanner_rejects_unbounded_or_duplicate_parameter_metadata() {
        let unbounded =
            unsafe { extract_parameters_from_extension(std::ptr::null(), &UNBOUNDED_PARAMETERS) }
                .expect_err("an unterminated parameter name must fail closed");
        assert_eq!(unbounded, "CLAP parameter name is not null terminated");

        let duplicate =
            unsafe { extract_parameters_from_extension(std::ptr::null(), &DUPLICATE_PARAMETERS) }
                .expect_err("duplicate parameter ids must fail closed");
        assert_eq!(
            duplicate,
            "CLAP parameter metadata has duplicate or invalid ids"
        );
    }
}
