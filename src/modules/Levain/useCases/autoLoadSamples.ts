import { logger } from '#/infra/logger/appLogger';

import { type MicPositionType } from '../models/LevainPatch';
import { WEB_LOD } from '../repositories/sampleLoader/helpers';
import { loadInstrumentFromManifest } from '../repositories/sampleLoader/loadInstrumentFromManifest';
import { resolveSampleBasePath } from '../repositories/sampleLoader/resolveSampleBasePath';
import { setSampleLoadError, setSampleLoadProgress } from '../stores/levainStore';

/**
 * Load levain samples for a specific instrument into the worklet node.
 * Stages the replacement transactionally and keeps the sounding bank intact
 * until the worklet acknowledges a successful commit.
 *
 * `instrumentId` is required — callers must pass the instrument from the
 * active patch (see `levainStore`). The previous silent default (`'violin-1'`)
 * caused the engine to eagerly load violin samples on every Levain node
 * construction regardless of which instrument the user had actually selected;
 * those samples would then race the patch-driven reload in `registerLevainDevice`.
 *
 * `signal` lets the caller cancel a load that a newer load for the same device
 * has superseded. When aborted, this function cancels the staged replacement
 * without changing the committed bank or claiming completion, so the
 * last-started load — not the last-finishing one — owns engine state and UI.
 *
 * Returns the committed bank's mic position names, or `null` when the call
 * returns early (superseded before or during the load, or the loader resolved
 * no bank). This function never writes `loadedMicPositions` itself: an
 * offline render also drives this loader with the live device's id and an
 * offline render node's port, and writing the store here would let an export
 * or freeze clear or overwrite the live panel's rows. Only the live route
 * (`loadSamplesForInstrument`) owns that store field, using the return value.
 */
export async function autoLoadLevainSamples(
    deviceId: string,
    nodePort: MessagePort,
    instrumentId: string,
    signal?: AbortSignal
): Promise<readonly MicPositionType[] | null> {
    // The repository owns the desktop IPC: on desktop it resolves the bundled
    // resource directory (massive sample banks straight from OS resources); on
    // web it returns the public `/samples/levain/<id>` path.
    const manifestBase = await resolveSampleBasePath(instrumentId);

    // A newer load may have superseded this one while the resource path
    // resolved. Bail before touching the UI so we don't clobber its state.
    if (signal?.aborted) {
        return null;
    }

    const manifestUrl = `${manifestBase}/manifest.json`;

    setSampleLoadProgress(deviceId, 0.01); // trigger UI loading state

    let bank: Awaited<ReturnType<typeof loadInstrumentFromManifest>>;
    try {
        bank = await loadInstrumentFromManifest({
            manifestUrl,
            basePath: manifestBase,
            expectedInstrumentId: instrumentId,
            nodePort,
            lod: WEB_LOD,
            onProgress: (progress) => {
                if (signal?.aborted) {
                    return;
                }
                setSampleLoadProgress(deviceId, progress);
            },
            signal,
        });
    } catch (error) {
        // A superseding load aborted this one; it owns the UI now, stay silent.
        if (signal?.aborted) {
            return null;
        }
        logger.warn(`[Levain] Failed to load samples for ${instrumentId}:`, error);
        // Fallback sine tone will continue to work. Surface the failure instead
        // of flashing a synthetic 100% then "Ready".
        setSampleLoadError(deviceId, error instanceof Error ? error.message : 'Sample load failed');
        throw error;
    }

    // Completed but superseded — don't claim 100%/Ready over the newer load.
    if (signal?.aborted) {
        return null;
    }
    setSampleLoadProgress(deviceId, 1.0);
    setTimeout(() => {
        if (signal?.aborted) {
            return;
        }
        setSampleLoadProgress(deviceId, null);
    }, 300); // clear after short delay

    return bank ? bank.micPositions : null;
}
