//! daw-wasm-decoder — browser-side audio file decoder.
//!
//! Wraps `daw-io::decode_audio_file_bytes` (symphonia) for use from JavaScript
//! via wasm-bindgen. Accepts raw file bytes, returns interleaved f32 PCM.
//!
//! Used in the browser path of `decodeAudioFile` to support codecs that the
//! Web Audio API's `decodeAudioData` cannot handle (ALAC, many m4a variants,
//! some FLAC/OGG edge cases).

use wasm_bindgen::prelude::*;

/// Install `console_error_panic_hook` once at wasm module init so a Rust panic
/// surfaces a readable message on the JS console instead of an opaque
/// `unreachable` trap that silently poisons the decoder instance (WB-6).
/// Wasm-only by construction; the native build is unaffected.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Replace every non-finite sample (NaN, +Inf, -Inf) in `block` with silence,
/// returning the count scrubbed (DSP-8). A malformed decode can yield
/// non-finite PCM; a single non-finite sample in a WebAudio buffer propagates
/// and can silence the whole graph, so the decoded block is scrubbed at the
/// output boundary before it is handed to JS. RT-safe: no allocation, one
/// branch per sample.
#[inline]
fn sanitize_block(block: &mut [f32]) -> usize {
    let mut scrubbed = 0;
    for sample in block.iter_mut() {
        if !sample.is_finite() {
            *sample = 0.0;
            scrubbed += 1;
        }
    }
    scrubbed
}

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
    pub fn take_samples(mut self) -> Vec<f32> {
        // Scrub-only DSP-8 guard: a malformed decode can yield non-finite PCM
        // and this is the wasm float output boundary that hands samples to the
        // graph (decodeAudioBytesWasm.ts). `take_samples` consumes the instance,
        // so unlike the per-block RT devices there is no persistent instance to
        // poll — no counter seam — and the block is scrubbed in place.
        sanitize_block(&mut self.interleaved);
        self.interleaved
    }
}

/// Decode an audio file from raw bytes. Returns `null` (JS undefined) on failure.
///
/// Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and any other format
/// handled by symphonia with the `all` feature set.
#[wasm_bindgen]
pub fn decode_audio_bytes(bytes: &[u8]) -> Result<DecodedAudioWasm, JsError> {
    let decoded = daw_io::decode_audio_file_bytes(bytes.to_vec()).map_err(|e| JsError::new(&e))?;

    // daw-io returns per-channel Vec<Vec<f32>>; interleave for Web Audio consumption.
    let channels = decoded.channels as usize;
    let total_frames = decoded.samples.first().map(|c| c.len()).unwrap_or(0);

    let mut interleaved = Vec::with_capacity(total_frames * channels);
    for frame in 0..total_frames {
        for ch in 0..channels {
            let sample = decoded
                .samples
                .get(ch)
                .and_then(|c| c.get(frame))
                .copied()
                .unwrap_or(0.0);
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

#[cfg(test)]
mod tests {
    use super::DecodedAudioWasm;

    /// DSP-8 red→green at the decoder boundary: a malformed decode can leave
    /// non-finite PCM in the interleaved buffer, and `take_samples` — the wasm
    /// float output boundary that hands samples to the graph — scrubs it to
    /// silence. Finite samples pass through unchanged.
    #[test]
    fn take_samples_scrubs_non_finite_pcm() {
        let decoded = DecodedAudioWasm {
            sample_rate: 48_000,
            channels: 2,
            total_frames: 3,
            interleaved: vec![0.5, f32::NAN, f32::INFINITY, -0.25, f32::NEG_INFINITY, 0.75],
        };

        // RED: the decoded buffer carries non-finite samples pre-boundary.
        assert!(
            decoded.interleaved.iter().any(|s| !s.is_finite()),
            "precondition: the raw decoded PCM propagates non-finite samples"
        );

        // GREEN: the output boundary scrubs every non-finite sample to silence
        // and leaves finite samples untouched.
        let out = decoded.take_samples();
        assert!(
            out.iter().all(|s| s.is_finite()),
            "every non-finite sample must be scrubbed"
        );
        assert_eq!(out, vec![0.5, 0.0, 0.0, -0.25, 0.0, 0.75]);
    }
}
