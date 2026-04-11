/**
 * Voice stacking use case — unison with per-voice detuning and stereo spread.
 */

import type { VoiceStackParams } from '../models/SamplerTypes';
import { samplerStore, setVoiceStack } from '../stores/samplerStore';
import { setSamplerParamThrottled } from './samplerParamBridge/setSamplerParamThrottled';

export function updateVoiceStack(updates: Partial<VoiceStackParams>): void {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    setVoiceStack(updates);

    if (updates.stackCount !== undefined) {
        setSamplerParamThrottled(state.instanceId, 'stackCount', updates.stackCount);
    }
    if (updates.detuneSpread !== undefined) {
        setSamplerParamThrottled(state.instanceId, 'detuneSpread', updates.detuneSpread);
    }
    if (updates.stackSpread !== undefined) {
        setSamplerParamThrottled(state.instanceId, 'stackSpread', updates.stackSpread);
    }
}
