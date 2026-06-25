import { resolveResource } from '@tauri-apps/api/path';

import { logger } from '#/infra/logger/appLogger';

import { WEB_LOD } from '../repositories/sampleLoader/helpers';
import { loadInstrumentFromManifest } from '../repositories/sampleLoader/loadInstrumentFromManifest';
import { setSampleLoadError, setSampleLoadProgress } from '../stores/levainStore';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Load levain samples for a specific instrument into the worklet node.
 * Automatically clears previous zones before loading.
 *
 * `instrumentId` is required — callers must pass the instrument from the
 * active patch (see `levainStore`). The previous silent default (`'violin-1'`)
 * caused the engine to eagerly load violin samples on every Levain node
 * construction regardless of which instrument the user had actually selected;
 * those samples would then race the patch-driven reload in `registerLevainDevice`.
 *
 * `signal` lets the caller cancel a load that a newer load for the same device
 * has superseded. When aborted, this function bails without writing the worklet
 * zone map or claiming completion, so the last-started load — not the
 * last-finishing one — owns the engine state and the UI.
 */
export async function autoLoadLevainSamples(
    deviceId: string,
    nodePort: MessagePort,
    instrumentId: string,
    signal?: AbortSignal
): Promise<void> {
    let manifestBase = `/samples/levain/${instrumentId}`;

    // In Tauri desktop, we bypass the embedded frontend cache
    // and load massive 1.2GB sample banks straight from OS resources.
    if (isTauri) {
        try {
            // Tauri places parent-relative bundle assets under _up_ to protect the root Resources directory
            const localPath = await resolveResource(`_up_/public/samples/levain/${instrumentId}`);
            const tauriCore = await import('@tauri-apps/api/core');
            // eslint-disable-next-line sourdaw/no-type-assertion-escape -- dynamic import type doesn't expose convertFileSrc; runtime value is structurally correct
            const { convertFileSrc } = tauriCore as unknown as { convertFileSrc: (p: string) => string };
            manifestBase = convertFileSrc(localPath);
        } catch (error) {
            logger.warn('[Levain] Failed to resolve Tauri resource path:', error);
        }
    }

    // A newer load may have superseded this one while the resource path
    // resolved. Bail before touching the UI so we don't clobber its state.
    if (signal?.aborted) {
        return;
    }

    const manifestUrl = `${manifestBase}/manifest.json`;

    setSampleLoadProgress(deviceId, 0.01); // trigger UI loading state

    try {
        await loadInstrumentFromManifest(
            manifestUrl,
            manifestBase,
            nodePort,
            WEB_LOD,
            (progress) => {
                if (signal?.aborted) {
                    return;
                }
                setSampleLoadProgress(deviceId, progress);
            },
            signal
        );
    } catch (error) {
        // A superseding load aborted this one; it owns the UI now, stay silent.
        if (signal?.aborted) {
            return;
        }
        logger.warn(`[Levain] Failed to load samples for ${instrumentId}:`, error);
        // Fallback sine tone will continue to work. Surface the failure instead
        // of flashing a synthetic 100% then "Ready".
        setSampleLoadError(deviceId, error instanceof Error ? error.message : 'Sample load failed');
        return;
    }

    // Completed but superseded — don't claim 100%/Ready over the newer load.
    if (signal?.aborted) {
        return;
    }
    setSampleLoadProgress(deviceId, 1.0);
    setTimeout(() => {
        if (signal?.aborted) {
            return;
        }
        setSampleLoadProgress(deviceId, null);
    }, 300); // clear after short delay
}
