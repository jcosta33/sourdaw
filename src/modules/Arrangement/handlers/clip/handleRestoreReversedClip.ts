import { restoreClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { updateClipInStore } from '../../stores/updateClipInStore';
import { type ClipAudioSourceFields } from '../../useCases/clipEditing/clipAudioSourceFields';
import { replaceClipAudioSource } from '../../useCases/clipEditing/replaceClipAudioSource';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

function findClip(clipId: string) {
    for (const track of getTrackStoreState()?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

/** A capture replaces the source clock whole; an entry recorded without one leaves it untouched. */
function restoreAudioSource(clip: Clip, audioSource: ClipAudioSourceFields | undefined): Clip | null {
    return audioSource ? replaceClipAudioSource(clip, audioSource) : clip;
}

function restoreBeatAlias(
    clip: Clip,
    capture: Extract<AppAction, { type: 'restoreReversedClip' }>['payload']['audioOffsetBeatsCapture']
): Clip {
    if (capture === undefined) {
        return clip;
    }
    if (capture.present) {
        return { ...clip, audioOffsetBeats: capture.value };
    }
    const { audioOffsetBeats: _alias, ...rest } = clip;
    return rest;
}

type RestoreAction = Extract<AppAction, { type: 'restoreReversedClip' }>;

/**
 * A restore replayed right after the reverse it inverts, as a compensation inside one batch is, finds
 * the clip still on the buffer it held before: the reverse has not run yet. The buffer it expects is
 * then the reversed one the reverse will mint, and the clip must hold the one the restore puts back.
 */
function followsItsReverse(action: RestoreAction, context: HandlerValidationContext | undefined): boolean {
    const previous = context?.actions[context.actionIndex - 1];
    return (
        previous?.type === 'reverseClip' &&
        previous.payload.clipId === action.payload.clipId &&
        previous.payload.reversedBufferId === action.payload.expectedAudioBufferId
    );
}

function isGuardCurrent(action: RestoreAction, context?: HandlerValidationContext): boolean {
    const held = findClip(action.payload.clipId)?.audioBufferId;
    if (followsItsReverse(action, context)) {
        return held === action.payload.audioBufferId;
    }
    return held === action.payload.expectedAudioBufferId;
}

/**
 * Inverse and redo of `reverseClip`, guarded on the buffer the forward run produced.
 * Only ever dispatched from the undo engine (with `skipUndo`), so it is not itself
 * undoable.
 */
export const handleRestoreReversedClip = createHandler<'restoreReversedClip'>({
    batchExecution: 'singleton',
    canReportConflict: true,
    validate: isGuardCurrent,
    canReapplyAfterDivergence: isGuardCurrent,
    execute: (action) => {
        const clip = findClip(action.payload.clipId);
        if (!clip || clip.audioBufferId !== action.payload.expectedAudioBufferId) {
            return { status: 'conflict' };
        }
        const audioSource = action.payload.audioSource;
        if (!restoreAudioSource(clip, audioSource)) {
            return { status: 'no-write' };
        }
        updateClipInStore(action.payload.clipId, (candidate) =>
            restoreBeatAlias(
                {
                    ...(restoreAudioSource(candidate, audioSource) ?? candidate),
                    audioBufferId: action.payload.audioBufferId,
                    name: action.payload.name,
                    ...(action.payload.fadeInBeats !== undefined ? { fadeInBeats: action.payload.fadeInBeats } : {}),
                    ...(action.payload.fadeOutBeats !== undefined ? { fadeOutBeats: action.payload.fadeOutBeats } : {}),
                    ...(action.payload.audioOffsetBeats !== undefined
                        ? { audioOffsetBeats: action.payload.audioOffsetBeats }
                        : {}),
                    ...(action.payload.loopOriginBeat !== undefined
                        ? { loopOriginBeat: action.payload.loopOriginBeat }
                        : {}),
                },
                action.payload.audioOffsetBeatsCapture
            )
        );
        // The pointer and the analysis fall together, for the same reason the forward
        // path drops them together: blobs are the live shift the Knead worklet applies,
        // so leaving them over restored audio is a second, unasked-for pitch change.
        restoreClipPitchAnalysis(action.payload.clipId, {
            blobs: action.payload.blobs,
            contour: action.payload.contour,
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore reversed clip', inverseAction: null }),
    undoable: false,
});
