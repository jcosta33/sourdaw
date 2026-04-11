import { createDecodeError } from '../errors/DecodeError';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { audioBufferCache } from '../stores/audioBufferCache';
import { decodeAudioFile as nativeDecodeAudioFile } from '../repositories/audioDecoding/tauriDecoding/decodeAudioFile';
import { samplesToAudioBuffer } from '../repositories/audioDecoding/samplesToAudioBuffer';
import { isTauri } from '#/helpers/tauriBridge';
import { decodeAudioBytesWasm } from '../repositories/audioDecoding/wasmDecoding/decodeAudioBytesWasm';
import { wasmDecodedToAudioBuffer } from '../repositories/audioDecoding/wasmDecoding/wasmDecodedToAudioBuffer';

/**
 * Decode an audio file from a File object.
 *
 * - In Tauri: uses the native symphonia decoder via `audioDecoding` repo
 *   for broad codec support (OGG, FLAC, AAC, ALAC, MP3 on WebKit).
 * - In browser: tries Web Audio `decodeAudioData` first (off-thread, fast,
 *   hardware-accelerated), falls back to the symphonia-powered WASM decoder
 *   for codecs the browser can't handle (ALAC, some m4a variants, …).
 *
 * The decoded buffer is automatically cached in `audioBufferCache`.
 */
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    if (isTauri()) {
        try {
            // Write to a temp file path so Rust can decode from disk
            const { invoke } = await import('@tauri-apps/api/core');
            const tempDir = (await invoke('get_model_dir')) as string;
            const tempPath = `${tempDir}/../cache/${file.name}`;

            // Write the file bytes
            await invoke('write_audio_file', {
                path: tempPath,
                data: Array.from(new Uint8Array(arrayBuffer)),
            });

            // Decode using the new typed repository
            const decoded = await nativeDecodeAudioFile(tempPath);
            if (decoded) {
                const ctx = audioEngine.context;
                const buffer = samplesToAudioBuffer(decoded, ctx);
                const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                audioBufferCache.set(id, buffer);
                return { id, buffer };
            }
        } catch {
            // Fallback to Web Audio if Tauri command fails
        }
    }

    // Browser path: native first — off-thread, fast, handles WAV/MP3/FLAC/OGG/AAC.
    // decodeAudioData detaches the ArrayBuffer, so re-read from File for the
    // WASM fallback below.
    const ctx = audioEngine.context;
    try {
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        audioBufferCache.set(id, buffer);
        return { id, buffer };
    } catch {
        // Native decoder couldn't handle this file — try the symphonia WASM decoder.
    }

    const wasmBytes = await file.arrayBuffer();
    const wasmDecoded = await decodeAudioBytesWasm(wasmBytes);
    if (!wasmDecoded) {
        throw createDecodeError(`Unable to decode "${file.name}" — format not supported.`);
    }
    const buffer = wasmDecodedToAudioBuffer(wasmDecoded, ctx);
    const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
