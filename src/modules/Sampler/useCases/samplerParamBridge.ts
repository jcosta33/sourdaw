/**
 * Bridge between Sampler UI and the Tauri backend.
 * Routes parameter changes through IPC.
 * Uses rAF throttling to avoid flooding during knob dragging.
 */

import * as bridge from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';

const pending = new Map<string, number>();
const latest = new Map<string, { param: string; value: number }>();

function flushSamplerParam(cacheKey: string, instanceId: string): void {
    pending.delete(cacheKey);
    const entry = latest.get(cacheKey);
    if (!entry) return;
    latest.delete(cacheKey);
    bridge.setSamplerParam(instanceId, entry.param, entry.value).catch((err) => {
        console.error('Failed to set sampler param:', err);
    });
}

export function setSamplerParamThrottled(instanceId: string, param: string, value: number): void {
    const cacheKey = `${instanceId}_${param}`;
    latest.set(cacheKey, { param, value });
    if (!pending.has(cacheKey)) {
        pending.set(cacheKey, requestAnimationFrame(() => flushSamplerParam(cacheKey, instanceId)));
    }
}

export function setSamplerParamImmediate(param: string, value: number): void {
    const state = samplerStore.value;
    if (!state?.instanceId) return;
    bridge.setSamplerParam(state.instanceId, param, value).catch((err) => {
        console.error('Failed to set sampler param:', err);
    });
}
