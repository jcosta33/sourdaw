import { logger } from '#/infra/logger/appLogger';

import { loadWasmDecoderModule } from './loadWasmDecoderModule';

import type { WasmDecodedAudio } from './helpers';
import type { WasmDecoded, WasmDecoderModule } from './loadWasmDecoderModule';

/**
 * Browser-side audio decoder powered by the `daw-wasm-decoder` crate (symphonia).
 *
 * Supports codecs that Web Audio's `decodeAudioData` cannot handle reliably in
 * Chrome/Firefox: ALAC, most AAC/m4a variants, OGG/Vorbis, FLAC, MP3, and more.
 *
 * The WASM module (~1MB) is lazy-loaded on first call so startup is unaffected.
 * Used as a fallback after `decodeAudioData` fails — it decodes synchronously
 * on the main thread, so it should not be the primary path for common formats.
 */

let modulePromise: Promise<WasmDecoderModule | null> | null = null;

async function loadWasmModule(): Promise<WasmDecoderModule | null> {
    const initialization =
        modulePromise ??
        (modulePromise = (async () => {
            try {
                const mod = await loadWasmDecoderModule();
                await mod.default();
                return mod;
            } catch (error) {
                logger.warn('[wasmDecoding] failed to load WASM decoder module:', error);
                return null;
            }
        })());
    const mod = await initialization;
    if (mod === null && modulePromise === initialization) {
        modulePromise = null;
    }
    return mod;
}

/**
 * Decode audio file bytes via the Rust/symphonia WASM decoder.
 * Returns `null` if the module fails to load or the decode fails.
 */
export async function decodeAudioBytesWasm(bytes: ArrayBuffer): Promise<WasmDecodedAudio | null> {
    const mod = await loadWasmModule();
    if (!mod) {
        return null;
    }
    let decoded: WasmDecoded | null = null;
    try {
        decoded = mod.decode_audio_bytes(new Uint8Array(bytes));
        // Read metadata BEFORE take_samples() — it consumes the instance.
        const sampleRate = decoded.sample_rate;
        const channels = decoded.channels;
        const totalFrames = decoded.total_frames;
        const decodeWarningCount = decoded.decode_warning_count;
        const decodeWarningSummary = decoded.decode_warning_summary;
        if (totalFrames === 0 || channels === 0 || sampleRate === 0) {
            decoded.free();
            return null;
        }
        if (decodeWarningCount > 0) {
            const packetLabel = decodeWarningCount === 1 ? 'packet' : 'packets';
            logger.warn(
                `[wasmDecoding] skipped ${String(decodeWarningCount)} corrupt audio ${packetLabel}:`,
                decodeWarningSummary
            );
        }
        const interleaved = decoded.take_samples();
        // take_samples consumed the instance — do NOT call .free() in finally.
        decoded = null;
        return { interleaved, sampleRate, channels, totalFrames };
    } catch (error) {
        logger.warn('[wasmDecoding] decode failed:', error);
        decoded?.free();
        return null;
    }
}
