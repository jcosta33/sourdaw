/**
 * Switch sampler operating mode (Quick/Drum/Slice/Warp).
 * Updates both the store and the backend engine.
 */

import { logger } from '#/infra/logger/appLogger';
import type { SamplerMode } from '../models/SamplerTypes';
import { setSamplerMode } from '../repositories/samplerBridge';
import { samplerStore, setMode } from '../stores/samplerStore';

export async function switchSamplerMode(mode: SamplerMode): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    setMode(mode);
    try {
        await setSamplerMode(state.instanceId, mode);
    } catch (err) {
        logger.warn('Failed to set sampler mode:', err);
    }
}
