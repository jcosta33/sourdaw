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
    pub num_inputs: u32,
    pub num_outputs: u32,
    pub num_parameters: u32,
    pub has_custom_ui: bool,
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

            let (vendor, clap_id, category, has_ui) = if format == "clap" {
                let (v, id) = extract_clap_metadata(&entry_path);
                // CLAP plugins generally have GUIs
                (v, id, "effect".to_string(), true)
            } else if format == "vst3" {
                // VST3 metadata extraction would require loading the bundle
                // For now, use filename and mark as having UI (most VST3s do)
                (String::new(), String::new(), "effect".to_string(), true)
            } else {
                // AudioUnit
                (String::new(), String::new(), "effect".to_string(), true)
            };

            plugins.push(ScannedPlugin {
                id: stable_id(&entry_path),
                name,
                vendor,
                format: format.to_string(),
                category,
                path: entry_path.to_string_lossy().into_owned(),
                version: String::new(),
                num_inputs: 2,
                num_outputs: 2,
                num_parameters: 0,
                has_custom_ui: has_ui,
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
}

// ── CLAP metadata extraction ────────────────────────────────────────────

/// Load a CLAP plugin temporarily to read its vendor and plugin ID.
///
/// # Safety
/// Calls into native CLAP plugin entry points.
pub fn extract_clap_metadata(path: &Path) -> (String, String) {
    unsafe {
        let lib = match Library::new(path) {
            Ok(l) => l,
            Err(_) => return (String::new(), String::new()),
        };

        let entry: libloading::Symbol<*const clap_plugin_entry> = match lib.get(b"clap_entry\0") {
            Ok(s) => s,
            Err(_) => return (String::new(), String::new()),
        };

        let entry_ptr = *entry;
        if entry_ptr.is_null() {
            return (String::new(), String::new());
        }

        let entry_ref = &*entry_ptr;

        let path_c = match CString::new(path.to_string_lossy().as_bytes()) {
            Ok(c) => c,
            Err(_) => return (String::new(), String::new()),
        };

        if let Some(init_fn) = entry_ref.init {
            if !init_fn(path_c.as_ptr()) {
                return (String::new(), String::new());
            }
        }

        let result = extract_from_factory(entry_ref);

        if let Some(deinit) = entry_ref.deinit {
            deinit();
        }

        result
    }
}

/// Read vendor + plugin ID from the CLAP factory's first descriptor. Called
/// with the entry already init'd — caller is responsible for deinit.
unsafe fn extract_from_factory(entry_ref: &clap_plugin_entry) -> (String, String) {
    let factory_id = CLAP_PLUGIN_FACTORY_ID.as_ptr() as *const i8;
    let factory_ptr = match entry_ref.get_factory {
        Some(f) => f(factory_id),
        None => return (String::new(), String::new()),
    };

    if factory_ptr.is_null() {
        return (String::new(), String::new());
    }

    let factory = &*(factory_ptr as *const clap_plugin_factory);

    let count = match factory.get_plugin_count {
        Some(f) => f(factory),
        None => return (String::new(), String::new()),
    };

    if count == 0 {
        return (String::new(), String::new());
    }

    let get_desc = match factory.get_plugin_descriptor {
        Some(f) => f,
        None => return (String::new(), String::new()),
    };

    let desc = get_desc(factory, 0);
    if desc.is_null() {
        return (String::new(), String::new());
    }

    let desc_ref = &*desc;
    let vendor = if !desc_ref.vendor.is_null() {
        CStr::from_ptr(desc_ref.vendor)
            .to_string_lossy()
            .into_owned()
    } else {
        String::new()
    };
    let id = if !desc_ref.id.is_null() {
        CStr::from_ptr(desc_ref.id).to_string_lossy().into_owned()
    } else {
        String::new()
    };

    (vendor, id)
}
