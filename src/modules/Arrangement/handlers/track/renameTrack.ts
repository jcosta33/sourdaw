import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { renameTrack } from '../../useCases/renameTrack';
import { getPlannedTrackState } from '../getPlannedTrackState';

export const handleRenameTrack = createHandler<'renameTrack'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedName !== undefined,
    validate: (action, context) => {
        const currentName = getPlannedTrackState(context, action.payload.trackId)?.name;
        return action.payload.expectedName === undefined || currentName === action.payload.expectedName;
    },
    execute: (action) => {
        const currentName = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.name;
        if (action.payload.expectedName !== undefined && currentName !== action.payload.expectedName) {
            return { status: 'conflict' };
        }
        renameTrack(action.payload.trackId, action.payload.name);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const currentName = getTrackStoreState()?.tracks.find((track) => track.id === action.payload.trackId)?.name;
        return (
            (action.payload.expectedName === undefined || currentName === action.payload.expectedName) &&
            currentName === action.payload.name
        );
    },
    describe: (alpha) => {
        const prev = getTrackStoreState()?.tracks.find((time) => time.id === alpha.payload.trackId);
        return {
            label: `Rename track to "${alpha.payload.name}"`,
            inverseAction: prev
                ? {
                      type: 'renameTrack',
                      payload: { trackId: prev.id, name: prev.name, expectedName: alpha.payload.name },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'renameTrack',
                      payload: { trackId: prev.id, name: alpha.payload.name, expectedName: prev.name },
                  }
                : undefined,
        };
    },
    undoable: true,
});
