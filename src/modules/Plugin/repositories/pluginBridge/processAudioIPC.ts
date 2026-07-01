import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

/**
 * Handles raw audio bytes crossing from the AudioWorklet bridge to Rust and back.
 * Bypasses JSON entirely to use binary payloads on the Tauri custom protocol.
 */
type ProcessAudioIPCInput = {
    enginePluginId: number;
    audioBytes: Uint8Array;
};

type ProcessAudioIPCOutput = Promise<Uint8Array | null>;

export async function processAudioIPC(input: ProcessAudioIPCInput): ProcessAudioIPCOutput {
    if (!isTauri()) {
        return null;
    }

    try {
        const response = await tauriInvoke('process_plugin_audio', {
            enginePluginId: input.enginePluginId,
            audioBytes: input.audioBytes,
        });

        if (response instanceof Uint8Array) {
            return response;
        }

        return null;
    } catch {
        return null;
    }
}
