import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The device removal in words, or `null` when no track holds the device. */
export function describeExactRemovedDevice(
    action: Extract<AppAction, { type: 'removeDevice' }>,
    context: ProjectContext
): string | null {
    const owner = context.tracks.find((track) => track.devices.some((device) => device.id === action.payload.deviceId));
    const device = owner?.devices.find((candidate) => candidate.id === action.payload.deviceId);
    if (!owner || !device) {
        return null;
    }
    return `Remove device "${device.name ?? device.type}" (${device.id}, ${device.type}) from "${owner.name}" (${owner.id})`;
}
