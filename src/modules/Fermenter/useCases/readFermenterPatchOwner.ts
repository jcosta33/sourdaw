import { getObjectId } from '@automerge/automerge';

import { captureProjectIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

type RawDevice = { id: string; type: string };
type RawTrack = { devices?: RawDevice[] };
type RawProject = { tracks?: { tracks?: RawTrack[] } };

/** Identify the live raw device incarnation without treating a patch value as its owner. */
export function readFermenterPatchOwner(deviceId: string): string | null {
    const project = getCrdtDoc<RawProject>('root');
    const tracks = project?.tracks?.tracks;
    if (!tracks) {
        return null;
    }
    let owner: { track: RawTrack; device: RawDevice } | null = null;
    for (const track of tracks) {
        for (const device of track.devices ?? []) {
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
