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

type WasmModule = {
    default: () => Promise<unknown>;
    decode_audio_bytes: (bytes: Uint8Array) => WasmDecoded;
};

type WasmDecoded = {
    readonly sample_rate: number;
    readonly channels: number;
    readonly total_frames: number;
    /** Consumes the instance — do not call `.free()` or access getters after. */
    take_samples: () => Float32Array;
    free: () => void;
};

const WASM_JS_URL = '/wasm/daw-wasm-decoder/daw_wasm_decoder.js';

let modulePromise: Promise<WasmModule | null> | null = null;

async function loadWasmModule(): Promise<WasmModule | null> {
    if (!modulePromise) {
        modulePromise = (async () => {
            try {
                const mod = (await import(/* @vite-ignore */ WASM_JS_URL)) as unknown as WasmModule;
                await mod.default();
                return mod;
            } catch (err) {
                console.warn('[wasmDecoding] failed to load WASM decoder module:', err);
                return null;
            }
        })();
    }
    return modulePromise;
}

export type WasmDecodedAudio = {
    /** Interleaved samples: [L0, R0, L1, R1, …]. */
    interleaved: Float32Array;
    sampleRate: number;
    channels: number;
    totalFrames: number;
};

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
        if (totalFrames === 0 || channels === 0 || sampleRate === 0) {
            decoded.free();
            return null;
        }
        const interleaved = decoded.take_samples();
        // take_samples consumed the instance — do NOT call .free() in finally.
        decoded = null;
        return { interleaved, sampleRate, channels, totalFrames };
    } catch (err) {
        console.warn('[wasmDecoding] decode failed:', err);
        decoded?.free();
        return null;
    }
}

/**
 * Convert interleaved f32 PCM from the WASM decoder into an `AudioBuffer`
 * for Web Audio playback/scheduling.
 */
export function wasmDecodedToAudioBuffer(
    decoded: WasmDecodedAudio,
    audioContext: AudioContext | OfflineAudioContext
): AudioBuffer {
    const { interleaved, sampleRate, channels, totalFrames } = decoded;
    const buffer = audioContext.createBuffer(channels, totalFrames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
        const channelData = buffer.getChannelData(ch);
        for (let frame = 0; frame < totalFrames; frame++) {
            channelData[frame] = interleaved[frame * channels + ch] ?? 0;
        }
    }
    return buffer;
}
