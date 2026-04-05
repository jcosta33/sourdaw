//! daw-wasm-decoder — browser-side audio file decoder.
//!
//! Wraps `daw-io::decode_audio_file_bytes` (symphonia) for use from JavaScript
//! via wasm-bindgen. Accepts raw file bytes, returns interleaved f32 PCM.
//!
//! Used in the browser path of `decodeAudioFile` to support codecs that the
//! Web Audio API's `decodeAudioData` cannot handle (ALAC, many m4a variants,
//! some FLAC/OGG edge cases).

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct DecodedAudioWasm {
    sample_rate: u32,
    channels: u32,
    total_frames: u32,
    /// Interleaved samples: [L0, R0, L1, R1, …] (or mono: [S0, S1, …]).
    interleaved: Vec<f32>,
}

#[wasm_bindgen]
impl DecodedAudioWasm {
    #[wasm_bindgen(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    #[wasm_bindgen(getter)]
    pub fn channels(&self) -> u32 {
        self.channels
    }

    #[wasm_bindgen(getter)]
    pub fn total_frames(&self) -> u32 {
        self.total_frames
    }

    /// Take the interleaved PCM samples, consuming this instance.
    /// After calling this, the JS wrapper is invalidated — do not call `.free()`
    /// or any getters on it. Call metadata getters *before* this.
    #[wasm_bindgen]
    pub fn take_samples(self) -> Vec<f32> {
        self.interleaved
    }
}

/// Decode an audio file from raw bytes. Returns `null` (JS undefined) on failure.
///
/// Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and any other format
/// handled by symphonia with the `all` feature set.
#[wasm_bindgen]
pub fn decode_audio_bytes(bytes: &[u8]) -> Result<DecodedAudioWasm, JsError> {
    let decoded = daw_io::decode_audio_file_bytes(bytes.to_vec())
        .map_err(|e| JsError::new(&e))?;

    // daw-io returns per-channel Vec<Vec<f32>>; interleave for Web Audio consumption.
    let channels = decoded.channels as usize;
    let total_frames = decoded.samples.first().map(|c| c.len()).unwrap_or(0);

    let mut interleaved = Vec::with_capacity(total_frames * channels);
    for frame in 0..total_frames {
        for ch in 0..channels {
            let sample = decoded.samples.get(ch).and_then(|c| c.get(frame)).copied().unwrap_or(0.0);
            interleaved.push(sample);
        }
    }

    Ok(DecodedAudioWasm {
        sample_rate: decoded.sample_rate,
        channels: decoded.channels,
        total_frames: total_frames as u32,
        interleaved,
    })
}
