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

function normalizeAudioBytes(response: unknown): Uint8Array | null {
    if (response instanceof Uint8Array) {
        return new Uint8Array(response);
    }

    if (response instanceof ArrayBuffer) {
        return new Uint8Array(response.slice(0));
    }

    if (Array.isArray(response) && response.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        return new Uint8Array(response);
    }

    return null;
}

export async function processAudioIPC(input: ProcessAudioIPCInput): ProcessAudioIPCOutput {
    if (!isTauri()) {
        return null;
    }

    try {
        const response = await tauriInvoke('process_plugin_audio', {
            enginePluginId: input.enginePluginId,
            audioBytes: input.audioBytes,
        });

        return normalizeAudioBytes(response);
    } catch {
        return null;
    }
}
