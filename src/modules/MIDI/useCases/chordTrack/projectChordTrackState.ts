import { type AppAction } from '#/utils/handlerContract';

import { type ChordTrackState } from '../../stores/chordTrackStore';
import { cloneChordTrackState } from '../../transformers/cloneChordTrackState';
import { isChordTrackEditAction } from '../../transformers/isChordTrackEditAction';
import { projectChordTrackAction } from '../../transformers/projectChordTrackAction';

/** The chord track as the earlier actions of one batch leave it, so a later action describes against what it will meet. */
export function projectChordTrackThroughActions(
    state: ChordTrackState,
    priorActions: readonly AppAction[]
): ChordTrackState {
    let projected = state;
    for (const action of priorActions) {
        if (action.type === 'restoreChordTrackState') {
            projected = cloneChordTrackState(action.payload.replacement);
        } else if (isChordTrackEditAction(action)) {
            projected = projectChordTrackAction(projected, action);
        }
    }
    return projected;
}
