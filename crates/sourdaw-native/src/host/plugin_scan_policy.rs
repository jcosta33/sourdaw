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

    /// A policy over an explicit root set, for tests only.
    ///
    /// Test-gated on purpose: the roots are the authority, so production code
    /// must have exactly one way to obtain a policy — the platform defaults —
    /// and no way to widen one. Tests need it because the platform defaults are
    /// the developer's real plugin folders, which no test may write into.
    #[cfg(test)]
    pub(crate) fn with_allowed_roots(allowed_roots: Vec<PathBuf>) -> Self {
        Self { allowed_roots }
    }

    pub fn allowed_roots_as_strings(&self) -> Vec<String> {
        self.allowed_roots
            .iter()
            .map(|path| path.display().to_string())
            .collect()
    }

    /// Where `path` sits in the platform's priority order, or `None` for a path
    /// under no allowed root.
    ///
    /// The order of the allowed roots is priority — per-user, then machine-wide,
    /// then network — and this is what carries that order to a caller that was
    /// handed its paths in some other one. The lowest index wins, so a path
    /// under two nested roots ranks with the more specific of them.
    pub fn root_rank(&self, path: &Path) -> Option<usize> {
        self.allowed_roots.iter().position(|allowed_root| {
            let allowed_root = resolve_allowed_root(allowed_root);
            path == allowed_root || path.starts_with(&allowed_root)
        })
    }

    /// Whether `path` is one of the platform's own scan roots, rather than a
    /// folder somewhere under one.
    ///
    /// `root_rank` cannot answer this: it ranks a descendant with the root that
    /// contains it, so a caller that has to tell a folder the platform defines
    /// from one the user added under it needs the exact match.
    pub fn is_platform_default_root(&self, path: &Path) -> bool {
        self.allowed_roots
            .iter()
            .any(|allowed_root| resolve_allowed_root(allowed_root).as_path() == path)
    }

    /// Authorize a scan root, returning the resolved path that was authorized.
    ///
    /// The resolved path, not the caller's spelling: the checks below are made
    /// against the canonical path, so walking anything else would walk a
    /// directory this function never looked at.
    ///
    /// The whole rule in one place: a request with a symlink component is
    /// refused unless it is component-equal to one of this policy's own
    /// allowed roots — the platform's own layout, not a user-supplied escape
    /// attempt, for example a Linux distribution that symlinks `/usr/lib64`
    /// to `/usr/lib` — in which case it is authorized to its canonical path.
    /// An allowed root is otherwise matched by its resolved path, not its
    /// spelling, so a descendant reached by naming exactly what the scan
    /// walked — a symlinked allowed root's own canonical path — is
    /// authorized too; only a request that itself carries a symlink
    /// component and is not an own root is refused.
    pub fn authorize_scan_root(&self, requested_path: &Path) -> Result<PathBuf, String> {
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
                Ok(true) if self.is_own_allowed_root(requested_path) => {
                    return fs::canonicalize(requested_path).map_err(|error| {
                        format!(
                            "Plugin scan path cannot be resolved: {}: {}",
                            requested_path.display(),
                            error
                        )
                    });
                }
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
            return Ok(requested_path);
        }

        Err(unauthorized_scan_path(&requested_path))
    }

    /// Whether `path` is one of this policy's own allowed roots, compared
    /// component by component.
    ///
    /// The platform defines these paths itself, so a symlink component in one
    /// of them — a Linux distribution's `/usr/lib64` pointing at `/usr/lib`
    /// — is the platform's own layout choice, not a path a caller built to
    /// slip past the symlink check. `Path`'s `PartialEq` compares components,
    /// so it looks past a `.` segment, a repeated separator, or a trailing
    /// slash — but it performs no `..` resolution and no symlink resolution:
    /// `get_default_plugin_paths` hands out one component spelling per root,
    /// and only a request matching that spelling, `..` and symlinks aside,
    /// may take this arm. Lexical normalization pops a `..` component before
    /// any symlink in the path resolves, so `<allowed-root>/S/../VST3`
    /// through a symlink `S` that leaves the tree would normalize back to the
    /// allowed root's own spelling and wrongly match here, even though the
    /// path it names — once `S` actually resolves — sits outside every
    /// allowed root.
    fn is_own_allowed_root(&self, path: &Path) -> bool {
        self.allowed_roots
            .iter()
            .any(|allowed_root| allowed_root == path)
    }
}

