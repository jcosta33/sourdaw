import { restoreClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';

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
        updateClipInStore(action.payload.clipId, (candidate) => ({
            ...candidate,
            audioBufferId: action.payload.audioBufferId,
            name: action.payload.name,
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
