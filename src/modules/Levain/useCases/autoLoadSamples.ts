import { resolveResource } from '@tauri-apps/api/path';

import { logger } from '#/infra/logger/appLogger';

import { WEB_LOD } from '../repositories/sampleLoader/helpers';
import { loadInstrumentFromManifest } from '../repositories/sampleLoader/loadInstrumentFromManifest';
import { setSampleLoadProgress } from '../stores/levainStore';

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
 */
export async function autoLoadLevainSamples(nodePort: MessagePort, instrumentId: string): Promise<void> {
    let manifestBase = `/samples/levain/${instrumentId}`;

    // In Tauri desktop, we bypass the embedded frontend cache
    // and load massive 1.2GB sample banks straight from OS resources.
    if (isTauri) {
        try {
            // Tauri places parent-relative bundle assets under _up_ to protect the root Resources directory
            const localPath = await resolveResource(`_up_/public/samples/levain/${instrumentId}`);
            const { convertFileSrc } = (await import('@tauri-apps/api/core')) as unknown as {
                convertFileSrc: (p: string) => string;
            };
            manifestBase = convertFileSrc(localPath);
        } catch (error) {
            logger.warn('[Levain] Failed to resolve Tauri resource path:', error);
        }
    }

    const manifestUrl = `${manifestBase}/manifest.json`;

    setSampleLoadProgress(0.01); // trigger UI loading state

    try {
        await loadInstrumentFromManifest(manifestUrl, manifestBase, nodePort, WEB_LOD, (progress) => {
            setSampleLoadProgress(progress);
        });
    } catch (error) {
        logger.warn(`[Levain] Failed to load samples for ${instrumentId}:`, error);
        // Fallback sine tone will continue to work
    } finally {
        setSampleLoadProgress(1.0);
        setTimeout(() => setSampleLoadProgress(null), 300); // clear after short delay
    }
}
