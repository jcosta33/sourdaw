//! Root-document key names for the native Automerge project bundle.
//!
//! This file owns the **root** document's field names only — the keys
//! `DocumentStore` writes when it creates a project. Track, clip, and
//! automation field names are **not** owned here: the TypeScript serializer
//! `src/modules/Project/useCases/projectPersistence/fileIO/serializeArrangementTracks.ts`
//! is their sole authority, and the hydrator beside it is its inverse. Adding a
//! Rust mirror of those names creates a second definition that nothing ties to
//! the first: a rename on one side keeps compiling and only surfaces when a
//! user opens a shared project and finds fields missing.
//!
//! A constant belongs here when native Rust code writes or reads that key. Add
//! nothing on speculation.

/// Unique identifier for an Automerge document in the multi-document model.
pub type DocId = String;

// -- Root document keys --

/// Top-level key in the root Automerge document.
pub const KEY_PROJECT: &str = "project";

// Keys within the `project` map
pub const KEY_ID: &str = "id";
pub const KEY_NAME: &str = "name";
pub const KEY_SAMPLE_RATE: &str = "sampleRate";
pub const KEY_CREATED_AT: &str = "createdAt";
pub const KEY_UPDATED_AT: &str = "updatedAt";

/// Map of track ID → { ref: DocId, orderKey: String }
pub const KEY_TRACKS: &str = "tracks";

/// Map of connection ID → connection data
pub const KEY_ROUTING: &str = "routing";
pub const KEY_CONNECTIONS: &str = "connections";

/// Map of marker ID → marker data
pub const KEY_MARKERS: &str = "markers";

/// Map of asset hash → asset metadata
pub const KEY_ASSETS: &str = "assets";

/// Transport configuration (persisted subset)
pub const KEY_TRANSPORT: &str = "transport";

/// Tempo map entries
pub const KEY_TEMPO_MAP: &str = "tempoMap";

/// Time signature map entries
pub const KEY_TIME_SIGNATURE_MAP: &str = "timeSignatureMap";

// -- Document IDs --

/// The root document's complete id — not a namespace prefix. Child document
/// ids (`track_…`, `clip_…`, `auto_…`) are minted by the TypeScript side.
pub const DOC_PREFIX_ROOT: &str = "root";
