use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginParameter {
    pub id: u32,
    pub name: String,
    pub value: f64,
    pub default_value: f64,
    pub min_value: f64,
    pub max_value: f64,
    pub unit: String,
    pub is_automatable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInstance {
    pub instance_id: String,
    pub plugin_id: String,
    pub name: String,
    pub parameters: Vec<PluginParameter>,
    pub is_active: bool,
    pub latency_samples: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub plugins: Vec<ScannedPlugin>,
    pub errors: Vec<String>,
    pub scan_duration_ms: u64,
}

fn stable_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
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

fn scan_directory(dir: &Path, plugins: &mut Vec<ScannedPlugin>, errors: &mut Vec<String>) {
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
        let is_dir = entry_path.is_dir();

        if let Some(format) = detect_format(&entry_path, is_dir) {
            plugins.push(ScannedPlugin {
                id: stable_id(&entry_path),
                name: plugin_name_from_path(&entry_path),
                vendor: String::new(),
                format: format.to_string(),
                category: "effect".to_string(),
                path: entry_path.to_string_lossy().into_owned(),
                version: String::new(),
                num_inputs: 2,
                num_outputs: 2,
                num_parameters: 0,
                has_custom_ui: false,
            });
        } else if is_dir {
            scan_directory(&entry_path, plugins, errors);
        }
    }
}

#[tauri::command]
pub async fn scan_plugins(paths: Vec<String>) -> Result<ScanResult, String> {
    let start = std::time::Instant::now();
    let mut plugins = Vec::new();
    let mut errors = Vec::new();

    for scan_path in &paths {
        let path = PathBuf::from(scan_path);
        if !path.is_dir() {
            errors.push(format!("Not a directory: {}", scan_path));
            continue;
        }
        scan_directory(&path, &mut plugins, &mut errors);
    }

    Ok(ScanResult {
        plugins,
        errors,
        scan_duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn get_default_plugin_paths() -> Result<Vec<String>, String> {
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let home = home.display();
            paths.push(format!("{home}/Library/Audio/Plug-Ins/VST3"));
            paths.push("/Library/Audio/Plug-Ins/VST3".to_string());
            paths.push(format!("{home}/Library/Audio/Plug-Ins/CLAP"));
            paths.push("/Library/Audio/Plug-Ins/CLAP".to_string());
            paths.push(format!("{home}/Library/Audio/Plug-Ins/Components"));
            paths.push("/Library/Audio/Plug-Ins/Components".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        paths.push("C:\\Program Files\\Common Files\\VST3".to_string());
        paths.push("C:\\Program Files\\Common Files\\CLAP".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            let home = home.display();
            paths.push(format!("{home}/.vst3"));
            paths.push(format!("{home}/.clap"));
            paths.push("/usr/lib/vst3".to_string());
            paths.push("/usr/lib/clap".to_string());
        }
    }

    Ok(paths)
}

#[tauri::command]
pub async fn load_plugin(plugin_id: String, instance_id: String) -> Result<PluginInstance, String> {
    Err(format!(
        "Plugin host not yet available. Plugin: {plugin_id}, Instance: {instance_id}. \
         A native plugin host sidecar is required to load VST3/CLAP/AU plugins."
    ))
}

#[tauri::command]
pub async fn unload_plugin(instance_id: String) -> Result<(), String> {
    Err(format!(
        "Plugin host not yet available. Instance: {instance_id}"
    ))
}

#[tauri::command]
pub async fn set_plugin_parameter(
    instance_id: String,
    param_id: u32,
    value: f64,
) -> Result<(), String> {
    Err(format!(
        "Plugin host not yet available. Instance: {instance_id}, Param: {param_id}, Value: {value}"
    ))
}

#[tauri::command]
pub async fn get_plugin_parameters(
    instance_id: String,
) -> Result<Vec<PluginParameter>, String> {
    Err(format!(
        "Plugin host not yet available. Instance: {instance_id}"
    ))
}

#[tauri::command]
pub async fn get_plugin_state(instance_id: String) -> Result<Vec<u8>, String> {
    Err(format!(
        "Plugin host not yet available. Instance: {instance_id}"
    ))
}

#[tauri::command]
pub async fn set_plugin_state(instance_id: String, state: Vec<u8>) -> Result<(), String> {
    let _ = state;
    Err(format!(
        "Plugin host not yet available. Instance: {instance_id}"
    ))
}
