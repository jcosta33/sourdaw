import { createHandler } from '#/utils/createHandler';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setAutomationMode } from '../../useCases/toggleTrackState/setAutomationMode';

export const handleSetAutomationMode = createHandler<'setAutomationMode'>({
    execute: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (action.payload.expectedMode !== undefined && track?.automationMode !== action.payload.expectedMode) {
            return { status: 'conflict' };
        }
        if (!track) {
            return { status: 'no-write' };
        }
        setAutomationMode(action.payload.trackId, action.payload.mode);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        if (action.payload.expectedMode !== undefined && track?.automationMode !== action.payload.expectedMode) {
            return false;
        }
        return !track || track.automationMode === action.payload.mode;
    },
    describe: (action) => {
        const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        return {
            label: `Set automation mode: ${action.payload.mode}`,
            inverseAction: track
                ? {
                      type: 'setAutomationMode',
                      payload: {
                          trackId: action.payload.trackId,
                          mode: track.automationMode,
                          expectedMode: action.payload.mode,
                      },
                  }
                : null,
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
