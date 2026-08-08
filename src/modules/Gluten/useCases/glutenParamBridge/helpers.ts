import {
    trackStore,
    type Track,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { createFindDeviceRef, type DeviceRef, type GetAllTracksFn } from '#/utils/createFindDeviceRef';
import { createRafBatcher, type RafBatcher } from '#/utils/DOM/createRafBatcher';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export { createFindDeviceRef };
export type { DeviceRef, GetAllTracksFn };

// §33.2 — Shared rAF-batch primitive instead of a per-bridge mutable
// `pendingUpdates` / `latestValues` Map pair. The batcher keeps the
// last-write-wins semantics but the mechanics live in one place.
export type GlutenBatchEntry = { deviceId: string; key: string; value: number };
export const paramBatcher: RafBatcher<GlutenBatchEntry> = createRafBatcher<GlutenBatchEntry>();

export type BridgeDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    persistDeviceParam: typeof persistDeviceParam;
    resolveEligibleDeviceWriteTarget: typeof resolveEligibleDeviceWriteTarget;
    executeAppAction: typeof executeAppAction;
};

export const bridgeDeps: BridgeDeps = {
    updateDeviceParam,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
    executeAppAction,
};
export const findDeviceRefGluten = createFindDeviceRef(getAllTracks);

export const TOPOLOGY_INDEX = {
    vca: 0,
    opto: 1,
    fet: 2,
    diode: 3,
} as const;

export const STYLE_INDEX = {
    glue: 0,
    punch: 1,
    smooth: 2,
    pump: 3,
} as const;

export const DETECTION_INDEX = {
    rms: 0,
    peak: 1,
} as const;

export const STEREO_MODE_INDEX = {
    stereo: 0,
    mid: 1,
    side: 2,
    'dual-mono': 3,
} as const;

/**
 * Look an enum string up in an index map. Returns the index for a recognized
 * member — including a legitimately-zero one such as `vca`/`glue`/`rms`/`stereo`
 * — and `null` for any string that is not a member, rather than collapsing an
 * unknown value to index 0 (which would silently desync the store from the
 * engine). Typed against the runtime truth that arbitrary-string lookups may
 * miss, so the miss branch is real rather than fallback-as-decoration.
 */
function lookupIndex(map: Readonly<Record<string, number>>, value: string): number | null {
    return Object.hasOwn(map, value) ? map[value]! : null;
}

export function encodeGlutenValue(key: string, value: unknown): number | null {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    if (key === 'topology' || key === 'blendTopology') {
        return lookupIndex(TOPOLOGY_INDEX, value);
    }

    if (key === 'style') {
        return lookupIndex(STYLE_INDEX, value);
    }

    if (key === 'detection') {
        return lookupIndex(DETECTION_INDEX, value);
    }

    if (key === 'stereoMode') {
        return lookupIndex(STEREO_MODE_INDEX, value);
    }

    return null;
}
