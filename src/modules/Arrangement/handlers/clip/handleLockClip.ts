import { createHandler } from '#/utils/createHandler';

import { lockClip } from '../../useCases/clipEditing/lockClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleLockClip = createHandler<'lockClip'>({
    execute: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (action.payload.expectedLocked !== undefined && clip?.locked !== action.payload.expectedLocked) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(lockClip(action.payload.clipId, action.payload.locked));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return {
            label: action.payload.locked ? 'Lock clip' : 'Unlock clip',
            inverseAction: clip
                ? {
                      type: 'lockClip',
                      payload: {
                          clipId: clip.id,
                          locked: clip.locked,
                          expectedLocked: action.payload.locked,
                      },
                  }
                : null,
            redoAction: clip
                ? {
                      type: 'lockClip',
                      payload: {
                          clipId: clip.id,
                          locked: action.payload.locked,
                          expectedLocked: clip.locked,
                      },
                  }
                : action,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((clip) => clip.id === action.payload.clipId)?.locked === action.payload.locked,
    undoable: true,
});
