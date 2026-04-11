import * as bridge from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';

export function setSamplerParamImmediate(param: string, value: number): void {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    bridge.setSamplerParam(state.instanceId, param, value).catch((err) => {
        console.error('Failed to set sampler param:', err);
    });
}