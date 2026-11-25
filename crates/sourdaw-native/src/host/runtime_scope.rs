//! An immutable process selection, made before any automatic mutable state opens.
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const SCOPE_NAMESPACE: &str = ".sourdaw-native-runtime-scopes-v1";
static PROCESS_SCOPE: ScopeSelection = ScopeSelection(OnceLock::new());

/// Why the process scope selection refuses. `Copy` because the selection keeps
/// its refusal for the life of the process and answers it to every resolver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeScopeRefusal {
    /// The requested root is not an existing canonical UUID directory in
    /// [`SCOPE_NAMESPACE`].
    Invalid,
    /// A different selection was already made in this process.
    SelectedDifferently,
}

impl fmt::Display for RuntimeScopeRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Invalid => "Native runtime scope must be an existing canonical UUID directory in the reserved namespace",
            Self::SelectedDifferently => "Native runtime scope was already selected differently",
        })
    }
}

impl std::error::Error for RuntimeScopeRefusal {}

/// Why [`RuntimeScope::select`] failed: the selection refused, or the selected
/// root's layout could not be prepared.
#[derive(Debug)]
pub enum RuntimeScopeError {
    Refused(RuntimeScopeRefusal),
    /// The root or a layout directory could not be restricted to its owner.
    Unprotectable(std::io::Error),
    /// A layout directory could not be created.
    Unpreparable(std::io::Error),
    /// A layout directory's metadata could not be read; the message is the OS text alone.
    Unreadable(std::io::Error),
    /// A layout entry is a symbolic link or not a directory.
    NotADirectory,
}

impl fmt::Display for RuntimeScopeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(refusal) => refusal.fmt(f),
            Self::Unprotectable(error) => write!(f, "Cannot protect native runtime scope: {error}"),
            Self::Unpreparable(error) => write!(f, "Cannot prepare native runtime scope: {error}"),
            Self::Unreadable(error) => error.fmt(f),
            Self::NotADirectory => {
                f.write_str("Native runtime scope contains a non-directory or symbolic link")
            }
        }
    }
}

impl std::error::Error for RuntimeScopeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Refused(refusal) => Some(refusal),
            Self::Unprotectable(error) | Self::Unpreparable(error) | Self::Unreadable(error) => {
                Some(error)
            }
            Self::NotADirectory => None,
        }
    }
}

impl From<RuntimeScopeRefusal> for RuntimeScopeError {
    fn from(refusal: RuntimeScopeRefusal) -> Self {
        Self::Refused(refusal)
    }
}

#[derive(Default)]
struct ScopeSelection(OnceLock<Result<Option<PathBuf>, RuntimeScopeRefusal>>);

impl ScopeSelection {
    fn select(&self, requested: Option<&Path>) -> Result<Option<PathBuf>, RuntimeScopeRefusal> {
        let candidate = requested.map(RuntimeScope::validate).transpose();
        let selected = self.0.get_or_init(|| candidate.clone());
        match (selected, candidate) {
            (Ok(current), Ok(candidate)) if *current == candidate => Ok(current.clone()),
            (Err(error), _) => Err(*error),
            (_, Err(error)) => Err(error),
            _ => Err(RuntimeScopeRefusal::SelectedDifferently),
        }
    }

