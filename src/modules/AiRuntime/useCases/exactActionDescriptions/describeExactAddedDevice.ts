import { getPluginById } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

import { resolveActionDeviceName } from './resolveActionDeviceName';
import { resolveActionTrackName } from './resolveActionTrackName';

/** The device insertion in words, or `null` until its device is identified. */
export function describeExactAddedDevice(
    action: Extract<AppAction, { type: 'addDevice' }>,
    context: ProjectContext,
    actions: readonly AppAction[]
): string | null {
    if (!action.payload.deviceId) {
        return null;
    }
    const trackName = resolveActionTrackName(action.payload.trackId, actions, context);
    const deviceName = getPluginById(action.payload.deviceType)?.name ?? action.payload.deviceType;
    let anchor = 'at the end of the chain';
    if (action.payload.afterDeviceId) {
        const anchorName = resolveActionDeviceName(action.payload.afterDeviceId, actions, context);
        anchor = `after "${anchorName}" (${action.payload.afterDeviceId})`;
    }
    return `Insert "${deviceName}" (${action.payload.deviceId}, ${action.payload.deviceType}) on "${trackName}" (${action.payload.trackId}) ${anchor}`;
}
