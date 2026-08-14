import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackColor } from '../../useCases/setTrackGainPan/setTrackColor';
import { getPlannedTrackState } from '../getPlannedTrackState';

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
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
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
