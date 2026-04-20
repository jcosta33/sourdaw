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
        // Note: Tauri v2 IPC allows us to pass Uint8Array bodies natively
        const bodyArray = new Uint8Array(audioData.buffer);

        const responseArray = (await tauriInvoke('audio_ipc', {
            instanceId,
            body: bodyArray,
        })) as Uint8Array;

        // Reconstitute back from Rust
        return new Float32Array(responseArray.buffer);
    } catch (error) {
        logger.warn('Audio IPC failed', error);
        return audioData;
    }
}
