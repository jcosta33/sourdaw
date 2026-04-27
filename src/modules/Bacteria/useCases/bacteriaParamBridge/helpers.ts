import { type persistDeviceParam } from '#/modules/Arrangement/stores';
import { type updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';
import { createRafBatcher, type RafBatcher } from '#/utils/DOM/createRafBatcher';

export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

// §33.2 — Shared rAF-batch primitive; replaces the per-bridge
// pendingUpdates / latestValues Map pair.
export type BacteriaBatchEntry = { ref: DeviceRef; key: string; value: number };
export const paramBatcher: RafBatcher<BacteriaBatchEntry> = createRafBatcher<BacteriaBatchEntry>();

export const DISTORTION_MODE_INDEX = {
    'soft-clip': 0,
    'hard-clip': 1,
    foldback: 2,
    wavefold: 3,
    bitcrush: 4,
    tube: 5,
    breakdown: 6,
    smudge: 7,
    custom: 8,
} as const;

export const FILTER_MODE_INDEX = {
    lowpass: 0,
    highpass: 1,
    bandpass: 2,
    notch: 3,
    formant: 4,
    comb: 5,
} as const;

export const GRAIN_WINDOW_INDEX = {
    hann: 0,
    gaussian: 1,
} as const;

export const CROSSOVER_MODE_INDEX = {
    lr4: 0,
    'linear-phase': 1,
} as const;

export const ROUTING_MODE_INDEX = {
    serial: 0,
    parallel: 1,
    'mid-side': 2,
} as const;

export function createFlushParam(updateDeviceParamFn: UpdateDeviceParamFn, persistDeviceParamFn: PersistDeviceParamFn) {
    return function flushParam(_compositeKey: string, entry: BacteriaBatchEntry): void {
        updateDeviceParamFn(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        persistDeviceParamFn(entry.ref.deviceId, entry.key, entry.value);
    };
}

export function encodePatchValue(key: string, value: unknown): number | null {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    if (key === 'distortionMode') {
        return DISTORTION_MODE_INDEX[value as keyof typeof DISTORTION_MODE_INDEX] ?? 0;
    }

    if (key === 'filterMode') {
        return FILTER_MODE_INDEX[value as keyof typeof FILTER_MODE_INDEX] ?? 0;
    }

    if (key === 'grainWindow') {
        return GRAIN_WINDOW_INDEX[value as keyof typeof GRAIN_WINDOW_INDEX] ?? 0;
    }

    if (key === 'crossoverMode') {
        return CROSSOVER_MODE_INDEX[value as keyof typeof CROSSOVER_MODE_INDEX] ?? 0;
    }

    if (key === 'globalRouting' || key === 'routingMode') {
        return ROUTING_MODE_INDEX[value as keyof typeof ROUTING_MODE_INDEX] ?? 0;
    }

    return null;
}
