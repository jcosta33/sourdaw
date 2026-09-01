import {
    trackStore,
    type Track,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';
import { createRafBatcher, type RafBatcher } from '#/utils/DOM/createRafBatcher';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };

// §33.2 — Shared rAF-batch primitive.
export type CrustBatchEntry = { deviceId: string; key: string; value: number };
export const paramBatcher: RafBatcher<CrustBatchEntry> = createRafBatcher<CrustBatchEntry>();

export type BridgeDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    persistDeviceParam: typeof persistDeviceParam;
    resolveEligibleDeviceWriteTarget: typeof resolveEligibleDeviceWriteTarget;
};

export const crustBridgeDeps: BridgeDeps = {
    updateDeviceParam,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
};

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

/** PLAY `style` → SHAPE `algorithm`, matching `Algorithm::from_style_index`. */
export const STYLE_TO_ALGORITHM = {
    transparent: 'transparent',
    punchy: 'punchy',
    loud: 'wall',
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

const STYLE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(STYLE_INDEX));
const ALGORITHM_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(ALGORITHM_INDEX));
const SAT_ALGORITHM_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(SAT_ALGORITHM_INDEX));
const MULTIBAND_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(MULTIBAND_INDEX));
const STEREO_MODE_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(STEREO_MODE_INDEX));
const DITHER_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(DITHER_INDEX));
const SCROLL_SPEED_LOOKUP: ReadonlyMap<string, number> = new Map(Object.entries(SCROLL_SPEED_INDEX));

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
        return STYLE_LOOKUP.get(value) ?? null;
    }

    if (key === 'algorithm') {
        return ALGORITHM_LOOKUP.get(value) ?? null;
    }

    if (key === 'satAlgorithm') {
        return SAT_ALGORITHM_LOOKUP.get(value) ?? null;
    }

    if (key === 'multiBand') {
        return MULTIBAND_LOOKUP.get(value) ?? null;
    }

    if (key === 'stereoMode') {
        return STEREO_MODE_LOOKUP.get(value) ?? null;
    }

    if (key === 'dither') {
        return DITHER_LOOKUP.get(value) ?? null;
    }

    if (key === 'scrollSpeed') {
        return SCROLL_SPEED_LOOKUP.get(value) ?? null;
    }

    // String key with no engine index table (e.g. streamingPreset, name):
    // store-only. Signal "no engine encoding" with undefined so the caller
    // preserves the store write and skips only the engine push.
    return undefined;
}
