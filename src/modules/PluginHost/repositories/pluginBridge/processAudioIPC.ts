import { logger } from '#/infra/logger/appLogger';
import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * Handles raw audio bytes crossing from the AudioWorklet bridge to Rust and back.
 * Bypasses JSON entirely: the trailing byte payload crosses on the desktop
 * bridge's binary IPC channel.
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
 * The last failure reported per plugin instance, so a backend that fails on
 * every block logs once per distinct cause instead of once per render quantum. A
 * relay running at 128 frames issues hundreds of round trips a second, and a
 * swallowed error and a flooded console are equally unreadable.
 *
 * Keyed by instance rather than shared: with one latch, two instances failing
 * for different reasons overwrite each other's cause and report on every block,
 * and one instance recovering silences a different instance that is still
 * failing.
 */
const lastReportedFailureByInstance = new Map<string, string>();

function reportProcessAudioFailure(instanceId: string, message: string): void {
    if (lastReportedFailureByInstance.get(instanceId) === message) {
        return;
    }

    lastReportedFailureByInstance.set(instanceId, message);
    logger.warn(`Native plugin audio processing failed: ${message}`);
}

export async function processAudioIPC(input: ProcessAudioIPCInput): ProcessAudioIPCOutput {
    if (!isDesktopRuntime()) {
        return null;
    }

    try {
        const response = await desktopInvoke('process_plugin_audio', {
            instanceId: input.instanceId,
            audioBytes: input.audioBytes,
        });

        const audioBytes = normalizeAudioBytes(response);
        if (audioBytes === null && response !== null && response !== undefined) {
            // The command answered with something that is not audio bytes. That
            // is a disagreement at the boundary, not a plugin producing nothing
            // — the two are indistinguishable downstream, so name it here.
            // A null or undefined response is the legitimate "no output yet"
            // case and stays silent.
            reportProcessAudioFailure(
                input.instanceId,
                `unreadable response for instance ${input.instanceId}: ${typeof response}`
            );
            return null;
        }

        lastReportedFailureByInstance.delete(input.instanceId);
        return audioBytes;
    } catch (error) {
        // Still null: the relay must hand the worklet its buffer back, and a
        // throw here would strand it. But the cause no longer disappears —
        // an unresolved instance, a stopped engine and a missing bridge all
        // used to look like a plugin that simply produced nothing.
        reportProcessAudioFailure(input.instanceId, String(error));
        return null;
    }
}
