import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';

/**
 * The clip as the batch's earlier actions leave it when a context is given, otherwise as the store
 * holds it now. A second edit of one clip in a batch plans against the first edit's result.
 */
export function readPlannedClip(clipId: string, context?: HandlerValidationContext): Clip | undefined {
    const live = getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    if (!live || !context) {
        return live;
    }
    return getPlannedTrackState(context, live.trackId)?.clips.find((candidate) => candidate.id === clipId) ?? live;
}
