import { logger } from '#/infra/logger/appLogger';
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

const DISTORTION_MODE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(DISTORTION_MODE_INDEX));
const FILTER_MODE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(FILTER_MODE_INDEX));
const GRAIN_WINDOW_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(GRAIN_WINDOW_INDEX));
const CROSSOVER_MODE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(CROSSOVER_MODE_INDEX));
const ROUTING_MODE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(ROUTING_MODE_INDEX));

// String-valued patch fields that are intentionally not audio params, so
// encodePatchValue returning null for them is expected (not a misconfiguration).
// `name` is the patch label; `convolutionIr` is an IR identifier resolved
// out-of-band rather than encoded into a numeric engine param.
const NON_AUDIO_STRING_KEYS = new Set<string>(['name', 'convolutionIr']);

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
        return DISTORTION_MODE_LOOKUP.get(value) ?? 0;
    }

    if (key === 'filterMode') {
        return FILTER_MODE_LOOKUP.get(value) ?? 0;
    }

    if (key === 'grainWindow') {
        return GRAIN_WINDOW_LOOKUP.get(value) ?? 0;
    }

    if (key === 'crossoverMode') {
        return CROSSOVER_MODE_LOOKUP.get(value) ?? 0;
    }

    if (key === 'globalRouting' || key === 'routingMode') {
        return ROUTING_MODE_LOOKUP.get(value) ?? 0;
    }

    // An unrecognized string-valued key silently never reaches the engine.
    // Warn (DEV-only via the console writer) unless the key is a known
    // non-audio field, so a newly added string param surfaces during dev
    // instead of being dropped without a trace.
    if (!NON_AUDIO_STRING_KEYS.has(key)) {
        logger.warn(
            `[bacteriaParamBridge] encodePatchValue: no encoding for string key "${key}" (value "${value}"); ` +
                'engine write dropped. Add a known mode-index map or register it in NON_AUDIO_STRING_KEYS.'
        );
    }

    return null;
}
