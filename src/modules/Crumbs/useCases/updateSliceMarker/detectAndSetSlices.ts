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

        const markers: SliceMarker[] = result.positions.map((pos, i) => ({
            id: `onset-${i}`,
            framePosition: pos,
            label: `S${i + 1}`,
        }));

        setMarkers(instanceId, markers, true);
    } catch (error) {
        logger.warn('Onset detection failed:', error);
    }
}
