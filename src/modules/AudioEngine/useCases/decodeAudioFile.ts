import { logger } from '#/infra/logger/appLogger';
import { isTauri } from '#/utils/tauriBridge';

import { createDecodeError } from '../errors/DecodeError';
import { samplesToAudioBuffer } from '../repositories/audioDecoding/samplesToAudioBuffer';
import { decodeAudioFile as nativeDecodeAudioFile } from '../repositories/audioDecoding/tauriDecoding/decodeAudioFile';
import { decodeAudioBytesWasm } from '../repositories/audioDecoding/wasmDecoding/decodeAudioBytesWasm';
import { wasmDecodedToAudioBuffer } from '../repositories/audioDecoding/wasmDecoding/wasmDecodedToAudioBuffer';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { audioBufferCache } from '../stores/audioBufferCache';

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
/**
 * Reduce a (possibly hostile) `File.name` to a bare filename safe to append to
 * a cache directory. Strips any directory components (both `/` and `\`
 * separators) and neutralises `..` traversal segments so a name like
 * `../../etc/passwd` cannot escape the cache dir.
 */
export function sanitizeCacheFileName(name: string): string {
    // Take the last path segment, treating both POSIX and Windows separators.
    // Splitting on the separators leaves `base` free of any path components.
    const base = name.split(/[/\\]/).pop() ?? '';
    // Reject pure-dot segments (".", "..") that survive the split; fall back to a
    // safe default if nothing usable remains.
    if (base === '' || base === '.' || base === '..') {
        return 'audio-file';
    }
    return base;
}

export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    if (isTauri()) {
        // The Tauri IPC bridge must load before we can talk to the native
        // decoder at all; a failure here means "Tauri unavailable" (misconfig
        // or non-Tauri runtime) and is distinct from a decoder-side failure.
        let invoke: typeof import('@tauri-apps/api/core').invoke | null = null;
        try {
            ({ invoke } = await import('@tauri-apps/api/core'));
        } catch (error) {
            logger.warn('[decodeAudioFile] Tauri unavailable — falling back to browser decoder:', error);
        }

        if (invoke) {
            try {
                // Write to a temp file path so Rust can decode from disk.
                const tempDir = (await invoke('get_model_dir')) as string;
                // Sanitise the filename before joining it to the cache dir so a
                // hostile `file.name` (e.g. "../../secret") cannot write outside it.
                const safeName = sanitizeCacheFileName(file.name);
                const tempPath = `${tempDir}/../cache/${safeName}`;

                // Write the file bytes
                await invoke('write_audio_file', {
                    path: tempPath,
                    data: new Uint8Array(arrayBuffer),
                });

                // Decode using the new typed repository
                const decoded = await nativeDecodeAudioFile(tempPath);
                if (decoded) {
                    const ctx = audioEngine.context;
                    const buffer = samplesToAudioBuffer(decoded, ctx);
                    const id = `audio-${crypto.randomUUID()}`;
                    audioBufferCache.set(id, buffer);
                    return { id, buffer };
                }
                // `decoded` was null/empty — native decoder produced nothing usable.
                logger.warn(
                    `[decodeAudioFile] Tauri decoder returned no samples for "${file.name}" — falling back to browser decoder.`
                );
            } catch (error) {
                // The IPC commands or symphonia decoder threw — surface it rather
                // than silently masking a Tauri-side decoder/misconfig failure.
                logger.warn(
                    `[decodeAudioFile] Tauri decoder failed for "${file.name}" — falling back to browser decoder:`,
                    error
                );
            }
        }
    }

    // Browser path: native first — off-thread, fast, handles WAV/MP3/FLAC/OGG/AAC.
    // decodeAudioData detaches the ArrayBuffer, so re-read from File for the
    // WASM fallback below.
    const ctx = audioEngine.context;
    try {
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        const id = `audio-${crypto.randomUUID()}`;
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
    const id = `audio-${crypto.randomUUID()}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
