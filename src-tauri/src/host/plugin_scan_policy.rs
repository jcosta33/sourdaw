use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct PluginScanPolicy {
    allowed_roots: Vec<PathBuf>,
}

impl PluginScanPolicy {
    pub fn platform_defaults() -> Self {
        Self {
            allowed_roots: default_plugin_scan_roots(),
        }
    }

    pub fn allowed_roots_as_strings(&self) -> Vec<String> {
        self.allowed_roots
            .iter()
            .map(|path| path.display().to_string())
            .collect()
    }

    pub fn authorize_scan_root(&self, requested_path: &Path) -> Result<(), String> {
        if requested_path.as_os_str().is_empty() {
            return Err("Plugin scan path cannot be empty".to_string());
        }

        if !requested_path.is_absolute() {
            return Err(format!(
                "Plugin scan path must be absolute: {}",
                requested_path.display()
            ));
        }

        let requested_path_exists = requested_path.exists();
        if requested_path_exists {
            match path_has_symlink_component(requested_path) {
                Ok(true) => return Err(unauthorized_scan_path(requested_path)),
                Ok(false) => {}
                Err(error) => return Err(error),
            }
        }

        let requested_path = if requested_path_exists {
            match fs::canonicalize(requested_path) {
                Ok(path) => path,
                Err(error) => {
                    return Err(format!(
                        "Plugin scan path cannot be resolved: {}: {}",
                        requested_path.display(),
                        error
                    ));
                }
            }
        } else {
            normalize_path_lexically(requested_path)
        };

        let is_authorized = self.allowed_roots.iter().any(|allowed_root| {
            let allowed_root = if requested_path_exists {
                match path_has_symlink_component(allowed_root) {
                    Ok(true) => return false,
                    Ok(false) => {}
                    Err(_) => return false,
                }

                match fs::canonicalize(allowed_root) {
                    Ok(path) => path,
                    Err(_) => return false,
                }
            } else {
                normalize_path_lexically(allowed_root)
            };

            requested_path == allowed_root || requested_path.starts_with(&allowed_root)
        });

        if is_authorized {
            return Ok(());
        }

        Err(unauthorized_scan_path(&requested_path))
    }
}

fn unauthorized_scan_path(path: &Path) -> String {
    format!(
        "Unauthorized plugin scan path: {}. Built-in plugin directories are available through get_default_plugin_paths; custom plugin directories must be granted natively or saved as trusted preferences before scanning.",
        path.display()
    )
}

fn default_plugin_scan_roots() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Library/Audio/Plug-Ins/VST3"));
            paths.push(home.join("Library/Audio/Plug-Ins/CLAP"));
            paths.push(home.join("Library/Audio/Plug-Ins/Components"));
        }

        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/CLAP"));
        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/Components"));
    }

    #[cfg(target_os = "windows")]
    {
        paths.push(PathBuf::from(r"C:\Program Files\Common Files\VST3"));
        paths.push(PathBuf::from(r"C:\Program Files\Common Files\CLAP"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".vst3"));
            paths.push(home.join(".clap"));
        }

        paths.push(PathBuf::from("/usr/lib/vst3"));
        paths.push(PathBuf::from("/usr/lib/clap"));
    }

    paths
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized_path = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized_path.pop();
            }
            Component::Normal(segment) => normalized_path.push(segment),
            Component::Prefix(prefix) => normalized_path.push(prefix.as_os_str()),
            Component::RootDir => normalized_path.push(component.as_os_str()),
        }
    }

    normalized_path
}

fn path_has_symlink_component(path: &Path) -> Result<bool, String> {
    let mut current_path = PathBuf::new();

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
                    "Plugin scan path cannot be inspected: {}: {}",
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

    #[test]
    fn authorizes_platform_default_scan_roots() {
        let policy = PluginScanPolicy::platform_defaults();

        assert!(!policy.allowed_roots.is_empty());
        for allowed_root in &policy.allowed_roots {
            assert_eq!(policy.authorize_scan_root(allowed_root), Ok(()));
        }
    }

    #[test]
    fn authorizes_descendants_of_platform_default_scan_roots() {
        let policy = PluginScanPolicy::platform_defaults();
        let allowed_root = policy
            .allowed_roots
            .first()
            .expect("platform default plugin roots should exist");
        let child_root = allowed_root.join("Vendor").join("Plugin.clap");

        assert_eq!(policy.authorize_scan_root(&child_root), Ok(()));
    }

    #[test]
    fn rejects_paths_outside_platform_default_scan_roots() {
        let policy = PluginScanPolicy::platform_defaults();
        let rejected_path = std::env::temp_dir().join("sourdaw-ungranted-plugin-root");

        let result = policy.authorize_scan_root(&rejected_path);

        assert!(
            result
                .as_ref()
                .is_err_and(|error| error.contains("Unauthorized plugin scan path")),
            "expected unauthorized path error, got {result:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_existing_symlink_escape_from_allowed_root() {
        let temp_root = unique_temp_scan_root("symlink-policy-escape");
        let allowed_root = temp_root.join("allowed");
        let outside_root = temp_root.join("outside");
        let symlink_path = allowed_root.join("escape");
        std::fs::create_dir_all(&allowed_root).expect("allowed root should be created");
        std::fs::create_dir_all(&outside_root).expect("outside root should be created");
        std::os::unix::fs::symlink(&outside_root, &symlink_path)
            .expect("symlink should be created");

        let policy = PluginScanPolicy {
            allowed_roots: vec![allowed_root],
        };
        let result = policy.authorize_scan_root(&symlink_path);
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(
            result
                .as_ref()
                .is_err_and(|error| error.contains("Unauthorized plugin scan path")),
            "expected symlink escape to be rejected, got {result:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_descendant_request_through_symlinked_allowed_root() {
        let temp_root = unique_temp_scan_root("symlink-policy-root-escape");
        let symlinked_allowed_root = temp_root.join("allowed");
        let outside_root = temp_root.join("outside");
        let outside_child = outside_root.join("Vendor");
        std::fs::create_dir_all(&outside_child).expect("outside child should be created");
        std::os::unix::fs::symlink(&outside_root, &symlinked_allowed_root)
            .expect("allowed-root symlink should be created");

        let policy = PluginScanPolicy {
            allowed_roots: vec![symlinked_allowed_root.clone()],
        };
        let result = policy.authorize_scan_root(&symlinked_allowed_root.join("Vendor"));
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(
            result
                .as_ref()
                .is_err_and(|error| error.contains("Unauthorized plugin scan path")),
            "expected symlinked allowed-root descendant to be rejected, got {result:?}"
        );
    }
}
