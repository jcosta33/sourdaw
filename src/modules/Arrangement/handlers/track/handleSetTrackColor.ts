import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../../models/Track';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackColor } from '../../useCases/setTrackGainPan/setTrackColor';
import { getPlannedTrackState } from '../getPlannedTrackState';

// The batch describes every action before executing any, so the previous colour
// is what the earlier actions of the batch leave, and a track an earlier action
// creates exists only in that plan.
function trackBeforeAction(trackId: string, context: HandlerValidationContext | undefined): Track | null | undefined {
    if (context) {
        return getPlannedTrackState(context, trackId);
    }
    return getTrackStoreState()?.tracks.find((track) => track.id === trackId);
}

export const handleSetTrackColor = createHandler<'setTrackColor'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedColor !== undefined,
    validate: (action, context) => {
        const currentColor = getPlannedTrackState(context, action.payload.trackId)?.color;
        return action.payload.expectedColor === undefined || currentColor === action.payload.expectedColor;
    },
    execute: (action) => {
        const currentColor = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.color;
        if (action.payload.expectedColor !== undefined && currentColor !== action.payload.expectedColor) {
            return { status: 'conflict' };
        }
        setTrackColor(action.payload.trackId, action.payload.color);
        return { status: 'written' };
    },
    describe: (alpha, context) => {
        const prev = trackBeforeAction(alpha.payload.trackId, context);
        return {
            label: 'Set track color',
            inverseAction: prev
                ? {
                      type: 'setTrackColor',
                      payload: {
                          trackId: alpha.payload.trackId,
                          color: prev.color,
                          expectedColor: alpha.payload.color,
                      },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'setTrackColor',
                      payload: {
                          trackId: alpha.payload.trackId,
                          color: alpha.payload.color,
                          expectedColor: prev.color,
                      },
                  }
                : undefined,
        };
    },
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (!track) {
            return action.payload.expectedColor === undefined;
        }
        return (
            (action.payload.expectedColor === undefined || track.color === action.payload.expectedColor) &&
            track.color === action.payload.color
        );
    },
    undoable: true,
});
