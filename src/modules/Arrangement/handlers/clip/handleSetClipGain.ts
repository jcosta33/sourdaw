import { CLIP_GAIN_LAW, type LevelResolution, resolveLevelFields } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { clampClipGain } from '../../transformers/clampClipGain';
import { setClipGain } from '../../useCases/clipEditing/setClipGain';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type SetClipGainAction = Extract<AppAction, { type: 'setClipGain' }>;

function findClip(clipId: string) {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
}

/** The linear amplitude this action asks for, whichever way it asked; the
 *  decibel forms resolve against the clip's live gain. */
function requestedGain(action: SetClipGainAction, currentGain: number): LevelResolution {
    return resolveLevelFields(
        { linear: action.payload.gain, absoluteDb: action.payload.gainDb, deltaDb: action.payload.deltaDb },
        currentGain,
        CLIP_GAIN_LAW
    );
}

export const handleSetClipGain = createHandler<'setClipGain'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedGain !== undefined,
    validate: (action, context) => {
        const clip = findClip(action.payload.clipId);
        // A stale-snapshot check against the store: this must read the live clip,
        // never the planned one, or a batch could pass a divergence a prior action
        // in the same batch happens to paper over.
        if (action.payload.expectedGain !== undefined) {
            if (clip === undefined || !Object.is(clip.gain, action.payload.expectedGain)) {
                return false;
            }
        }
        // The linear form has always been admitted without reading the clip, so
        // it still is; only a decibel request needs a level to resolve against.
        if (action.payload.gain !== undefined) {
            return true;
        }
        if (clip === undefined) {
            return false;
        }
        // A decibel request resolves against what an earlier action in this same
        // batch will leave the clip at, not against the live store: two
        // `setClipGain` actions on one clip in a batch must compound.
        const plannedClip = getPlannedTrackState(context, clip.trackId)?.clips.find(
            (candidate) => candidate.id === clip.id
        );
        return plannedClip !== undefined && requestedGain(action, plannedClip.gain).ok;
    },
    execute: (alpha) => {
        const clip = findClip(alpha.payload.clipId);
        if (alpha.payload.expectedGain !== undefined && (!clip || !Object.is(clip.gain, alpha.payload.expectedGain))) {
            return { status: 'conflict' };
        }
        // A linear request against a missing clip has always resolved to
        // `no-write` through the writer's own miss; a decibel request has no
        // level to resolve against, so it refuses in the same shape rather than
        // reporting the absent clip as a silent one.
        if (!clip && alpha.payload.gain === undefined) {
            return { status: 'no-write' };
        }
        const requested = requestedGain(alpha, clip?.gain ?? 0);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        return toHandlerExecutionResult(setClipGain(alpha.payload.clipId, requested.linear));
    },
    describe: (alpha) => {
        const clip = findClip(alpha.payload.clipId);
        const requested = clip === undefined ? null : requestedGain(alpha, clip.gain);
        return {
            label: 'Set clip gain',
            // The inverse expects the gain this action is about to write, clamped the same way the
            // write clamps it. That makes the undo compensable: it refuses instead of clobbering a
            // gain something else moved after the forward action landed. It restores the stored
            // amplitude linearly whatever form the forward action used.
            inverseAction:
                clip && requested?.ok
                    ? {
                          type: 'setClipGain',
                          payload: {
                              clipId: clip.id,
                              gain: clip.gain,
                              expectedGain: clampClipGain(requested.linear),
                          },
                      }
                    : null,
        };
    },
    undoable: true,
});
