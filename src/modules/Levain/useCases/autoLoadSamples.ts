/**
 * Auto-load levain samples when the engine is ready.
 * Loads VSCO-2-CE samples (CC0) for the given instrument from its manifest.
 * Only loads once per session per instrument.
 */

import { loadInstrumentFromManifest, WEB_LOD } from '../repositories/sampleLoader';
import { setSampleLoadProgress } from '../stores/levainStore';
import { resolveResource } from '@tauri-apps/api/path';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Load levain samples for a specific instrument into the worklet node.
 * Automatically clears previous zones before loading.
 */
export async function autoLoadLevainSamples(
    nodePort: MessagePort,
    instrumentId: string = 'violin-1',
): Promise<void> {
    let manifestBase = `/samples/levain/${instrumentId}`;
    
    // In Tauri desktop, we bypass the embedded frontend cache 
    // and load massive 1.2GB sample banks straight from OS resources.
    if (isTauri) {
        try {
            // Tauri places parent-relative bundle assets under _up_ to protect the root Resources directory
            const localPath = await resolveResource(`_up_/public/samples/levain/${instrumentId}`);
            const { convertFileSrc } = ((await import('@tauri-apps/api/core')) as unknown) as { convertFileSrc: (p: string) => string };
            manifestBase = convertFileSrc(localPath);
        } catch (e) {
            console.warn('[Levain] Failed to resolve Tauri resource path:', e);
        }
    }

    const manifestUrl = `${manifestBase}/manifest.json`;

    setSampleLoadProgress(0.01); // trigger UI loading state

    try {
        await loadInstrumentFromManifest(
            manifestUrl,
            manifestBase,
            nodePort,
            WEB_LOD,
            (progress) => {
                setSampleLoadProgress(progress);
            },
        );
    } catch (err) {
        console.warn(`[Levain] Failed to load samples for ${instrumentId}:`, err);
        // Fallback sine tone will continue to work
    } finally {
        setSampleLoadProgress(1.0);
        setTimeout(() => setSampleLoadProgress(null), 300); // clear after short delay
    }
}
