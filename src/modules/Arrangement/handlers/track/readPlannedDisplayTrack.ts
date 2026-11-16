import { type HandlerValidationContext } from '#/utils/handlerContract';

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

/** Every live track as the earlier actions of its batch leave it, in store order. */
export function readPlannedDisplayTracks(context?: HandlerValidationContext): Track[] {
    const live = getTrackStoreState()?.tracks ?? [];
    if (!context) {
        return live;
    }
    return live.flatMap((track) => getPlannedTrackState(context, track.id) ?? []);
}

export function describeMissingTrack(trackId: string): string {
    return `Track "${trackId}" does not exist`;
}
