import { persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';
export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };
export type UpdateDeviceParamFn = typeof updateDeviceParam;
export type PersistDeviceParamFn = typeof persistDeviceParam;

export const pendingUpdates = new Map<string, number>();
export const latestValues = new Map<string, number>();

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

export function createFlushParam(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
        const compositeKey = `${deviceId}:${key}`;
        pendingUpdates.delete(compositeKey);
        const value = latestValues.get(compositeKey);
        if (value === undefined) {return;}
        latestValues.delete(compositeKey);
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
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