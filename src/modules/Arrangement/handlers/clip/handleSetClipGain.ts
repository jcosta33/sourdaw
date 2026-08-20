import { createHandler } from '#/utils/createHandler';

import { clampClipGain } from '../../transformers/clampClipGain';
import { setClipGain } from '../../useCases/clipEditing/setClipGain';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipGain = createHandler<'setClipGain'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedGain !== undefined,
    validate: (action) => {
        if (action.payload.expectedGain === undefined) {
            return true;
        }
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return clip !== undefined && Object.is(clip.gain, action.payload.expectedGain);
    },
    execute: (alpha) => {
        if (alpha.payload.expectedGain !== undefined) {
            const clip = getTrackStoreState()
                ?.tracks.flatMap((track) => track.clips)
                .find((candidate) => candidate.id === alpha.payload.clipId);
            if (!clip || !Object.is(clip.gain, alpha.payload.expectedGain)) {
                return { status: 'conflict' };
            }
        }
        return toHandlerExecutionResult(setClipGain(alpha.payload.clipId, alpha.payload.gain));
    },
    describe: (alpha) => {
        const state = getTrackStoreState();
        const clip = state?.tracks.flatMap((time) => time.clips).find((context) => context.id === alpha.payload.clipId);
        return {
            label: 'Set clip gain',
            // The inverse expects the gain this action is about to write, clamped the same way the
            // write clamps it. That makes the undo compensable: it refuses instead of clobbering a
            // gain something else moved after the forward action landed.
            inverseAction: clip
                ? {
                      type: 'setClipGain',
                      payload: {
                          clipId: clip.id,
                          gain: clip.gain,
                          expectedGain: clampClipGain(alpha.payload.gain),
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
