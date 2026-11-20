import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../../stores/trackStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

/**
 * The track as the earlier actions of its batch leave it, or as the store holds it outside a
 * batch. A batch describes every action before executing any, so an action reading the live store
 * would capture a pre-batch value an earlier action of the same batch has already moved.
 */
export function readPlannedDisplayTrack(trackId: string, context?: HandlerValidationContext): Track | null {
    if (context) {
        return getPlannedTrackState(context, trackId);
    }
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId) ?? null;
}

function readTrackIdAfter(trackIds: readonly string[], action: AppAction): readonly string[] {
    if (action.type === 'removeTrack') {
        return trackIds.filter((id) => id !== action.payload.trackId);
    }
    const createdId = readCreatedTrackId(action);
    return createdId === null || trackIds.includes(createdId) ? trackIds : [...trackIds, createdId];
}

function readCreatedTrackId(action: AppAction): string | null {
    if (action.type === 'addTrack') {
        return action.payload.id ?? null;
    }
    if (action.type === 'createBus') {
        return action.payload.busId ?? null;
    }
    return action.type === 'restoreTrack' ? action.payload.trackId : null;
}

/**
 * Every track as the earlier actions of the batch leave it: the live tracks, those an earlier action
 * creates or restores after them, and none an earlier action removes.
 */
export function readPlannedDisplayTracks(context?: HandlerValidationContext): Track[] {
    const live = getTrackStoreState()?.tracks ?? [];
    if (!context) {
        return live;
    }
    const trackIds = context.actions.slice(0, context.actionIndex).reduce(
        readTrackIdAfter,
        live.map((track) => track.id)
    );
    return trackIds.flatMap((id) => getPlannedTrackState(context, id) ?? []);
}

export function describeMissingTrack(trackId: string): string {
    return `Track "${trackId}" does not exist`;
}
