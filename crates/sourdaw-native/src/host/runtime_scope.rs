//! An immutable process selection, made before any automatic mutable state opens.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const SCOPE_NAMESPACE: &str = ".sourdaw-native-runtime-scopes-v1";
static PROCESS_SCOPE: ScopeSelection = ScopeSelection(OnceLock::new());

#[derive(Default)]
struct ScopeSelection(OnceLock<Result<Option<PathBuf>, String>>);

impl ScopeSelection {
    fn select(&self, requested: Option<&Path>) -> Result<Option<PathBuf>, String> {
        let candidate = requested.map(RuntimeScope::validate).transpose();
        let selected = self.0.get_or_init(|| candidate.clone());
        match (selected, candidate) {
            (Ok(current), Ok(candidate)) if *current == candidate => Ok(current.clone()),
            (Err(error), _) => Err(error.clone()),
            (_, Err(error)) => Err(error),
            _ => Err("Native runtime scope was already selected differently".to_string()),
        }
    }
}

pub struct RuntimeScope;

#[cfg(test)]
pub(crate) struct TestScopeRoot {
    container: PathBuf,
    pub root: PathBuf,
}

#[cfg(test)]
impl Drop for TestScopeRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.container);
    }
}

impl RuntimeScope {
    fn validate(root: &Path) -> Result<PathBuf, String> {
        let invalid = || {
            "Native runtime scope must be an existing canonical UUID directory in the reserved namespace".to_string()
        };
        let name = root
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(invalid)?;
        let uuid = uuid::Uuid::parse_str(name).map_err(|_| invalid())?;
        if !root.is_absolute()
            || uuid.to_string() != name
            || root
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
                != Some(SCOPE_NAMESPACE)
            || !root.is_dir()
        {
            return Err(invalid());
        }
        let canonical = root.canonicalize().map_err(|_| invalid())?;
        // Windows canonicalization adds a verbatim prefix to ordinary absolute paths.
        if Self::comparable_path(&canonical) != Self::comparable_path(root)
            || std::fs::symlink_metadata(root)
                .map_err(|_| invalid())?
                .file_type()
                .is_symlink()
        {
            return Err(invalid());
        }
        if canonical
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            != Some(SCOPE_NAMESPACE)
            || canonical.file_name().and_then(|name| name.to_str()) != Some(name)
        {
            return Err(invalid());
        }
        Ok(canonical)
    }

    fn comparable_path(path: &Path) -> PathBuf {
        #[cfg(windows)]
        {
            use std::path::{Component, Prefix};
            let mut parts = path.components();
            if let Some(Component::Prefix(prefix)) = parts.next() {
                let mut normalized = match prefix.kind() {
                    Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:", drive as char)),
                    Prefix::VerbatimUNC(server, share) => PathBuf::from(format!(
                        r"\\{}\{}",
                        server.to_string_lossy(),
                        share.to_string_lossy()
                    )),
                    _ => PathBuf::from(prefix.as_os_str()),
                };
                normalized.extend(parts);
                return normalized;
            }
        }
        path.to_path_buf()
    }

