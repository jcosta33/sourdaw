/**
 * Smart Loop Points use case — detect optimal loop boundaries.
 */

import { logger } from '#/infra/logger/appLogger';

import { detectSmartLoopPoints } from '../repositories/crumbsBridge/detectSmartLoopPoints';
import { crumbsStore, setLoopParams } from '../stores/crumbsStore';

import { setCrumbsParamThrottled } from './crumbsParamBridge/setCrumbsParamThrottled';

export async function detectAndApplyLoopPoints(instanceId: string): Promise<void> {
    const state = crumbsStore.value?.[instanceId];
    if (!state?.activeSample) {
        return;
    }

    try {
        const result = await detectSmartLoopPoints(instanceId, state.activeSample.sampleId);

        if (!result) {
            return;
        }

        setLoopParams(instanceId, 'forward', result.startFrame, result.endFrame);
        setCrumbsParamThrottled(instanceId, 'loopMode', 1); // Forward
        setCrumbsParamThrottled(instanceId, 'loopStart', result.startFrame);
        setCrumbsParamThrottled(instanceId, 'loopEnd', result.endFrame);
        setCrumbsParamThrottled(instanceId, 'loopCrossfade', result.crossfadeLength);
    } catch (error) {
        logger.warn('Loop point detection failed:', error);
    }
}
