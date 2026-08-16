//! daw-wasm-decoder — browser-side audio file decoder.
//!
//! Wraps `daw-io::decode_audio_file_bytes_interleaved` (symphonia) for use from
//! JavaScript via wasm-bindgen. Accepts raw file bytes, returns interleaved f32
//! PCM. The interleaved entry point is deliberate: it hands the decoded buffer
//! straight through, so the module never holds the file in two PCM layouts.
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
    decode_warning_count: u32,
    decode_warning_summary: String,
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

    #[wasm_bindgen(getter)]
    pub fn decode_warning_count(&self) -> u32 {
        self.decode_warning_count
    }

    #[wasm_bindgen(getter)]
    pub fn decode_warning_summary(&self) -> String {
        self.decode_warning_summary.clone()
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

/// Decode an audio file from raw bytes.
///
/// Throws a `JsError` on failure — the JS caller must wrap the call in
/// `try`/`catch`; it never resolves to `null`.
///
/// Supports WAV, FLAC, MP3, OGG/Vorbis, AAC, ALAC, and any other format
/// handled by symphonia with the `all` feature set.
#[wasm_bindgen]
pub fn decode_audio_bytes(bytes: &[u8]) -> Result<DecodedAudioWasm, JsError> {
    let decoded = daw_io::decode_audio_file_bytes_interleaved(bytes.to_vec())
        .map_err(|e| JsError::new(&e))?;

    Ok(decoded_audio_to_wasm(decoded))
}

/// Clamp a frame count into the `u32` the JS getter exposes.
///
/// A plain `as u32` silently wraps past 2^32 frames (~24.8 h at 48 kHz) and
/// would report a decode of that length as near-empty, so the count saturates
/// instead — the same treatment `decode_warning_count` gets.
fn saturating_frame_count(frames: usize) -> u32 {
    u32::try_from(frames).unwrap_or(u32::MAX)
}

fn decoded_audio_to_wasm(decoded: daw_io::InterleavedAudio) -> DecodedAudioWasm {
    // daw-io accumulates interleaved, so the buffer moves through untouched:
    // no per-channel intermediate, no re-interleave pass, and no padding —
    // the buffer length is an exact multiple of the channel count by
    // construction, so there is no ragged tail to fabricate silence for.
    let total_frames = saturating_frame_count(decoded.frame_count());
    let decode_warning_count = u32::try_from(decoded.decode_warning_count).unwrap_or(u32::MAX);
    let decode_warning_summary = decoded.decode_warnings.join("; ");

    DecodedAudioWasm {
        sample_rate: decoded.sample_rate,
        channels: decoded.channels,
        total_frames,
        decode_warning_count,
        decode_warning_summary,
        interleaved: decoded.interleaved,
    }
}

#[cfg(test)]
mod tests {
    use super::{decoded_audio_to_wasm, saturating_frame_count, DecodedAudioWasm};

    fn interleaved(channels: u32, samples: Vec<f32>) -> daw_io::InterleavedAudio {
        daw_io::InterleavedAudio {
            sample_rate: 48_000,
            channels,
            duration_seconds: samples.len() as f64 / channels.max(1) as f64 / 48_000.0,
            interleaved: samples,
            codec: "test".to_string(),
            decode_warning_count: 0,
            decode_warnings: Vec::new(),
        }
    }

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
            decode_warning_count: 0,
            decode_warning_summary: String::new(),
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

    #[test]
    fn exposes_partial_decode_diagnostics_to_javascript() {
        let decoded = daw_io::InterleavedAudio {
            sample_rate: 48_000,
            channels: 1,
            interleaved: vec![0.25],
            duration_seconds: 1.0 / 48_000.0,
            codec: "test".to_string(),
            decode_warning_count: 2,
            decode_warnings: vec!["corrupt frame".to_string(), "truncated frame".to_string()],
        };

        let wasm = decoded_audio_to_wasm(decoded);

        assert_eq!(wasm.decode_warning_count, 2);
        assert_eq!(
            wasm.decode_warning_summary,
            "corrupt frame; truncated frame"
        );
    }

    /// The frame count crosses into JS as a `u32`. A `usize as u32` cast wraps
    /// silently past 2^32 frames and would report a 24.8-hour decode as
    /// near-empty, so the conversion saturates.
    #[test]
    fn frame_counts_beyond_u32_saturate_instead_of_wrapping() {
        let beyond_u32 = usize::try_from(u64::from(u32::MAX) + 1).expect("the test host is 64-bit");

        assert_eq!(saturating_frame_count(0), 0);
        assert_eq!(saturating_frame_count(u32::MAX as usize), u32::MAX);
        assert_eq!(saturating_frame_count(beyond_u32), u32::MAX);
    }

    /// daw-io hands over a buffer whose length is an exact multiple of the
    /// channel count, so the bridge reports the frames it actually has and
    /// never appends fabricated silence to square off a ragged tail.
    #[test]
    fn frames_are_reported_from_the_buffer_without_padding() {
        let wasm = decoded_audio_to_wasm(interleaved(2, vec![0.1, 1.1, 0.2, 1.2]));

        assert_eq!(wasm.channels, 2);
        assert_eq!(wasm.total_frames, 2);
        assert_eq!(wasm.interleaved, vec![0.1, 1.1, 0.2, 1.2]);
    }
}
