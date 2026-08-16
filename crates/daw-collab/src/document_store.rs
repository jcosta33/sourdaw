use std::collections::HashMap;

use automerge::transaction::Transactable;
use automerge::{AutoCommit, AutoSerde, Change};

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

/// Attach the key being written to an Automerge failure.
///
/// Project creation writes a fixed set of keys and the rest of the system
/// assumes every one of them exists. A write that fails must surface here, with
/// the key named, rather than leave a document that is missing a collection the
/// first projection will look for.
fn wrote<T>(result: Result<T, automerge::AutomergeError>, key: &str) -> Result<T, String> {
    result.map_err(|error| format!("Failed to write project key '{}': {}", key, error))
}

/// Reject a bundle carrying a document that shadows the project root.
///
/// `DOC_PREFIX_ROOT` is the root document's whole id, not a namespace prefix
/// like `track_`, so any other id starting with it is a second document
/// claiming to be the project. Every entry point that takes a bundle applies
/// this: a check on the read path alone would let the app write a `.sdaw` it
/// can never reopen.
///
/// The message names only what the bundle actually holds — a bundle with a
/// shadowing id and no `root` carries zero roots, not two.
fn reject_root_shadowing<'ids>(ids: impl IntoIterator<Item = &'ids str>) -> Result<(), String> {
    let mut has_root = false;
    let mut shadowing: Vec<&str> = Vec::new();

    for id in ids {
        if id == DOC_PREFIX_ROOT {
            has_root = true;
        } else if id.starts_with(DOC_PREFIX_ROOT) {
            shadowing.push(id);
        }
    }

    if shadowing.is_empty() {
        return Ok(());
    }

    shadowing.sort_unstable();
    let shadowing = shadowing.join(", ");
    if has_root {
        return Err(format!(
            "Bundle carries more than one root document: {}, {}",
            DOC_PREFIX_ROOT, shadowing
        ));
    }

    Err(format!(
        "Bundle carries no root document, only ids shadowing it: {}",
        shadowing
    ))
}

