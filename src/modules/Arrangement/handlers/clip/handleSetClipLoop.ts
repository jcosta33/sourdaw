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
        // restores the exact pre-action anchor state (#5198): `null` when the
        // clip carried none, so the undo removes the key a forward action
        // minted instead of leaving it on a never-looped clip. An anchorless
        // entry would decode as legacy and replay the mint — a disable's undo
        // on a never-anchored clip would enable-and-mint (#5198). The enable
        // restamp stays the fresh-enable law, so the next state never records
        // one.
        const anchorEntry = { loopOriginBeat: clip?.loopOriginBeat ?? null };
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
