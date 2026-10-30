import { getObjectId } from '@automerge/automerge';

import { captureProjectRootIdentity, DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOwnerFingerprint(deviceId: string): string | null {
    const document = getCrdtDoc(DOC_PREFIX_ROOT);
    const slot = document?.tracks;
    if (!isRecord(slot) || !Array.isArray(slot.tracks)) {
        return null;
    }
    const tracks = slot.tracks.filter(isRecord);
    const matches: { track: Record<string, unknown>; device: Record<string, unknown> }[] = [];
    for (const track of tracks) {
        if (!Array.isArray(track.devices)) {
            continue;
        }
        for (const device of track.devices) {
            if (isRecord(device) && device.id === deviceId) {
                matches.push({ track, device });
            }
        }
    }
    const owner = matches[0];
    if (
        matches.length !== 1 ||
        !owner ||
        owner.device.type !== DEVICE_TYPE_IDS.builtinCrumbs ||
        typeof owner.track.id !== 'string' ||
        tracks.filter((track) => track.id === owner.track.id).length !== 1
    ) {
        return null;
    }
    const trackObjectId = getObjectId(owner.track);
    const deviceObjectId = getObjectId(owner.device);
    if (trackObjectId === null || deviceObjectId === null) {
        return null;
    }
    return JSON.stringify({
        root: captureProjectRootIdentity(),
        trackId: owner.track.id,
        trackObjectId,
        deviceObjectId,
    });
}

/** Observe actual owner transitions, including absence, without revoking ordinary root edits. */
export function createCrumbsSampleProjectAccess(): {
    capture: (deviceId: string) => number | null;
    refresh: () => void;
} {
    const observed = new Map<string, { fingerprint: string | null; generation: number }>();
    let generation = 0;

    const capture = (deviceId: string): number | null => {
        const fingerprint = readOwnerFingerprint(deviceId);
        let owner = observed.get(deviceId);
        if (!owner || owner.fingerprint !== fingerprint) {
            owner = { fingerprint, generation: ++generation };
            observed.set(deviceId, owner);
        }
        if (fingerprint === null) {
            return null;
        }
        return owner.generation;
    };

    return {
        capture,
        refresh: () => {
            for (const deviceId of observed.keys()) {
                capture(deviceId);
            }
        },
    };
}
