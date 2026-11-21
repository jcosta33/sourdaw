//! Commands over the plugin folders the user granted beyond the platform's own.
//!
//! [`grant_plugin_folder`] is the one route that adds a folder, and the desktop
//! shell reaches it only from its main process, with the path a native folder
//! dialog just returned; it is withheld from the renderer. Listing and revoking
//! are safe to expose: one reads, and the other only narrows authority.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::host::plugin_folder_grants::{self, ForbiddenRoots, GrantStatus, PluginFolderRefusal};

/// One granted plugin folder and, when it grants nothing right now, why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginFolderGrant {
    pub path: String,
    pub unavailable_reason: Option<String>,
}

fn grant_dto(status: GrantStatus) -> PluginFolderGrant {
    PluginFolderGrant {
        path: status.path.display().to_string(),
        unavailable_reason: status.unavailable.map(|reason| reason.to_string()),
    }
}

/// Grant the folder the user picked, answering with the canonical path that
/// was granted. Main process only.
pub async fn grant_plugin_folder(path: String) -> Result<String, String> {
    on_blocking_pool(move || {
        let location = store_location()?;
        plugin_folder_grants::grant_at(&location, &forbidden_roots()?, Path::new(path.trim()))
            .map(|granted| granted.display().to_string())
            .map_err(PluginFolderCommandError::Refused)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Every granted folder, in grant order, each with the reason it is unavailable
/// when it is. With no store, as under a refused runtime scope, the listing is
/// refused rather than answered as no grants.
pub async fn get_plugin_folder_grants() -> Result<Vec<PluginFolderGrant>, String> {
    on_blocking_pool(|| {
        let location = store_location()?;
        Ok(
            plugin_folder_grants::list_at(&location, &forbidden_roots()?)
                .into_iter()
                .map(grant_dto)
                .collect(),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

/// Remove the grant stored for exactly `path`. A folder that is not granted is
/// already revoked, so that succeeds too.
pub async fn revoke_plugin_folder_grant(path: String) -> Result<(), String> {
    on_blocking_pool(move || {
        let location = store_location()?;
        plugin_folder_grants::revoke_at(&location, &PathBuf::from(path))
            .map_err(PluginFolderCommandError::Refused)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Why a plugin folder command refused. `Display` is the text the renderer
/// receives, byte-identical to the text it replaced (ADR 0059).
#[derive(Debug)]
enum PluginFolderCommandError {
    Refused(PluginFolderRefusal),
    /// The forbidden roots could not be read, in the grant store's own words.
    ForbiddenRoots(String),
    Task(tokio::task::JoinError),
}

impl fmt::Display for PluginFolderCommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(refusal) => write!(f, "{refusal}"),
            Self::ForbiddenRoots(reason) => f.write_str(reason),
            Self::Task(error) => write!(f, "Plugin folder task failed: {error}"),
        }
    }
}

impl std::error::Error for PluginFolderCommandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Refused(refusal) => Some(refusal),
            Self::ForbiddenRoots(_) => None,
            Self::Task(error) => Some(error),
        }
    }
}

fn store_location() -> Result<PathBuf, PluginFolderCommandError> {
    plugin_folder_grants::production_store_location().ok_or_else(|| {
        PluginFolderCommandError::Refused(PluginFolderRefusal::StoreUnavailable(
            "no application data directory".to_string(),
        ))
    })
}

fn forbidden_roots() -> Result<ForbiddenRoots, PluginFolderCommandError> {
    ForbiddenRoots::production().map_err(PluginFolderCommandError::ForbiddenRoots)
}

async fn on_blocking_pool<T: Send + 'static>(
    body: impl FnOnce() -> Result<T, PluginFolderCommandError> + Send + 'static,
) -> Result<T, PluginFolderCommandError> {
    tokio::task::spawn_blocking(body)
        .await
        .map_err(PluginFolderCommandError::Task)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block_on_test;
    use crate::host::plugin_folder_grants::test_support::TempTree;

    // Tests run with no grant store, the state a refused runtime scope leaves.
    fn is_store_refusal(result: &Result<impl std::fmt::Debug, String>) -> bool {
        result.as_ref().is_err_and(|error| {
            *error
                == PluginFolderRefusal::StoreUnavailable(
                    "no application data directory".to_string(),
                )
                .to_string()
        })
    }

    #[test]
    fn granting_without_a_grant_store_is_refused() {
        let tree = TempTree::create("command-grant-no-store");
        let folder = tree.dir("Plugins");

        let result = block_on_test(grant_plugin_folder(folder.display().to_string()));

        assert!(is_store_refusal(&result), "unexpected result {result:?}");
    }

    #[test]
    fn revoking_without_a_grant_store_is_refused() {
        let tree = TempTree::create("command-revoke-no-store");
        let folder = tree.dir("Plugins");

        let result = block_on_test(revoke_plugin_folder_grant(folder.display().to_string()));

        assert!(is_store_refusal(&result), "unexpected result {result:?}");
    }

    #[test]
    fn listing_without_a_grant_store_is_refused_rather_than_reporting_no_grants() {
        let result = block_on_test(get_plugin_folder_grants());

        assert!(is_store_refusal(&result), "unexpected result {result:?}");
    }
}
