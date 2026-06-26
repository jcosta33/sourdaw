import { logger } from '#/infra/logger/appLogger';
import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

/**
 * Handles the raw Float32Array crossing from the AudioWorklet to Rust and back.
 * Bypasses JSON entirely to use binary payloads on the Tauri custom protocol.
 */
export async function processAudioIPC(instanceId: string, audioData: Float32Array): Promise<Float32Array> {
    if (!isTauri()) {
        return audioData;
    }

    try {
        // Note: Tauri v2 IPC allows us to pass Uint8Array bodies natively.
        // Slice to the view's own region (`byteOffset`/`byteLength`) so a
        // Float32Array that is a window into a larger pooled buffer is sent
        // verbatim rather than from the backing buffer's start.
        const bodyArray = new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);

        const responseArray = (await tauriInvoke('audio_ipc', {
            instanceId,
            body: bodyArray,
        })) as Uint8Array;

        // Reconstitute back from Rust. Copy the response bytes into a fresh,
        // 4-byte-aligned buffer: the returned Uint8Array may be a view with a
        // nonzero `byteOffset` into a larger/pooled buffer, and constructing a
        // Float32Array directly off `.buffer` would read from the buffer start
        // and (when `byteLength` is not a multiple of 4) throw a RangeError.
        const frameCount = Math.floor(responseArray.byteLength / Float32Array.BYTES_PER_ELEMENT);
        const samples = new Float32Array(frameCount);
        new Uint8Array(samples.buffer).set(responseArray.subarray(0, frameCount * Float32Array.BYTES_PER_ELEMENT));
        return samples;
    } catch (error) {
        logger.warn('Audio IPC failed', error);
        return audioData;
    }
}
