import { logger } from '#/infra/logger/appLogger';

import { decodeCrumbsSampleFile } from '../repositories/sampleTransfer/decodeCrumbsSampleFile';
import { crumbsStore } from '../stores/crumbsStore';

export type PrepareCrumbsEngineInput = {
    /** Device id; also the Crumbs instance key on `crumbsStore`. */
    deviceId: string;
    /** Worklet port of the Crumbs instance being configured. */
    port: MessagePort;
    /** Aborts the read/decode on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * Give a wasm Crumbs instance the sample and mode the device is set to play,
 * and resolve only once it can sound.
 *
 * ## Why one function serves live and offline
 *
 * Crumbs is built by two registries — `wasmDeviceRegistry` for playback and
 * `NATIVE_DSP_DEVICE_FACTORIES` for a render — and a `CrumbsInstance` starts
 * with an empty pool, so *neither* sounds until something loads a sample into
 * it. Two setup paths would be two chances to configure the engine differently,
 * which is the exact defect that made Levain export silence while playing
 * correctly. Both registries call this.
 *
 * ## What a browser build cannot do
 *
 * The sample's PCM only exists on disk: `loadSampleFromPath` records a native
 * `filePath` on the device's `activeSample` and the decoded audio stays in the
 * Rust pool. Reading it back needs the native bridge, so a Crumbs device in a
 * pure browser build has no sample to load — which is consistent, because the
 * catalog does not offer Crumbs there (`platform: 'native'`).
 *
 * ## Absent sample is not a failure
 *
 * A device the user has not loaded a sample into is silent in the session too;
 * `CrumbsEngine::note_on` returns immediately with no active sample. Resolving
 * quietly renders that same silence rather than failing an export over a device
 * that was never going to make a sound.
 */
export async function prepareCrumbsEngine({ deviceId, port, signal }: PrepareCrumbsEngineInput): Promise<void> {
    const state = crumbsStore.value?.[deviceId];
    if (!state) {
        return;
    }

    // Mode first: it is cheap, needs no I/O, and the engine reads it when a
    // note arrives rather than when it is set.
    port.postMessage({ type: 'mode', mode: state.mode });

    const filePath = state.activeSample?.filePath;
    if (!filePath) {
        return;
    }

    let decoded;
    try {
        decoded = await decodeCrumbsSampleFile({ filePath });
    } catch (error) {
        // Surfacing this as a throw would abort the caller's device setup; the
        // caller degrades to a silent-but-present device either way, so report
        // and let it.
        logger.warn(`[Crumbs] Could not load "${filePath}" for ${deviceId}: ${String(error)}`);
        return;
    }

    if (signal?.aborted) {
        return;
    }

    // Transfer rather than copy: a decoded sample is megabytes, and the sender
    // has no further use for it.
    port.postMessage(
        {
            type: 'loadSample',
            data: decoded.data,
            channels: decoded.channels,
            sampleRate: decoded.sampleRate,
        },
        [decoded.data.buffer]
    );
}
