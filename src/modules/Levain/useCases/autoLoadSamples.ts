/**
 * Auto-load levain samples when the engine is ready.
 * Downloads VSCO-2-CE violin samples and pushes them into the WASM engine.
 */

import { loadInstrumentFromManifest, WEB_LOD } from '../repositories/sampleLoader';

const MANIFEST_BASE = '/samples/levain/violin-sustain';
const MANIFEST_URL = `${MANIFEST_BASE}/manifest.json`;

let loaded = false;

/**
 * Load default levain samples into the worklet node.
 * Call this after the LevainNode's ready promise resolves.
 * Only loads once per session.
 */
export async function autoLoadLevainSamples(nodePort: MessagePort): Promise<void> {
    if (loaded) {
        return;
    }

    try {
        await loadInstrumentFromManifest(
            MANIFEST_URL,
            MANIFEST_BASE,
            nodePort,
            WEB_LOD,
            (progress) => {
                if (progress >= 1.0) {
                    loaded = true;
                }
            },
        );
    } catch (err) {
        console.warn('[Levain] Failed to auto-load samples:', err);
        // Fallback sine tone will continue to work
    }
}
