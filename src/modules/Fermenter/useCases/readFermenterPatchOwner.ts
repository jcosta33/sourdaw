import { getObjectId } from '@automerge/automerge';

import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { isRecord } from '#/utils/structuralEquality';

/** Identify the live raw device incarnation without treating a patch value as its owner. */
export function readFermenterPatchOwner(deviceId: string): string | null {
    const project = getCrdtDoc<Record<string, unknown>>('root');
    if (!isRecord(project) || !isRecord(project.tracks) || !Array.isArray(project.tracks.tracks)) {
        return null;
    }
    let owner: { track: Record<string, unknown>; device: Record<string, unknown> } | null = null;
    for (const track of project.tracks.tracks) {
        if (!isRecord(track) || !Array.isArray(track.devices)) {
            continue;
        }
        for (const device of track.devices) {
            if (!isRecord(device)) {
                continue;
            }
            if (device.id !== deviceId) {
                continue;
            }
            if (owner || device.type !== 'fermenter') {
                return null;
            }
            owner = { track, device };
        }
    }
    if (!owner) {
        return null;
    }
    const trackIdentity = getObjectId(owner.track);
    const deviceIdentity = getObjectId(owner.device);
    if (!trackIdentity || !deviceIdentity) {
        return null;
    }
    return JSON.stringify([captureProjectIdentity(), trackIdentity, deviceIdentity]);
}
