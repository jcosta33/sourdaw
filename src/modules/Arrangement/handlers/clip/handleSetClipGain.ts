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
        // A second `setClipGain` on the same clip in one batch must predict from
        // what an earlier action in it will leave the clip at: `validate` runs for
        // every action in the batch before any `execute`, so a live-only read
        // here would reject a legal compounding batch — including a grouped
        // undo's own atomic replay of two `setClipGain` inverses — as conflicted.
        const plannedClip =
            clip && getPlannedTrackState(context, clip.trackId)?.clips.find((candidate) => candidate.id === clip.id);
        const previousClip = plannedClip ?? clip;
        if (action.payload.expectedGain !== undefined) {
            if (previousClip === undefined || !Object.is(previousClip.gain, action.payload.expectedGain)) {
                return false;
            }
        }
        // The linear form has always been admitted without reading the clip, so
        // it still is; only a decibel request needs a level to resolve against.
        if (action.payload.gain !== undefined) {
            return true;
        }
        if (previousClip === undefined) {
            return false;
        }
        return requestedGain(action, previousClip.gain).ok;
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
    describe: (alpha, context) => {
        const clip = findClip(alpha.payload.clipId);
        // A second `setClipGain` on the same clip in one batch must predict from
        // what an earlier action in it will leave the clip at, the same reason
        // `validate` reads through `getPlannedTrackState` above: `describe` runs
        // for every action before any `execute`, so a live-only prediction here
        // would build an inverse whose `expectedGain` the batch's own sequential
        // execution can never match, and undoing the group would conflict forever.
        const plannedClip =
            context && clip
                ? getPlannedTrackState(context, clip.trackId)?.clips.find((candidate) => candidate.id === clip.id)
                : undefined;
        const previousClip = plannedClip ?? clip;
        const requested = previousClip === undefined ? null : requestedGain(alpha, previousClip.gain);
        return {
            label: 'Set clip gain',
            // The inverse expects the gain this action is about to write, clamped the same way the
            // write clamps it. That makes the undo compensable: it refuses instead of clobbering a
            // gain something else moved after the forward action landed. It restores the stored
            // amplitude linearly whatever form the forward action used.
            inverseAction:
                previousClip && requested?.ok
                    ? {
                          type: 'setClipGain',
                          payload: {
                              clipId: previousClip.id,
                              gain: previousClip.gain,
                              expectedGain: clampClipGain(requested.linear),
                          },
                      }
                    : null,
            // Without this, `redo.ts` would replay the forward action's own
            // `deltaDb`/`gainDb`, re-resolving it against whatever gain the clip
            // holds at redo time instead of the gain this `describe` actually
            // predicted — the redo could land somewhere the retained inverse never
            // expects, conflicting on every later undo. Stated linearly, the same
            // way the inverse is, so replay always lands exactly where forward
            // execution did.
            redoAction:
                previousClip && requested?.ok
                    ? {
                          type: 'setClipGain',
                          payload: {
                              clipId: previousClip.id,
                              gain: clampClipGain(requested.linear),
                              expectedGain: previousClip.gain,
                          },
                      }
                    : undefined,
        };
    },
    undoable: true,
});
