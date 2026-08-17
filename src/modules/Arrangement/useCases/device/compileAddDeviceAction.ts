import { type AppAction } from '#/utils/handlerContract';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { getTrackStoreState } from '../getTrackStoreState';

type AddDeviceAction = Extract<AppAction, { type: 'addDevice' }>;

function nextDeviceId(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Creates the application-owned add command from the current authoritative
 * chain. Presentation supplies only a track and catalog device id; the
 * handler validates the captured chain before its CRDT write.
 */
export function compileAddDeviceAction(trackId: string, deviceType: string): AddDeviceAction | null {
    const tracks = (getTrackStoreState()?.tracks ?? []).filter((track) => track.id === trackId);
    const track = tracks.length === 1 ? tracks[0] : undefined;
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return null;
    }
    const expectedDeviceIds = track.devices.map((device) => device.id);
    if (new Set(expectedDeviceIds).size !== expectedDeviceIds.length) {
        return null;
    }
    return {
        type: 'addDevice',
        payload: {
            trackId,
            deviceType,
            deviceId: nextDeviceId(),
            expectedDeviceIds,
            expectedFrozen: track.frozen,
        },
    };
}
