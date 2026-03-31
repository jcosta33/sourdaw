use std::collections::HashMap;

use automerge::transaction::Transactable;
use automerge::{AutoCommit, AutoSerde, Change, ReadDoc};

use crate::schema::{
    DocId, DOC_PREFIX_ROOT, KEY_ASSETS, KEY_CONNECTIONS, KEY_CREATED_AT, KEY_ID, KEY_MARKERS,
    KEY_NAME, KEY_PROJECT, KEY_ROUTING, KEY_SAMPLE_RATE, KEY_TEMPO_MAP, KEY_TIME_SIGNATURE_MAP,
    KEY_TRACKS, KEY_TRANSPORT, KEY_UPDATED_AT,
};

/// Manages a set of linked Automerge documents forming a DAW project.
///
/// The multi-document model splits the project into a root document (metadata,
/// track registry, routing, markers, transport) plus child documents for each
/// track, MIDI clip, and automation lane. This enables selective sync and
/// independent history compaction.
pub struct DocumentStore {
    docs: HashMap<DocId, AutoCommit>,
    root_id: DocId,
}

impl DocumentStore {
    /// Create a new project with a root document.
    pub fn create_project(name: &str, sample_rate: u32) -> Self {
        let root_id = DOC_PREFIX_ROOT.to_string();
        let mut root = AutoCommit::new();

        let project = root
            .put_object(automerge::ROOT, KEY_PROJECT, automerge::ObjType::Map)
            .expect("failed to create project map");

        let project_id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as f64;

        root.put(&project, KEY_ID, project_id).ok();
        root.put(&project, KEY_NAME, name).ok();
        root.put(&project, KEY_SAMPLE_RATE, sample_rate as i64).ok();
        root.put(&project, KEY_CREATED_AT, now).ok();
        root.put(&project, KEY_UPDATED_AT, now).ok();

        // Initialize empty maps for collections
        root.put_object(&project, KEY_TRACKS, automerge::ObjType::Map)
            .ok();
        root.put_object(&project, KEY_ROUTING, automerge::ObjType::Map)
            .ok();
        root.put_object(&project, KEY_MARKERS, automerge::ObjType::Map)
            .ok();
        root.put_object(&project, KEY_ASSETS, automerge::ObjType::Map)
            .ok();
        root.put_object(&project, KEY_TRANSPORT, automerge::ObjType::Map)
            .ok();
        root.put_object(&project, KEY_TEMPO_MAP, automerge::ObjType::Map)
            .ok();
        root.put_object(
            &project,
            KEY_TIME_SIGNATURE_MAP,
            automerge::ObjType::Map,
        )
        .ok();

        // Initialize routing.connections sub-map
        if let Some((_, routing_id)) = root.get(&project, KEY_ROUTING).ok().flatten() {
            root.put_object(&routing_id, KEY_CONNECTIONS, automerge::ObjType::Map)
                .ok();
        }

        let mut docs = HashMap::new();
        docs.insert(root_id.clone(), root);

        Self { docs, root_id }
    }

    /// Get a reference to the root document ID.
    pub fn root_id(&self) -> &DocId {
        &self.root_id
    }

    /// Get a reference to a document by ID.
    pub fn get_doc(&self, id: &str) -> Option<&AutoCommit> {
        self.docs.get(id)
    }

    /// Get a mutable reference to a document by ID.
    pub fn get_doc_mut(&mut self, id: &str) -> Option<&mut AutoCommit> {
        self.docs.get_mut(id)
    }

    /// Insert or replace a document.
    pub fn insert_doc(&mut self, id: DocId, doc: AutoCommit) {
        self.docs.insert(id, doc);
    }

    /// Create a new empty child document and insert it.
    pub fn create_child_doc(&mut self, id: DocId) -> &mut AutoCommit {
        self.docs.insert(id.clone(), AutoCommit::new());
        self.docs.get_mut(&id).unwrap()
    }

    /// Remove a document by ID.
    pub fn remove_doc(&mut self, id: &str) -> Option<AutoCommit> {
        self.docs.remove(id)
    }

    /// List all document IDs.
    pub fn doc_ids(&self) -> Vec<&DocId> {
        self.docs.keys().collect()
    }

    /// Apply a remote change to a specific document.
    pub fn apply_change(&mut self, doc_id: &str, change: Change) -> Result<(), String> {
        let doc = self
            .docs
            .get_mut(doc_id)
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        doc.apply_changes(vec![change])
            .map_err(|e| format!("Failed to apply change: {}", e))?;
        Ok(())
    }

    /// Merge another document's state into the local document.
    pub fn merge_doc(&mut self, doc_id: &str, other: &mut AutoCommit) -> Result<(), String> {
        let doc = self
            .docs
            .get_mut(doc_id)
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        doc.merge(other)
            .map_err(|e| format!("Failed to merge: {}", e))?;
        Ok(())
    }

    /// Save a single document to binary.
    pub fn save_doc(&mut self, doc_id: &str) -> Option<Vec<u8>> {
        self.docs.get_mut(doc_id).map(|doc| doc.save())
    }

