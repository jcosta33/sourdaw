/**
 * Manage slice markers — detect onsets, add/remove/reposition markers.
 * Debounces position updates (50ms) to avoid flooding the backend.
 */

import type { OnsetAlgorithm, SliceMarker } from '../models/SamplerTypes';
import * as bridge from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';
import { setMarkers, updateMarkerPosition } from '../stores/sliceStore';

export async function detectAndSetSlices(algorithm: OnsetAlgorithm = 'superflux'): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId || !state.activeSample) return;

    try {
        const result = await bridge.detectOnsets(state.instanceId, algorithm);

        const markers: SliceMarker[] = result.positions.map((pos, i) => ({
            id: `onset-${i}`,
            framePosition: pos,
            label: `S${i + 1}`,
        }));

        setMarkers(markers, true);
    } catch (err) {
        console.error('Onset detection failed:', err);
    }
}

const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedUpdateMarkerPosition(id: string, framePosition: number): void {
    const existing = pendingUpdates.get(id);
    if (existing !== undefined) {
        clearTimeout(existing);
    }

    pendingUpdates.set(
        id,
        setTimeout(() => {
            pendingUpdates.delete(id);
            updateMarkerPosition(id, framePosition);
        }, 50)
    );
}
