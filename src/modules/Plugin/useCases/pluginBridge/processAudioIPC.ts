import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

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
        // Here we cast Float32Array -> Uint8Array to send to Rust
        const bodyArray = new Uint8Array(audioData.buffer);

        const responseArray = (await tauriInvoke('audio_ipc', {
            instanceId,
            body: Array.from(bodyArray),
        })) as number[];

        // Reconstitute back from Rust
        return new Float32Array(new Uint8Array(responseArray).buffer);
    } catch (error) {
        console.error('Audio IPC failed', error);
        return audioData;
    }
}
