import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

function candidateTrackIds(context: HandlerValidationContext): readonly string[] {
    const liveIds = (getTrackStoreState()?.tracks ?? []).map((track) => track.id);
    const batchIds = context.actions.slice(0, context.actionIndex).flatMap((action) => {
        if (action.type === 'addDevice') {
            return [action.payload.trackId];
        }
        if (action.type === 'addTrack' && action.payload.id !== undefined) {
            return [action.payload.id];
        }
        return [];
    });
    return Array.from(new Set([...liveIds, ...batchIds]));
}

/** The one track whose planned chain, including earlier batch members, holds the device. */
export function findPlannedDeviceOwner(deviceId: string, context: HandlerValidationContext): Track | undefined {
    const owners = candidateTrackIds(context)
        .map((trackId) => getPlannedTrackState(context, trackId))
        .filter((track): track is Track => track !== null && track.devices.some((device) => device.id === deviceId));
    return owners.length === 1 ? owners[0] : undefined;
}
