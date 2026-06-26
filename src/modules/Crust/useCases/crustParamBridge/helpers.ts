import { trackStore, type Track, persistDeviceParam } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';
import { createRafBatcher, type RafBatcher } from '#/utils/DOM/createRafBatcher';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };

// §33.2 — Shared rAF-batch primitive.
export type CrustBatchEntry = { ref: DeviceRef; key: string; value: number };
export const paramBatcher: RafBatcher<CrustBatchEntry> = createRafBatcher<CrustBatchEntry>();

export type BridgeDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    persistDeviceParam: typeof persistDeviceParam;
};

export function createFlushHandlers(deps: BridgeDeps) {
    function flushParam(_compositeKey: string, entry: CrustBatchEntry): void {
        deps.updateDeviceParam(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
        deps.persistDeviceParam(entry.ref.deviceId, entry.key, entry.value);
    }

    function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        deps.updateDeviceParam(ref.trackId, ref.deviceId, key, value);
        deps.persistDeviceParam(ref.deviceId, key, value);
    }

    return { flushParam, pushParamImmediately };
}

export const crustBridgeDeps: BridgeDeps = { updateDeviceParam, persistDeviceParam };

export const { flushParam: flushCrustParam, pushParamImmediately: pushCrustParamImmediately } =
    createFlushHandlers(crustBridgeDeps);

export const findDeviceRefCrust = createFindDeviceRef(getAllTracks);

export const STYLE_INDEX = {
    transparent: 0,
    punchy: 1,
    loud: 2,
} as const;

export const ALGORITHM_INDEX = {
    transparent: 0,
    punchy: 1,
    dynamic: 2,
    allround: 3,
    aggressive: 4,
    bus: 5,
    safe: 6,
    wall: 7,
} as const;

export const SAT_ALGORITHM_INDEX = {
    soft: 0,
    hard: 1,
    tape: 2,
    tube: 3,
    fold: 4,
} as const;

export const MULTIBAND_INDEX = {
    wideband: 0,
    '3band': 1,
    '5band': 2,
} as const;

export const STEREO_MODE_INDEX = {
    stereo: 0,
    ms: 1,
} as const;

export const DITHER_INDEX = {
    off: 0,
    tpdf16: 1,
    tpdf24: 2,
    powr1: 3,
    powr2: 4,
    powr3: 5,
} as const;

export const SCROLL_SPEED_INDEX = {
    slow: 0,
    normal: 1,
    fast: 2,
} as const;

/**
 * Encode a patch value into the engine's numeric parameter space.
 *
 * Three outcomes, deliberately distinct so callers can route the store write
 * separately from the engine push:
 *  - `number`    — encoded; write the store and push the engine.
 *  - `null`      — the key HAS an index table but the value is not in it
 *                  (corrupt/unknown enum string). Skip BOTH the store and the
 *                  engine so a bad value never lands in either (UI↔engine
 *                  divergence). Also covers genuinely unencodable value types.
 *  - `undefined` — the key has NO engine encoding at all (store-only string
 *                  keys such as `streamingPreset` and `name`). The store write
 *                  must still happen; only the engine push is skipped.
 */
export function encodeCrustValue(key: string, value: unknown): number | null | undefined {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    // Enum fallbacks return null (skip the write) on an unrecognised string
    // rather than coercing to a valid index: a malformed/corrupt loaded patch
    // must not silently send the engine a wrong value while the store keeps the
    // bad string (UI↔engine divergence).
    if (key === 'style') {
        return STYLE_INDEX[value as keyof typeof STYLE_INDEX] ?? null;
    }

    if (key === 'algorithm') {
        return ALGORITHM_INDEX[value as keyof typeof ALGORITHM_INDEX] ?? null;
    }

    if (key === 'satAlgorithm') {
        return SAT_ALGORITHM_INDEX[value as keyof typeof SAT_ALGORITHM_INDEX] ?? null;
    }

    if (key === 'multiBand') {
        return MULTIBAND_INDEX[value as keyof typeof MULTIBAND_INDEX] ?? null;
    }

    if (key === 'stereoMode') {
        return STEREO_MODE_INDEX[value as keyof typeof STEREO_MODE_INDEX] ?? null;
    }

    if (key === 'dither') {
        return DITHER_INDEX[value as keyof typeof DITHER_INDEX] ?? null;
    }

    if (key === 'scrollSpeed') {
        return SCROLL_SPEED_INDEX[value as keyof typeof SCROLL_SPEED_INDEX] ?? null;
    }

    // String key with no engine index table (e.g. streamingPreset, name):
    // store-only. Signal "no engine encoding" with undefined so the caller
    // preserves the store write and skips only the engine push.
    return undefined;
}