impl DocumentStore {
    /// Create a new project with a root document.
    pub fn create_project(name: &str, sample_rate: u32) -> Result<Self, String> {
        let root_id = DOC_PREFIX_ROOT.to_string();
        let mut root = AutoCommit::new();

        let project = wrote(
            root.put_object(automerge::ROOT, KEY_PROJECT, automerge::ObjType::Map),
            KEY_PROJECT,
        )?;

        let project_id = uuid::Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as f64;

        wrote(root.put(&project, KEY_ID, project_id), KEY_ID)?;
        wrote(root.put(&project, KEY_NAME, name), KEY_NAME)?;
        wrote(
            root.put(&project, KEY_SAMPLE_RATE, sample_rate as i64),
            KEY_SAMPLE_RATE,
        )?;
        wrote(root.put(&project, KEY_CREATED_AT, now), KEY_CREATED_AT)?;
        wrote(root.put(&project, KEY_UPDATED_AT, now), KEY_UPDATED_AT)?;

        // Initialize empty maps for collections
        for key in [
            KEY_TRACKS,
            KEY_MARKERS,
            KEY_ASSETS,
            KEY_TRANSPORT,
            KEY_TEMPO_MAP,
            KEY_TIME_SIGNATURE_MAP,
        ] {
            wrote(root.put_object(&project, key, automerge::ObjType::Map), key)?;
        }

        // `routing.connections` hangs off the object id the write just handed
        // back, so it can no longer be skipped because a separate read-back of
        // `routing` failed.
        let routing = wrote(
            root.put_object(&project, KEY_ROUTING, automerge::ObjType::Map),
            KEY_ROUTING,
        )?;
        wrote(
            root.put_object(&routing, KEY_CONNECTIONS, automerge::ObjType::Map),
            KEY_CONNECTIONS,
        )?;

        let mut docs = HashMap::new();
        docs.insert(root_id.clone(), root);

        Ok(Self { docs, root_id })
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
    ///
    /// `DOC_PREFIX_ROOT` is the root document's whole id, not a namespace
    /// prefix like `track_`, so the root is matched by equality. Matching it by
    /// prefix let any `root…`-named document stand in for the project, and with
    /// more than one match the winner varied with `HashMap` iteration order —
    /// `export_root_json` would then hand the frontend a different document run
    /// to run. A bundle carrying a root-shadowing id is rejected rather than
    /// resolved by guesswork.
    pub fn load_all(bundle: HashMap<DocId, Vec<u8>>) -> Result<Self, String> {
        reject_root_shadowing(bundle.keys().map(String::as_str))?;

        let mut docs = HashMap::new();

        for (id, bytes) in bundle {
            let doc = AutoCommit::load(&bytes)
                .map_err(|e| format!("Failed to load document {}: {}", id, e))?;
            docs.insert(id, doc);
        }

        let root_id = DOC_PREFIX_ROOT.to_string();
        if !docs.contains_key(&root_id) {
            return Err("Bundle missing root document".to_string());
        }

        Ok(Self { docs, root_id })
    }

    /// Merge an external bundle into the current store.
    /// Documents with matching IDs are merged; new documents are inserted.
    ///
    /// Root-shadowing ids are rejected here too, before anything is inserted or
    /// merged: accepting one on this path and refusing it in `load_all` let the
    /// app save a `.sdaw` it could never reopen.
    pub fn merge_bundle(&mut self, bundle: HashMap<DocId, Vec<u8>>) -> Result<MergeResult, String> {
        reject_root_shadowing(bundle.keys().map(String::as_str))?;

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

    fn project(name: &str) -> DocumentStore {
        DocumentStore::create_project(name, 48000).expect("project creation must succeed")
    }

    /// `DocumentStore` is not `Debug`, so `expect_err` is unavailable.
    fn load_error(bundle: HashMap<DocId, Vec<u8>>, expectation: &str) -> String {
        match DocumentStore::load_all(bundle) {
            Ok(_) => panic!("{expectation}"),
            Err(error) => error,
        }
    }

    #[test]
    fn create_project_has_root_doc() {
        let store = project("Test Project");
        assert_eq!(store.root_id(), "root");
        assert!(store.get_doc("root").is_some());
    }

    /// Every write in `create_project` is checked, so a successful call is a
    /// promise that the whole documented shape is present — including
    /// `routing.connections`, which used to be written only if a separate
    /// read-back of `routing` happened to succeed.
    #[test]
    fn create_project_writes_every_documented_key() {
        let store = project("Key Coverage");
        let json = store.export_root_json().expect("should export JSON");
        let project = &json["project"];

        assert_eq!(project["name"], "Key Coverage");
        assert_eq!(project["sampleRate"], 48000);
        assert!(project["id"].as_str().is_some());
        assert!(project["createdAt"].as_f64().is_some());
        assert!(project["updatedAt"].as_f64().is_some());
        for key in [
            "tracks",
            "routing",
            "markers",
            "assets",
            "transport",
            "tempoMap",
            "timeSignatureMap",
        ] {
            assert!(project[key].is_object(), "missing collection map: {key}");
        }
        assert!(
            project["routing"]["connections"].is_object(),
            "routing.connections must always be initialized"
        );
    }

    #[test]
    fn save_and_load_roundtrip() {
        let mut store = DocumentStore::create_project("Roundtrip Test", 44100)
            .expect("project creation must succeed");
        let bundle = store.save_all();

        let loaded = DocumentStore::load_all(bundle).expect("load should succeed");
        assert_eq!(loaded.root_id(), "root");
        assert!(loaded.get_doc("root").is_some());
    }

    #[test]
    fn create_and_retrieve_child_doc() {
        let mut store = project("Test");
        store.create_child_doc("track_abc".to_string());

        assert!(store.get_doc("track_abc").is_some());
        assert_eq!(store.doc_ids().len(), 2);
    }

    #[test]
    fn merge_bundle_adds_new_docs() {
        let mut store_a = project("Project A");
        store_a.create_child_doc("track_1".to_string());

        let mut store_b = project("Project B");
        store_b.create_child_doc("track_2".to_string());

        let bundle_b = store_b.save_all();
        let result = store_a
            .merge_bundle(bundle_b)
            .expect("merge should succeed");

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

    /// A prefix match let `root_backup` take over as the project root, and with
    /// both present the winner varied with hash order. Ambiguity is now an
    /// error rather than a coin flip.
    #[test]
    fn load_all_rejects_a_bundle_with_a_root_shadowing_document() {
        let mut store = project("Shadowed");
        let mut bundle = store.save_all();
        let root_bytes = bundle
            .get("root")
            .expect("the saved bundle carries a root")
            .clone();
        bundle.insert("root_backup".to_string(), root_bytes);

        let error = load_error(bundle, "an ambiguous root must not be resolved");

        assert_eq!(
            error,
            "Bundle carries more than one root document: root, root_backup"
        );
    }

    /// Without the real root present, a lone `root_backup` used to be adopted
    /// silently as the project.
    ///
    /// The bundle carries zero roots, so the rejection must not claim it
    /// carries two — the id it names has to be an id the bundle actually holds.
    #[test]
    fn load_all_does_not_adopt_a_root_shadowing_document_as_the_project() {
        let mut store = project("Shadowed");
        let mut bundle = store.save_all();
        let root_bytes = bundle.remove("root").expect("the saved bundle has a root");
        bundle.insert("root_backup".to_string(), root_bytes);

        let error = load_error(
            bundle,
            "a root-shadowing id must not stand in for the project",
        );

        assert_eq!(
            error,
            "Bundle carries no root document, only ids shadowing it: root_backup"
        );
    }

    /// `merge_bundle` used to accept exactly the bundle `load_all` refuses, so
    /// the app could write a `.sdaw` and then never reopen it.
    #[test]
    fn merge_bundle_rejects_a_root_shadowing_document() {
        let mut store = project("Host");
        let mut incoming = project("Incoming");
        let mut bundle = incoming.save_all();
        let root_bytes = bundle
            .get("root")
            .expect("the saved bundle carries a root")
            .clone();
        bundle.insert("root_backup".to_string(), root_bytes);

        let error = store
            .merge_bundle(bundle)
            .expect_err("a bundle the loader refuses must not be merged either");

        assert_eq!(
            error,
            "Bundle carries more than one root document: root, root_backup"
        );
        assert!(
            store.get_doc("root_backup").is_none(),
            "a rejected bundle must leave nothing behind"
        );
        assert_eq!(
            store.doc_ids().len(),
            1,
            "a rejected bundle must not insert or merge anything"
        );
    }

    /// The read and write paths must agree on what a bundle may contain, or a
    /// saved project stops being loadable.
    #[test]
    fn merge_bundle_and_load_all_reject_the_same_bundles() {
        let mut store = project("Shadowed");
        let mut bundle = store.save_all();
        let root_bytes = bundle.remove("root").expect("the saved bundle has a root");
        bundle.insert("root_backup".to_string(), root_bytes);

        let merge_error = project("Host")
            .merge_bundle(bundle.clone())
            .expect_err("the merge path refuses a root-shadowing bundle");
        let load_error = load_error(bundle, "the load path refuses a root-shadowing bundle");

        assert_eq!(merge_error, load_error);
    }

    #[test]
    fn export_root_json_works() {
        let store = project("JSON Test");
        let json = store.export_root_json().expect("should export JSON");
        assert!(json["project"]["name"].as_str().is_some());
    }
}
