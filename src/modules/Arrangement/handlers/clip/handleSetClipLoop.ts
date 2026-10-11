import { loopOriginEntry } from '#/utils/clipLoopOrigin';
import { createHandler } from '#/utils/createHandler';

import { setClipLoop } from '../../useCases/clipLoop/setClipLoop';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipLoop = createHandler<'setClipLoop'>({
    execute: (action) => {
        return toHandlerExecutionResult(setClipLoop(action.payload.clipId, action.payload.enabled));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        // The pre-action state carries the clip's anchor so the inverse of a
        // disable restores it exactly (#5198); the enable restamp stays the
        // fresh-enable law, so the next state never records one.
        const previousState = clip
            ? {
                  present: clip.loopEnabled !== undefined,
                  enabled: clip.loopEnabled ?? false,
                  ...loopOriginEntry(clip.loopOriginBeat),
              }
            : null;
        const nextState = { present: true, enabled: action.payload.enabled };
        return {
            label: action.payload.enabled ? 'Enable clip loop' : 'Disable clip loop',
            inverseAction: previousState
                ? {
                      type: 'restoreClipLoop',
                      payload: {
                          clipId: action.payload.clipId,
                          expected: nextState,
                          replacement: previousState,
                      },
                  }
                : null,
            redoAction: previousState
                ? {
                      type: 'restoreClipLoop',
                      payload: {
                          clipId: action.payload.clipId,
                          expected: previousState,
                          replacement: nextState,
                      },
                  }
                : action,
        };
    },
    isNoop: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return clip ? (clip.loopEnabled ?? false) === action.payload.enabled : false;
    },
    undoable: true,
});