    /// The selection, settling on the legacy layout when none was made.
    fn root(&self) -> Result<Option<PathBuf>, RuntimeScopeRefusal> {
        self.0.get_or_init(|| Ok(None)).clone()
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
    fn validate(root: &Path) -> Result<PathBuf, RuntimeScopeRefusal> {
        let invalid = || RuntimeScopeRefusal::Invalid;
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

    pub fn select(root: Option<&Path>) -> Result<(), RuntimeScopeError> {
        let selected = PROCESS_SCOPE.select(root)?;
        if let Some(root) = selected {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                    .map_err(RuntimeScopeError::Unprotectable)?;
            }
            for relative in [
                "native/data/private/scan-responses",
                "native/cache",
                "native/ipc",
                "native/projects",
            ] {
                let mut current = root.clone();
                for component in Path::new(relative).components() {
                    current.push(component);
                    match std::fs::create_dir(&current) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(RuntimeScopeError::Unpreparable(error)),
                    }
                    let metadata = std::fs::symlink_metadata(&current)
                        .map_err(RuntimeScopeError::Unreadable)?;
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err(RuntimeScopeError::NotADirectory);
                    }
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(&current, std::fs::Permissions::from_mode(0o700))
                            .map_err(RuntimeScopeError::Unprotectable)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// The selected scope root, `None` for the legacy unscoped layout, or the
    /// selection's refusal. A refused selection never answers `None`: that
    /// would send the caller to legacy state the scope was chosen to avoid.
    pub fn root() -> Result<Option<PathBuf>, RuntimeScopeRefusal> {
        PROCESS_SCOPE.root()
    }

    pub fn path(relative: &str) -> Result<Option<PathBuf>, RuntimeScopeRefusal> {
        Ok(Self::root()?.map(|root| root.join(relative)))
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
        Self::in_child_process(name, || {
            let fixture = Self::test_root();
            Self::select(Some(&fixture.root)).unwrap();
            test(&fixture.root);
        });
    }

    /// `test` in a new process whose scope selection was refused, so every
    /// resolver answers the refusal.
    #[cfg(test)]
    pub(crate) fn test_in_refused_process(name: &str, test: impl FnOnce()) {
        Self::in_child_process(name, || {
            assert!(Self::select(Some(Path::new(""))).is_err());
            assert!(Self::root().is_err());
            test();
        });
    }

    #[cfg(test)]
    fn in_child_process(name: &str, child: impl FnOnce()) {
        let name = name.strip_prefix("sourdaw_native::").unwrap_or(name);
        const CHILD: &str = "SOURDAW_RUNTIME_SCOPE_TEST_CHILD";
        if std::env::var(CHILD).as_deref() == Ok(name) {
            child();
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
    fn invalid_selection_answers_its_refusal_rather_than_the_legacy_layout() {
        let selection = ScopeSelection::default();
        assert!(selection.select(Some(Path::new(""))).is_err());
        assert_eq!(selection.root(), Err(RuntimeScopeRefusal::Invalid));
        assert_eq!(
            selection.root().unwrap_err().to_string(),
            "Native runtime scope must be an existing canonical UUID directory in the reserved namespace"
        );
    }

    #[test]
    fn a_conflicting_selection_is_refused_as_selected_differently() {
        let selection = ScopeSelection::default();
        assert_eq!(selection.select(None).unwrap(), None);
        let fixture = RuntimeScope::test_root();
        let refusal = selection.select(Some(&fixture.root)).unwrap_err();
        assert_eq!(refusal, RuntimeScopeRefusal::SelectedDifferently);
        assert_eq!(
            refusal.to_string(),
            "Native runtime scope was already selected differently"
        );
    }

    #[test]
    fn layout_errors_keep_their_historical_text() {
        let os = || std::io::Error::other("denied");
        let cases = [
            (
                RuntimeScopeError::Refused(RuntimeScopeRefusal::Invalid),
                "Native runtime scope must be an existing canonical UUID directory in the reserved namespace",
            ),
            (
                RuntimeScopeError::Unprotectable(os()),
                "Cannot protect native runtime scope: denied",
            ),
            (
                RuntimeScopeError::Unpreparable(os()),
                "Cannot prepare native runtime scope: denied",
            ),
            (RuntimeScopeError::Unreadable(os()), "denied"),
            (
                RuntimeScopeError::NotADirectory,
                "Native runtime scope contains a non-directory or symbolic link",
            ),
        ];
        for (error, text) in cases {
            assert_eq!(error.to_string(), text);
        }
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
        assert_eq!(RuntimeScope::root(), Ok(Some(fixture.root.clone())));
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
