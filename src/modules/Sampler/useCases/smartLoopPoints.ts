/**
 * Smart Loop Points use case — detect optimal loop boundaries.
 */

import { logger } from '#/infra/logger/appLogger';
import { detectSmartLoopPoints } from '../repositories/samplerBridge';
import { samplerStore, setLoopParams } from '../stores/samplerStore';
import { setSamplerParamThrottled } from './samplerParamBridge/setSamplerParamThrottled';

export async function detectAndApplyLoopPoints(): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    try {
        const result = await detectSmartLoopPoints(state.instanceId);
        if (!result) return;

        setLoopParams('forward', result.startFrame, result.endFrame);
        setSamplerParamThrottled(state.instanceId, 'loopMode', 1); // Forward
        setSamplerParamThrottled(state.instanceId, 'loopStart', result.startFrame);
        setSamplerParamThrottled(state.instanceId, 'loopEnd', result.endFrame);
        setSamplerParamThrottled(state.instanceId, 'loopCrossfade', result.crossfadeLength);
    } catch (err) {
        logger.warn('Loop point detection failed:', err);
    }
}
