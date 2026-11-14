#![cfg_attr(
    test,
    allow(clippy::unwrap_used, reason = "tests assert by unwrapping")
)]

pub mod discovery;
pub mod document_store;
pub mod persistence;
pub mod schema;

pub use automerge;
pub use document_store::DocumentStore;
pub use persistence::{load_sdaw_bundle, save_sdaw_bundle};
pub use schema::DocId;
