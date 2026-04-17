/**
 * Voice stacking use case — unison with per-voice detuning and stereo spread.
 */

import type { VoiceStackParams } from '../models/CrumbsTypes';
import { setVoiceStack } from '../stores/crumbsStore';
import { setCrumbsParamThrottled } from './crumbsParamBridge/setCrumbsParamThrottled';

export function updateVoiceStack(instanceId: string, updates: Partial<VoiceStackParams>): void {
    setVoiceStack(instanceId, updates);

    if (updates.stackCount !== undefined) {
        setCrumbsParamThrottled(instanceId, 'stackCount', updates.stackCount);
    }
    if (updates.detuneSpread !== undefined) {
        setCrumbsParamThrottled(instanceId, 'detuneSpread', updates.detuneSpread);
    }
    if (updates.stackSpread !== undefined) {
        setCrumbsParamThrottled(instanceId, 'stackSpread', updates.stackSpread);
    }
}
