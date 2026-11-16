import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The device insertion in words, or `null` when its track, type or identity is not known. */
export function describeAddedDevice(
    action: Extract<AppAction, { type: 'addDevice' }>,
    context: ProjectContext
): string | null {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    const deviceType = context.availableDeviceTypes?.find((candidate) => candidate.id === action.payload.deviceType);
    const anchor = track?.devices.find((candidate) => candidate.id === action.payload.afterDeviceId);
    if (track && deviceType && action.payload.deviceId) {
        const anchorDescription = anchor
            ? ` after "${anchor.name ?? anchor.type}" (${anchor.id})`
            : ' at the end of the chain';
        return `Insert "${deviceType.name}" (${action.payload.deviceId}) on track "${track.name}" (${track.id})${anchorDescription}`;
    }
    return null;
}
