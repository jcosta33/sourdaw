import { logger } from '#/infra/logger/appLogger';

import { createDecodeError } from '../errors/DecodeError';
import { decodeAudioBytesWasm } from '../repositories/audioDecoding/wasmDecoding/decodeAudioBytesWasm';
import { wasmDecodedToAudioBuffer } from '../repositories/audioDecoding/wasmDecoding/wasmDecodedToAudioBuffer';
import { audioEngine } from '../repositories/createWebAudioEngine';

/**
 * Decode an audio file without assigning project identity or caching the result.
 *
 * Web Audio is attempted first for its off-thread, hardware-accelerated path.
 * Symphonia-powered WASM handles codecs that the browser cannot decode.
 */
export async function decodeAudioFileBuffer(file: File): Promise<AudioBuffer> {
    const ctx = audioEngine.context;

    try {
        return await ctx.decodeAudioData(await file.arrayBuffer());
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

    return wasmDecodedToAudioBuffer(wasmDecoded, ctx);
}
