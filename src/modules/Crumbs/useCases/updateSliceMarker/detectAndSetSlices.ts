import { logger } from '#/infra/logger/appLogger';

import { detectOnsets } from '../../repositories/crumbsBridge';
import { crumbsStore } from '../../stores/crumbsStore';
import { setMarkers } from '../../stores/sliceStore';

import type { OnsetAlgorithm, SliceMarker } from '../../models/CrumbsTypes';

export async function detectAndSetSlices(instanceId: string, algorithm: OnsetAlgorithm = 'superflux'): Promise<void> {
    const state = crumbsStore.value?.[instanceId];
    if (!state?.activeSample) {
        return;
    }

    try {
        const result = await detectOnsets(instanceId, state.activeSample.sampleId, algorithm);

        // Use a globally-unique id (matching the manual `slice-${uuid}` scheme in
        // sliceStore) rather than the index-positional `onset-${i}`: two detect runs
        // returning the same count previously produced identical ids (`onset-0`, …),
        // colliding as React keys across the two marker namespaces.
        const markers: SliceMarker[] = result.positions.map((pos, i) => ({
            id: `slice-${crypto.randomUUID()}`,
            framePosition: pos,
            label: `S${i + 1}`,
        }));

        setMarkers(instanceId, markers, true);
    } catch (error) {
        logger.warn('Onset detection failed:', error);
    }
}
