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
        // The pre-action state carries the clip's anchor so every inverse
        // restores the exact pre-action anchor state (#5198): a disable's
        // inverse records the anchor it captured; an enable's records the
        // pre-enable state explicitly — `null` when the clip carried none, so
        // the undo removes the key the enable minted instead of leaving it on
        // a never-looped clip. The enable restamp stays the fresh-enable law,
        // so the next state never records one.
        const anchorEntry = action.payload.enabled
            ? { loopOriginBeat: clip?.loopOriginBeat ?? null }
            : loopOriginEntry(clip?.loopOriginBeat);
        const previousState = clip
            ? {
                  present: clip.loopEnabled !== undefined,
                  enabled: clip.loopEnabled ?? false,
                  ...anchorEntry,
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
