import { logger } from '#/infra/logger/appLogger';
import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

/**
 * Handles raw audio bytes crossing from the AudioWorklet bridge to Rust and back.
 * Bypasses JSON entirely to use binary payloads on the Tauri custom protocol.
 */
type ProcessAudioIPCInput = {
    /**
     * The plugin instance id — the identifier both sides already agree on.
     *
     * Deliberately not the engine plugin id: that id is reserved inside the
     * Rust audio engine, never reaches the frontend, and a placeholder value
     * resolves no bridge, which degrades to an unprocessed dry signal instead
     * of a visible error. Rust resolves the engine id from this instance id.
     */
    instanceId: string;
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

/**
 * The last failure reported, so a backend that fails on every block logs once
 * per distinct cause instead of once per render quantum. A relay running at 128
 * frames issues hundreds of round trips a second, and a swallowed error and a
 * flooded console are equally unreadable.
 */
let lastReportedFailure: string | null = null;

function reportProcessAudioFailure(error: unknown): void {
    const message = String(error);
    if (message === lastReportedFailure) {
        return;
    }

    lastReportedFailure = message;
    logger.warn(`Native plugin audio processing failed: ${message}`);
}

export async function processAudioIPC(input: ProcessAudioIPCInput): ProcessAudioIPCOutput {
    if (!isTauri()) {
        return null;
    }

    try {
        const response = await tauriInvoke('process_plugin_audio', {
            instanceId: input.instanceId,
            audioBytes: input.audioBytes,
        });

        lastReportedFailure = null;
        return normalizeAudioBytes(response);
    } catch (error) {
        // Still null: the relay must hand the worklet its buffer back, and a
        // throw here would strand it. But the cause no longer disappears —
        // an unresolved instance, a stopped engine and a missing bridge all
        // used to look like a plugin that simply produced nothing.
        reportProcessAudioFailure(error);
        return null;
    }
}
