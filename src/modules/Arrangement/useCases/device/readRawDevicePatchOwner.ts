import { getObjectId } from '@automerge/automerge';

import { readDevicePatchSnapshot } from './readDevicePatchSnapshot';

type DeviceTarget = Pick<Parameters<typeof readDevicePatchSnapshot>[1], 'trackId' | 'deviceId'>;

/** Distinguish an empty device slot on the actual track from a missing or ambiguous owner. */
export function readRawDevicePatchOwner(document: Readonly<Record<string, unknown>>, target: DeviceTarget) {
    const snapshot = readDevicePatchSnapshot(document, { ...target, parameterIds: [] });
    const trackObjectId = snapshot?.track ? getObjectId(snapshot.track) : null;
    const owner = snapshot?.owners[0];
    const deviceObjectId = owner ? getObjectId(owner.device) : null;
    if (
        !snapshot?.value.track.present ||
        typeof trackObjectId !== 'string' ||
        (owner && (owner.trackId !== target.trackId || !deviceObjectId))
    ) {
        return null;
    }
    return { trackObjectId, deviceObjectId, deviceType: owner?.device.type, deviceIds: snapshot.value.track.deviceIds };
}
