import { logger } from '#/infra/logger/appLogger';
import type { OnsetAlgorithm, SliceMarker } from '../../models/SamplerTypes';
import { detectOnsets } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';
import { setMarkers } from '../../stores/sliceStore';

export async function detectAndSetSlices(algorithm: OnsetAlgorithm = 'superflux'): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId || !state.activeSample) return;

    try {
        const result = await detectOnsets(state.instanceId, algorithm);

        const markers: SliceMarker[] = result.positions.map((pos, i) => ({
            id: `onset-${i}`,
            framePosition: pos,
            label: `S${i + 1}`,
        }));

        setMarkers(markers, true);
    } catch (err) {
        logger.warn('Onset detection failed:', err);
    }
}