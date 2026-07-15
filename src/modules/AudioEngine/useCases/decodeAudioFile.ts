import { logger } from '#/infra/logger/appLogger';

import { createDecodeError } from '../errors/DecodeError';
import { decodeAudioBytesWasm } from '../repositories/audioDecoding/wasmDecoding/decodeAudioBytesWasm';
import { wasmDecodedToAudioBuffer } from '../repositories/audioDecoding/wasmDecoding/wasmDecodedToAudioBuffer';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { audioBufferCache } from '../stores/audioBufferCache';

/**
 * Decode an audio file from a File object.
 *
 * Web Audio is attempted first for its off-thread, hardware-accelerated path.
 * Symphonia-powered WASM handles codecs that the browser cannot decode.
 * The decoded buffer is automatically cached in `audioBufferCache`.
 */
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const ctx = audioEngine.context;

    try {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        const id = `audio-${crypto.randomUUID()}`;
        audioBufferCache.set(id, buffer);
        return { id, buffer };
    } catch (error) {
        logger.warn(
            `[decodeAudioFile] Web Audio decode failed for "${file.name}" — trying Symphonia WASM decoder:`,
            error
        );
    }

    // decodeAudioData detaches its input, so re-read the File for the WASM fallback.
    const wasmDecoded = await decodeAudioBytesWasm(await file.arrayBuffer());
    if (!wasmDecoded) {
        throw createDecodeError(`Unable to decode "${file.name}" — format not supported.`);
    }

    const buffer = wasmDecodedToAudioBuffer(wasmDecoded, ctx);
    const id = `audio-${crypto.randomUUID()}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
