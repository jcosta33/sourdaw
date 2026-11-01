import { restoreClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';

import { type ClipAudioSourceFields, replaceClipAudioSource } from '../../models/ClipAudioSource';
import { type Clip } from '../../models/Track';
import { updateClipInStore } from '../../stores/updateClipInStore';
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

/**
 * Inverse and redo of `reverseClip`, guarded on the buffer the forward run produced.
 * Only ever dispatched from the undo engine (with `skipUndo`), so it is not itself
 * undoable.
 */
export const handleRestoreReversedClip = createHandler<'restoreReversedClip'>({
    execute: (action) => {
        const clip = findClip(action.payload.clipId);
        if (!clip || clip.audioBufferId !== action.payload.expectedAudioBufferId) {
            return { status: 'conflict' };
        }
        const audioSource = action.payload.audioSource;
        if (!restoreAudioSource(clip, audioSource)) {
            return { status: 'no-write' };
        }
        updateClipInStore(action.payload.clipId, (candidate) => ({
            ...(restoreAudioSource(candidate, audioSource) ?? candidate),
            audioBufferId: action.payload.audioBufferId,
            name: action.payload.name,
            ...(action.payload.fadeInBeats !== undefined ? { fadeInBeats: action.payload.fadeInBeats } : {}),
            ...(action.payload.fadeOutBeats !== undefined ? { fadeOutBeats: action.payload.fadeOutBeats } : {}),
            ...(action.payload.audioOffsetBeats !== undefined
                ? { audioOffsetBeats: action.payload.audioOffsetBeats }
                : {}),
            ...(action.payload.loopOriginBeat !== undefined ? { loopOriginBeat: action.payload.loopOriginBeat } : {}),
        }));
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
