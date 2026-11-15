import { getPluginById } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The name of a device in the snapshot or of one the same batch adds, else its id. */
export function resolveActionDeviceName(
    deviceId: string,
    actions: readonly AppAction[],
    context: ProjectContext
): string {
    const existing = context.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId);
    if (existing) {
        return existing.name ?? existing.type;
    }
    const created = actions.find((action) => action.type === 'addDevice' && action.payload.deviceId === deviceId);
    if (created?.type === 'addDevice') {
        return getPluginById(created.payload.deviceType)?.name ?? created.payload.deviceType;
    }
    return deviceId;
}
