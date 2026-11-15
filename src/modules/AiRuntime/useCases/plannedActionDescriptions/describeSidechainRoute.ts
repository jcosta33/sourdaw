import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/** The sidechain route change in words, or `null` when either track is not in the snapshot. */
export function describeSidechainRoute(
    action: Extract<AppAction, { type: 'addSidechainRoute' | 'removeSidechainRoute' }>,
    context: ProjectContext,
    operation: 'Add' | 'Remove'
): string | null {
    const source = context.tracks.find((track) => track.id === action.payload.sourceTrackId);
    const target = context.tracks.find((track) => track.id === action.payload.targetTrackId);
    if (!source || !target) {
        return null;
    }
    const targetDevice = target.devices.find((device) => device.id === action.payload.targetDeviceId);
    if (targetDevice) {
        return `${operation} sidechain route: "${source.name}" (${source.id}) → "${target.name}" (${target.id}) device "${targetDevice.name ?? targetDevice.type}" (${targetDevice.id}, ${targetDevice.type})`;
    }
    return `${operation} sidechain route: "${source.name}" (${source.id}) → "${target.name}" (${target.id})`;
}
