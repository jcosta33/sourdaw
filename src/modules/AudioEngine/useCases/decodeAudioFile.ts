import { logger } from '#/infra/logger/appLogger';

import { createDecodeError } from '../errors/DecodeError';
import { samplesToAudioBuffer } from '../repositories/audioDecoding/samplesToAudioBuffer';
import { decodeAudioFile as nativeDecodeAudioFile } from '../repositories/audioDecoding/tauriDecoding/decodeAudioFile';
import { writeAudioFileToCache } from '../repositories/audioDecoding/tauriDecoding/writeAudioFileToCache';
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
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    try {
        const cachedFile = await writeAudioFileToCache({ fileName: file.name, contents: arrayBuffer });

        if (cachedFile.kind === 'unavailable') {
            logger.warn('[decodeAudioFile] Tauri unavailable — falling back to browser decoder:', cachedFile.error);
        }

        if (cachedFile.kind === 'ready') {
            const decoded = await nativeDecodeAudioFile(cachedFile.path);
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
        }
    } catch (error) {
        // The IPC commands or symphonia decoder threw — surface it rather
        // than silently masking a Tauri-side decoder/misconfig failure.
        logger.warn(
            `[decodeAudioFile] Tauri decoder failed for "${file.name}" — falling back to browser decoder:`,
            error
        );
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
