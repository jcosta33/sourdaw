//! Install a consented, renderer-downloaded Whisper artifact into the local
//! model cache.
//!
//! The renderer fetches the pinned artifact only after an explicit user
//! gesture and verifies it before this boundary is called; this command
//! re-verifies the exact bytes against the same spec the read path enforces
//! before anything reaches disk, so a corrupted or tampered download can
//! never become the file `load_cached_whisper_model` later trusts. This
//! boundary never downloads.

use super::speech::WHISPER_MODEL;
use super::verified_cached_model;

/// Verify renderer-downloaded Whisper bytes against the pinned artifact spec
/// and store them as the cached model, atomically replacing any previous
/// entry.
pub async fn store_verified_whisper_model(bytes: Vec<u8>) -> Result<(), String> {
    verified_cached_model::write_verified_cached_model(&WHISPER_MODEL, bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_model_spec_pins_the_admitted_release_artifact() {
        // ADR 0030 admits exactly this artifact; the renderer's download
        // descriptor mirrors these values and fails closed against them.
        assert_eq!(WHISPER_MODEL.filename, "ggml-base.en.bin");
        assert_eq!(WHISPER_MODEL.expected_size_bytes, 147_964_211);
        assert_eq!(
            WHISPER_MODEL.expected_sha256,
            "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
        );
    }
}