    pub fn select(root: Option<&Path>) -> Result<(), String> {
        let selected = PROCESS_SCOPE.select(root)?;
        if let Some(root) = selected {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                    .map_err(|error| format!("Cannot protect native runtime scope: {error}"))?;
            }
            for relative in [
                "native/data/private/scan-responses",
                "native/cache",
                "native/ipc",
                "native/projects",
            ] {
                let directory = root.join(relative);
                let mut current = root.clone();
                for component in directory
                    .strip_prefix(&root)
                    .expect("scope relative path")
                    .components()
                {
                    current.push(component);
                    match std::fs::create_dir(&current) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(error) => {
                            return Err(format!("Cannot prepare native runtime scope: {error}"))
                        }
                    }
                    let metadata =
                        std::fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(
                            "Native runtime scope contains a non-directory or symbolic link"
                                .to_string(),
                        );
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(&current, std::fs::Permissions::from_mode(0o700))
                            .map_err(|error| {
                                format!("Cannot protect native runtime scope: {error}")
                            })?;
                    }
                }
            }
        }
        Ok(())
    }

    pub fn root() -> Option<PathBuf> {
        PROCESS_SCOPE
            .0
            .get_or_init(|| Ok(None))
            .as_ref()
            .expect("An invalid native scope cannot fall back to legacy state")
            .clone()
    }

    pub fn path(relative: &str) -> Option<PathBuf> {
        Self::root().map(|root| root.join(relative))
    }

    #[cfg(test)]
    pub(crate) fn test_root() -> TestScopeRoot {
        let container = std::env::temp_dir().join(format!(
            "sourdaw-runtime-scope-test-{}",
            uuid::Uuid::new_v4()
        ));
        let root = container
            .join(SCOPE_NAMESPACE)
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        TestScopeRoot {
            root: root.canonicalize().unwrap(),
            container,
        }
    }

    /// Real global resolver tests each get a new process. The selector is never reset.
    #[cfg(test)]
    pub(crate) fn test_in_process(name: &str, test: impl FnOnce(&Path)) {
        let name = name.strip_prefix("sourdaw_native::").unwrap_or(name);
        const CHILD: &str = "SOURDAW_RUNTIME_SCOPE_TEST_CHILD";
        if std::env::var(CHILD).as_deref() == Ok(name) {
            let fixture = Self::test_root();
            Self::select(Some(&fixture.root)).unwrap();
            test(&fixture.root);
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([name, "--exact", "--nocapture"])
            .env(CHILD, name)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "isolated test did not run: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immutable_selection_preserves_default_and_refuses_conflicts() {
        let fixture = RuntimeScope::test_root();
        let path = fixture.root.clone();
        let selection = ScopeSelection::default();
        assert_eq!(selection.select(None).unwrap(), None);
        assert!(selection.select(Some(&path)).is_err());
        let selection = ScopeSelection::default();
        assert_eq!(selection.select(Some(&path)).unwrap(), Some(path.clone()));
        assert!(selection.select(Some(&path)).is_ok());
        assert!(selection.select(None).is_err());
    }

    #[test]
    fn invalid_selection_cannot_fall_back() {
        let selection = ScopeSelection::default();
        assert!(selection.select(Some(Path::new(""))).is_err());
        assert!(selection.select(None).is_err());
    }

    #[test]
    fn selection_requires_canonical_reserved_uuid_root() {
        let fixture = RuntimeScope::test_root();
        assert!(RuntimeScope::validate(&fixture.root).is_ok());
        assert!(RuntimeScope::validate(
            &fixture
                .root
                .join("..")
                .join(fixture.root.file_name().unwrap())
        )
        .is_err());
        assert!(RuntimeScope::validate(&fixture.container).is_err());
        #[cfg(unix)]
        {
            let link = fixture
                .root
                .parent()
                .unwrap()
                .join(uuid::Uuid::new_v4().to_string());
            std::os::unix::fs::symlink(&fixture.root, &link).unwrap();
            assert!(RuntimeScope::validate(&link).is_err());
        }
    }

    #[test]
    fn failed_layout_preparation_does_not_revert_selection() {
        let name = concat!(
            module_path!(),
            "::failed_layout_preparation_does_not_revert_selection"
        );
        let name = name.strip_prefix("sourdaw_native::").unwrap_or(name);
        const CHILD: &str = "SOURDAW_RUNTIME_SCOPE_TEST_CHILD";
        if std::env::var(CHILD).as_deref() != Ok(name) {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([name, "--exact", "--nocapture"])
                .env(CHILD, name)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
            return;
        }
        let fixture = RuntimeScope::test_root();
        std::fs::write(fixture.root.join("native"), b"occupied").unwrap();
        assert!(RuntimeScope::select(Some(&fixture.root)).is_err());
        assert_eq!(RuntimeScope::root(), Some(fixture.root.clone()));
        assert!(RuntimeScope::select(None).is_err());
        #[cfg(unix)]
        {
            std::fs::remove_file(fixture.root.join("native")).unwrap();
            let outside = fixture.container.join("outside");
            std::fs::create_dir(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, fixture.root.join("native")).unwrap();
            assert!(RuntimeScope::select(Some(&fixture.root)).is_err());
            assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
        }
    }

    #[test]
    fn racing_selections_have_one_immutable_winner() {
        let fixture = RuntimeScope::test_root();
        let path = fixture.root.clone();
        let selection = ScopeSelection::default();
        std::thread::scope(|threads| {
            let legacy = threads.spawn(|| selection.select(None));
            let scoped = threads.spawn(|| selection.select(Some(&path)));
            assert_ne!(
                legacy.join().unwrap().is_ok(),
                scoped.join().unwrap().is_ok()
            );
        });
    }
}
