/**
 * Auto-load levain samples when the engine is ready.
 * Loads VSCO-2-CE samples (CC0) for the given instrument from its manifest.
 * Only loads once per session per instrument.
 */

import { loadInstrumentFromManifest, WEB_LOD } from '../repositories/sampleLoader';

const loadedInstruments = new Set<string>();

/**
 * Load levain samples for a specific instrument into the worklet node.
 * Call this after the LevainNode's ready promise resolves.
 * Only loads once per instrument per session.
 */
export async function autoLoadLevainSamples(
    nodePort: MessagePort,
    instrumentId: string = 'violin-1',
): Promise<void> {
    if (loadedInstruments.has(instrumentId)) {
        return;
    }

    const manifestBase = `/samples/levain/${instrumentId}`;
    const manifestUrl = `${manifestBase}/manifest.json`;

    try {
        await loadInstrumentFromManifest(
            manifestUrl,
            manifestBase,
            nodePort,
            WEB_LOD,
            (progress) => {
                if (progress >= 1.0) {
                    loadedInstruments.add(instrumentId);
                }
            },
        );
    } catch (err) {
        console.warn(`[Levain] Failed to load samples for ${instrumentId}:`, err);
        // Fallback sine tone will continue to work
    }
}