/// An allowed root as the checks have to compare it: resolved when it is on
/// disk, normalized lexically when it is not, because a root the machine does
/// not have cannot be canonicalized.
fn resolve_allowed_root(allowed_root: &Path) -> PathBuf {
    fs::canonicalize(allowed_root).unwrap_or_else(|_| normalize_path_lexically(allowed_root))
}

fn unauthorized_scan_path(path: &Path) -> String {
    format!(
        "Unauthorized plugin scan path: {}. Built-in plugin directories are available through get_default_plugin_paths; custom plugin directories must be granted natively or saved as trusted preferences before scanning.",
        path.display()
    )
}

/// The platform's plugin folders, **most specific first**.
///
/// The order is priority, not decoration. A plugin installed in two of these
/// folders is one plugin with two copies, and the scan keeps the first one it
/// meets, so a per-user install has to precede the machine-wide one and the
/// machine-wide one has to precede the network share. Both format families
/// order the same way, which is also the order the VST3 specification lays
/// down for its own folders.
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
        paths.push(PathBuf::from("/Network/Library/Audio/Plug-Ins/VST3"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = dirs::data_local_dir() {
            paths.push(local_app_data.join(r"Programs\Common\VST3"));
        }

        paths.push(PathBuf::from(r"C:\Program Files\Common Files\VST3"));
        paths.push(PathBuf::from(r"C:\Program Files\Common Files\CLAP"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".vst3"));
            paths.push(home.join(".clap"));
        }

        // `lib` and `lib64` are the same rung: which one a distribution uses for
        // 64-bit objects is the distribution's choice, and a machine that has
        // both keeps unrelated plugins in them.
        paths.push(PathBuf::from("/usr/lib/vst3"));
        paths.push(PathBuf::from("/usr/lib64/vst3"));
        paths.push(PathBuf::from("/usr/lib/clap"));
        paths.push(PathBuf::from("/usr/local/lib/vst3"));
        paths.push(PathBuf::from("/usr/local/lib64/vst3"));
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
            assert!(policy.authorize_scan_root(allowed_root).is_ok());
        }
    }

    /// Where a root sits in the default list. Panics rather than returning an
    /// option: a root the ordering contract names but the defaults do not carry
    /// is the failure, not a case to tolerate.
    fn priority_of(roots: &[PathBuf], root: &Path) -> usize {
        roots
            .iter()
            .position(|candidate| candidate == root)
            .unwrap_or_else(|| panic!("{} should be a default scan root", root.display()))
    }

    /// The scan keeps the first copy of a plugin it meets, so this order is the
    /// rule that decides which copy of a twice-installed plugin is hosted.
    #[test]
    fn per_user_scan_roots_outrank_the_machine_wide_ones() {
        let roots = default_plugin_scan_roots();

        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir().expect("a macOS account should have a home directory");
            let per_user = priority_of(&roots, &home.join("Library/Audio/Plug-Ins/VST3"));
            let machine_wide = priority_of(&roots, Path::new("/Library/Audio/Plug-Ins/VST3"));
            let network = priority_of(&roots, Path::new("/Network/Library/Audio/Plug-Ins/VST3"));

            assert!(per_user < machine_wide);
            assert!(machine_wide < network);
        }

        #[cfg(target_os = "windows")]
        {
            let local_app_data =
                dirs::data_local_dir().expect("a Windows account should have local app data");
            let per_user = priority_of(&roots, &local_app_data.join(r"Programs\Common\VST3"));
            let machine_wide =
                priority_of(&roots, Path::new(r"C:\Program Files\Common Files\VST3"));

            assert!(per_user < machine_wide);
        }

        #[cfg(target_os = "linux")]
        {
            let home = dirs::home_dir().expect("a Linux account should have a home directory");
            let per_user = priority_of(&roots, &home.join(".vst3"));
            let distribution = priority_of(&roots, Path::new("/usr/lib/vst3"));
            let distribution_64 = priority_of(&roots, Path::new("/usr/lib64/vst3"));
            let site = priority_of(&roots, Path::new("/usr/local/lib/vst3"));
            let site_64 = priority_of(&roots, Path::new("/usr/local/lib64/vst3"));

            assert!(per_user < distribution);
            assert!(per_user < distribution_64);
            assert!(distribution < site);
            assert!(distribution_64 < site_64);
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

        assert!(policy.authorize_scan_root(&child_root).is_ok());
    }

    /// The path the policy hands back is the one its checks were made against.
    /// Returning the caller's spelling would let a scan walk a directory the
    /// authorization never looked at.
    #[test]
    fn authorization_answers_with_the_path_it_resolved() {
        let policy = PluginScanPolicy::with_allowed_roots(vec![PathBuf::from("/plugins/VST3")]);

        let authorized = policy
            .authorize_scan_root(Path::new("/plugins/VST3/Vendor/../Vendor"))
            .expect("a descendant of an allowed root");

        assert_eq!(authorized, PathBuf::from("/plugins/VST3/Vendor"));
    }

    /// The ranking is what decides which copy of a twice-installed plugin the
    /// scan meets first, so it has to come from the platform order rather than
    /// from the order a caller listed its paths in.
    #[test]
    fn a_root_ranks_by_the_platform_order_and_an_unlisted_one_does_not_rank() {
        let policy = PluginScanPolicy::with_allowed_roots(vec![
            PathBuf::from("/per-user/VST3"),
            PathBuf::from("/machine-wide/VST3"),
        ]);

        assert_eq!(policy.root_rank(Path::new("/per-user/VST3")), Some(0));
        assert_eq!(
            policy.root_rank(Path::new("/machine-wide/VST3/Vendor")),
            Some(1),
            "a descendant ranks with the root that contains it"
        );
        assert_eq!(policy.root_rank(Path::new("/somewhere/else")), None);
    }

    /// The distinction `root_rank` cannot make: a folder the platform defines
    /// is the platform's to have or not have, while a folder under one is the
    /// user's own addition and answers for itself.
    #[test]
    fn a_platform_root_is_a_default_root_and_a_folder_under_one_is_not() {
        let policy = PluginScanPolicy::with_allowed_roots(vec![
            PathBuf::from("/per-user/VST3"),
            PathBuf::from("/machine-wide/VST3"),
        ]);

        assert!(policy.is_platform_default_root(Path::new("/machine-wide/VST3")));
        assert!(!policy.is_platform_default_root(Path::new("/machine-wide/VST3/Vendor")));
        assert!(!policy.is_platform_default_root(Path::new("/somewhere/else")));
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

    /// A path that is exactly one of the policy's own allowed roots is the
    /// platform's layout, not a user-supplied escape: it is authorized to its
    /// canonical path even through a symlinked component, which is how a Linux
    /// `/usr/lib64/vst3` resolves where `/usr/lib64` symlinks to `/usr/lib`.
    #[cfg(unix)]
    #[test]
    fn authorizes_an_allowed_root_reached_through_the_platforms_own_symlink() {
        let temp_root = unique_temp_scan_root("symlink-policy-own-root");
        let real_root = temp_root.join("real");
        let real_vst3 = real_root.join("VST3");
        let linked_root = temp_root.join("linked");
        std::fs::create_dir_all(&real_vst3).expect("real VST3 root should be created");
        std::os::unix::fs::symlink(&real_root, &linked_root)
            .expect("linked root symlink should be created");

        let allowed_root = linked_root.join("VST3");
        let policy = PluginScanPolicy::with_allowed_roots(vec![allowed_root.clone()]);
        let result = policy.authorize_scan_root(&allowed_root);
        let expected = std::fs::canonicalize(&real_vst3).expect("real VST3 root should resolve");
        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(
            result,
            Ok(expected),
            "expected the platform's own symlinked default root to be authorized, got {result:?}"
        );
    }

    /// A descendant of a symlinked own root, named by the canonical path the
    /// own-root scan actually walked, has to authorize on a later launch: the
    /// registry hydrates every plugin row by re-authorizing its recorded
    /// (canonical) path, and a covering root that only matches the root's own
    /// spelling would drop every plugin the scan found under it.
    #[cfg(unix)]
    #[test]
    fn authorizes_a_descendant_of_a_symlinked_own_root_by_its_resolved_path() {
        let temp_root = unique_temp_scan_root("symlink-policy-own-root-descendant");
        let real_root = temp_root.join("real");
        let real_vst3 = real_root.join("VST3");
        let real_plugin = real_vst3.join("Foo.vst3");
        let linked_root = temp_root.join("linked");
        std::fs::create_dir_all(&real_plugin).expect("real plugin bundle should be created");
        std::os::unix::fs::symlink(&real_root, &linked_root)
            .expect("linked root symlink should be created");

        let allowed_root = linked_root.join("VST3");
        let policy = PluginScanPolicy::with_allowed_roots(vec![allowed_root.clone()]);
        let root_result = policy.authorize_scan_root(&allowed_root);
        let canonical_root =
            std::fs::canonicalize(&real_vst3).expect("real VST3 root should resolve");
        let canonical_plugin =
            std::fs::canonicalize(&real_plugin).expect("real plugin bundle should resolve");
        let plugin_result = policy.authorize_scan_root(&canonical_plugin);
        let _ = std::fs::remove_dir_all(&temp_root);

        assert_eq!(
            root_result,
            Ok(canonical_root),
            "expected the symlinked own root to authorize to its canonical path, got {root_result:?}"
        );
        assert_eq!(
            plugin_result,
            Ok(canonical_plugin),
            "expected the descendant named by its resolved path to be covered by the symlinked own root, got {plugin_result:?}"
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

    /// Lexical normalization pops a `..` component before any symlink in the
    /// path resolves, so `<allowed-root>/S/../VST3` — where `S` is a symlink
    /// that leaves the allowed root's own tree — normalized back to the
    /// allowed root's exact spelling and wrongly took the own-root arm, which
    /// answers with `fs::canonicalize` and so resolved (and authorized) the
    /// path `S` actually names: a folder outside every allowed root. Only a
    /// path that is byte-for-byte one of the policy's own roots, the one
    /// spelling `get_default_plugin_paths` hands out, may take that arm.
    #[cfg(unix)]
    #[test]
    fn rejects_own_root_spelling_reached_through_a_symlink_and_parent_traversal() {
        let temp_root = unique_temp_scan_root("symlink-policy-lexical-escape");
        let real_root = temp_root.join("real");
        let real_vst3 = real_root.join("VST3");
        let outside_vst3 = temp_root.join("outside").join("VST3");
        let symlink_path = real_root.join("S");
        std::fs::create_dir_all(&real_vst3).expect("real VST3 root should be created");
        std::fs::create_dir_all(&outside_vst3).expect("outside VST3 root should be created");
        std::os::unix::fs::symlink(&outside_vst3, &symlink_path)
            .expect("symlink out of the allowed root's tree should be created");

        let policy = PluginScanPolicy::with_allowed_roots(vec![real_vst3]);
        let requested_path = symlink_path.join("..").join("VST3");
        let result = policy.authorize_scan_root(&requested_path);
        let _ = std::fs::remove_dir_all(&temp_root);

        assert!(
            result
                .as_ref()
                .is_err_and(|error| error.contains("Unauthorized plugin scan path")),
            "expected the symlink-then-parent-traversal path to be rejected rather than matched to the allowed root's own spelling, got {result:?}"
        );
    }
}
