/**
 * Bridge between Sampler UI and the Tauri backend.
 * Routes parameter changes through IPC.
 * Uses rAF throttling to avoid flooding during knob dragging.
 */

import { inject } from '#/infra/di/inject';
import * as bridge from '../repositories/samplerBridge';
import { samplerStore } from '../stores/samplerStore';

const pending = new Map<string, number>();
const latest = new Map<string, { param: string; value: number }>();

export const samplerParamBridgeDependencies = {
    setSamplerParam: bridge.setSamplerParam,
    samplerStore,
} as const;

export const setSamplerParamThrottled = inject(samplerParamBridgeDependencies)(({ setSamplerParam: setParam }) => {
    function flush(cacheKey: string, instanceId: string): void {
        pending.delete(cacheKey);
        const entry = latest.get(cacheKey);
        if (!entry) return;
        latest.delete(cacheKey);
        setParam(instanceId, entry.param, entry.value).catch((err) => {
            console.error('Failed to set sampler param:', err);
        });
    }

    return function setSamplerParamThrottled(instanceId: string, param: string, value: number): void {
        const cacheKey = `${instanceId}_${param}`;
        latest.set(cacheKey, { param, value });
        if (!pending.has(cacheKey)) {
            pending.set(
                cacheKey,
                requestAnimationFrame(() => flush(cacheKey, instanceId))
            );
        }
    };
});

export const setSamplerParamImmediate = inject(samplerParamBridgeDependencies)(({ setSamplerParam: setParam, samplerStore: store }) => {
    return function setSamplerParamImmediate(param: string, value: number): void {
        const state = store.value;
        if (!state?.instanceId) return;
        setParam(state.instanceId, param, value).catch((err) => {
            console.error('Failed to set sampler param:', err);
        });
    };
});
