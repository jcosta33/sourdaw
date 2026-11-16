//! Commands over the plugin folders the user granted beyond the platform's own.
//!
//! [`grant_plugin_folder`] is the one route that adds a folder, and the desktop
//! shell reaches it only from its main process, with the path a native folder
//! dialog just returned; it is withheld from the renderer. Listing and revoking
//! are safe to expose: one reads, and the other only narrows authority.

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
        plugin_folder_grants::grant_at(
            &location,
            &ForbiddenRoots::production()?,
            Path::new(path.trim()),
        )
        .map(|granted| granted.display().to_string())
        .map_err(|refusal| refusal.to_string())
    })
    .await
}

/// Every granted folder, in grant order, each with the reason it is unavailable
/// when it is.
pub async fn get_plugin_folder_grants() -> Result<Vec<PluginFolderGrant>, String> {
    on_blocking_pool(|| {
        let Some(location) = plugin_folder_grants::production_store_location() else {
            return Ok(Vec::new());
        };
        Ok(
            plugin_folder_grants::list_at(&location, &ForbiddenRoots::production()?)
                .into_iter()
                .map(grant_dto)
                .collect(),
        )
    })
    .await
}

/// Remove the grant stored for exactly `path`. A folder that is not granted is
/// already revoked, so that succeeds too.
pub async fn revoke_plugin_folder_grant(path: String) -> Result<(), String> {
    on_blocking_pool(move || {
        let location = store_location()?;
        plugin_folder_grants::revoke_at(&location, &PathBuf::from(path))
            .map_err(|refusal| refusal.to_string())
    })
    .await
}

fn store_location() -> Result<PathBuf, String> {
    plugin_folder_grants::production_store_location().ok_or_else(|| {
        PluginFolderRefusal::StoreUnavailable("no application data directory".to_string())
            .to_string()
    })
}

async fn on_blocking_pool<T: Send + 'static>(
    body: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(body)
        .await
        .map_err(|error| format!("Plugin folder task failed: {error}"))?
}