    /// Save all documents as a map of DocId -> binary.
    pub fn save_all(&mut self) -> HashMap<DocId, Vec<u8>> {
        self.docs
            .iter_mut()
            .map(|(id, doc)| (id.clone(), doc.save()))
            .collect()
    }

    /// Load documents from a map of DocId -> binary, replacing current state.
    pub fn load_all(bundle: HashMap<DocId, Vec<u8>>) -> Result<Self, String> {
        let mut docs = HashMap::new();
        let mut root_id = DOC_PREFIX_ROOT.to_string();

        for (id, bytes) in bundle {
            let doc = AutoCommit::load(&bytes)
                .map_err(|e| format!("Failed to load document {}: {}", id, e))?;
            if id.starts_with(DOC_PREFIX_ROOT) {
                root_id = id.clone();
            }
            docs.insert(id, doc);
        }

        if !docs.contains_key(&root_id) {
            return Err("Bundle missing root document".to_string());
        }

        Ok(Self { docs, root_id })
    }

    /// Merge an external bundle into the current store.
    /// Documents with matching IDs are merged; new documents are inserted.
    pub fn merge_bundle(&mut self, bundle: HashMap<DocId, Vec<u8>>) -> Result<MergeResult, String> {
        let mut result = MergeResult::default();

        for (id, bytes) in bundle {
            let mut incoming = AutoCommit::load(&bytes)
                .map_err(|e| format!("Failed to load document {}: {}", id, e))?;

            if let Some(existing) = self.docs.get_mut(&id) {
                existing
                    .merge(&mut incoming)
                    .map_err(|e| format!("Failed to merge document {}: {}", id, e))?;
                result.merged_doc_ids.push(id);
            } else {
                self.docs.insert(id.clone(), incoming);
                result.new_doc_ids.push(id);
            }
        }

        Ok(result)
    }

    /// Export the root document state as a JSON value for the frontend.
    pub fn export_root_json(&self) -> Result<serde_json::Value, String> {
        let doc = self
            .docs
            .get(&self.root_id)
            .ok_or("Root document not found")?;
        let auto_serde = AutoSerde::from(doc);
        serde_json::to_value(&auto_serde)
            .map_err(|e| format!("Failed to serialize root doc: {}", e))
    }

    /// Export a child document state as a JSON value for the frontend.
    pub fn export_doc_json(&self, doc_id: &str) -> Result<serde_json::Value, String> {
        let doc = self
            .docs
            .get(doc_id)
            .ok_or_else(|| format!("Document not found: {}", doc_id))?;
        let auto_serde = AutoSerde::from(doc);
        serde_json::to_value(&auto_serde)
            .map_err(|e| format!("Failed to serialize doc {}: {}", doc_id, e))
    }
}

/// Summary of a merge operation.
#[derive(Debug, Default)]
pub struct MergeResult {
    /// Document IDs that were merged with existing documents.
    pub merged_doc_ids: Vec<DocId>,
    /// Document IDs that were newly added (not previously present).
    pub new_doc_ids: Vec<DocId>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_project_has_root_doc() {
        let store = DocumentStore::create_project("Test Project", 48000);
        assert_eq!(store.root_id(), "root");
        assert!(store.get_doc("root").is_some());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let mut store = DocumentStore::create_project("Roundtrip Test", 44100);
        let bundle = store.save_all();

        let loaded = DocumentStore::load_all(bundle).expect("load should succeed");
        assert_eq!(loaded.root_id(), "root");
        assert!(loaded.get_doc("root").is_some());
    }

    #[test]
    fn create_and_retrieve_child_doc() {
        let mut store = DocumentStore::create_project("Test", 48000);
        store.create_child_doc("track_abc".to_string());

        assert!(store.get_doc("track_abc").is_some());
        assert_eq!(store.doc_ids().len(), 2);
    }

    #[test]
    fn merge_bundle_adds_new_docs() {
        let mut store_a = DocumentStore::create_project("Project A", 48000);
        store_a.create_child_doc("track_1".to_string());

        let mut store_b = DocumentStore::create_project("Project B", 48000);
        store_b.create_child_doc("track_2".to_string());

        let bundle_b = store_b.save_all();
        let result = store_a.merge_bundle(bundle_b).expect("merge should succeed");

        assert!(result.new_doc_ids.contains(&"track_2".to_string()));
        assert!(result.merged_doc_ids.contains(&"root".to_string()));
    }

    #[test]
    fn load_all_fails_without_root() {
        let mut bundle = HashMap::new();
        let mut doc = AutoCommit::new();
        bundle.insert("track_orphan".to_string(), doc.save());

        let result = DocumentStore::load_all(bundle);
        assert!(result.is_err());
    }

    #[test]
    fn export_root_json_works() {
        let store = DocumentStore::create_project("JSON Test", 48000);
        let json = store.export_root_json().expect("should export JSON");
        assert!(json["project"]["name"].as_str().is_some());
    }
}
