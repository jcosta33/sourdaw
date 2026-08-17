use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use daw_collab::discovery::{LanDiscovery, NearbySession};
use daw_collab::document_store::DocumentStore;

use super::filesystem;

/// Managed state for the CRDT collaboration layer.
pub struct CollabState {
    pub store: Mutex<Option<DocumentStore>>,
    pub discovery: Mutex<Option<LanDiscovery>>,
}

impl Default for CollabState {
    fn default() -> Self {
        Self {
            store: Mutex::new(None),
            discovery: Mutex::new(None),
        }
    }
}

fn get_or_create_discovery(guard: &mut Option<LanDiscovery>) -> Result<&mut LanDiscovery, String> {
    if guard.is_none() {
        *guard = Some(LanDiscovery::new()?);
    }

    guard
        .as_mut()
        .ok_or_else(|| "Failed to initialize LAN discovery".to_string())
}

#[derive(Serialize, Deserialize)]
pub struct MergeResultResponse {
    pub merged_doc_ids: Vec<String>,
    pub new_doc_ids: Vec<String>,
}

// -- CRDT document commands --

pub fn collab_create_project(
    state: &CollabState,
    name: String,
    sample_rate: u32,
) -> Result<bool, String> {
    let store = DocumentStore::create_project(&name, sample_rate)?;
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    *guard = Some(store);
    Ok(true)
}

pub fn collab_save_bundle(state: &CollabState, path: String) -> Result<bool, String> {
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    let store = guard.as_mut().ok_or("No CRDT project loaded")?;
    let bundle = store.save_all();
    let bundle_path = filesystem::require_extension(
        filesystem::resolve_writable_file_path(&path)?,
        "sdaw",
        "Collaboration bundle",
    )?;
    daw_collab::save_sdaw_bundle(&bundle, &bundle_path)?;
    Ok(true)
}

pub fn collab_load_bundle(
    state: &CollabState,
    path: String,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let bundle_path = filesystem::require_extension(
        filesystem::resolve_existing_file_path(&path)?,
        "sdaw",
        "Collaboration bundle",
    )?;
    let bundle = daw_collab::load_sdaw_bundle(&bundle_path)?;
    let store = DocumentStore::load_all(bundle.clone())?;
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    *guard = Some(store);
    Ok(bundle)
}

pub fn collab_get_document_state(
    state: &CollabState,
    doc_id: String,
) -> Result<serde_json::Value, String> {
    let guard = state.store.lock().map_err(|e| e.to_string())?;
    let store = guard.as_ref().ok_or("No CRDT project loaded")?;
    store.export_doc_json(&doc_id)
}

pub fn collab_merge_bundle(
    state: &CollabState,
    path: String,
) -> Result<MergeResultResponse, String> {
    let bundle_path = filesystem::require_extension(
        filesystem::resolve_existing_file_path(&path)?,
        "sdaw",
        "Collaboration bundle",
    )?;
    let bundle = daw_collab::load_sdaw_bundle(&bundle_path)?;
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    let store = guard.as_mut().ok_or("No CRDT project loaded")?;
    let result = store.merge_bundle(bundle)?;
    Ok(MergeResultResponse {
        merged_doc_ids: result.merged_doc_ids,
        new_doc_ids: result.new_doc_ids,
    })
}

pub fn collab_apply_change(
    state: &CollabState,
    doc_id: String,
    change_bytes: Vec<u8>,
) -> Result<bool, String> {
    let mut guard = state.store.lock().map_err(|e| e.to_string())?;
    let store = guard.as_mut().ok_or("No CRDT project loaded")?;
    let change = daw_collab::automerge::Change::from_bytes(change_bytes)
        .map_err(|e| format!("Invalid change data: {}", e))?;
    store.apply_change(&doc_id, change)?;
    Ok(true)
}

// -- LAN discovery commands --

pub fn collab_start_advertising(
    state: &CollabState,
    session_id: String,
    host_name: String,
    project_name: String,
    port: u16,
    approval_required: bool,
) -> Result<bool, String> {
    let mut guard = state.discovery.lock().map_err(|e| e.to_string())?;
    let discovery = get_or_create_discovery(&mut guard)?;
    discovery.advertise(
        &session_id,
        &host_name,
        &project_name,
        port,
        approval_required,
    )?;
    Ok(true)
}

pub fn collab_stop_advertising(state: &CollabState) -> Result<bool, String> {
    let mut guard = state.discovery.lock().map_err(|e| e.to_string())?;
    if let Some(discovery) = guard.as_mut() {
        discovery.stop_advertising()?;
    }
    Ok(true)
}

pub fn collab_start_browsing(state: &CollabState) -> Result<bool, String> {
    let mut guard = state.discovery.lock().map_err(|e| e.to_string())?;
    let discovery = get_or_create_discovery(&mut guard)?;
    discovery.start_browsing()?;
    Ok(true)
}

pub fn collab_stop_browsing(state: &CollabState) -> Result<bool, String> {
    let mut guard = state.discovery.lock().map_err(|e| e.to_string())?;
    if let Some(discovery) = guard.as_mut() {
        discovery.stop_browsing()?;
    }
    Ok(true)
}

pub fn collab_get_nearby_sessions(state: &CollabState) -> Result<Vec<NearbySession>, String> {
    let guard = state.discovery.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(discovery) => Ok(discovery.get_nearby_sessions()),
        None => Ok(vec![]),
    }
}

/// Retire LAN discovery as the application exits.
///
/// `LanDiscovery` is held in managed state for the whole process lifetime, so
/// without an explicit exit hook the mDNS daemon thread, the browse thread, and
/// any live advertisement outlive the quit: peers keep seeing the session as
/// joinable until the record's TTL expires, and joining it fails. Called from
/// the `RunEvent::Exit` arm in `lib.rs`.
///
/// A poisoned mutex is recovered rather than treated as a reason to skip the
/// shutdown. Poisoning means a command panicked mid-advertise, which is exactly
/// when a registration is most likely to be live and pending retirement; the
/// `LanDiscovery` behind the lock is unaffected by the panic and still able to
/// retire it.
pub fn shutdown_discovery(state: &CollabState) {
    let mut guard = state
        .discovery
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(discovery) = guard.take() else {
        return;
    };
    if let Err(error) = discovery.shutdown() {
        eprintln!("[Collab] Failed to shut down LAN discovery: {error}");
    }
}
