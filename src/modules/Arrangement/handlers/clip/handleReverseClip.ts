import { captureClipPitchAnalysis } from '#/modules/Knead/useCases';
import { createHandler } from '#/utils/createHandler';

import { reverseClip } from '../../useCases/clipEditing/reverseClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function findAudioClip(clipId: string) {
    for (const track of getTrackStoreState()?.tracks ?? []) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

export const handleReverseClip = createHandler<'reverseClip'>({
    execute: (alpha) => {
        const didWrite = reverseClip(alpha.payload.clipId, alpha.payload.reversedBufferId);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => {
        // Reversing again is not the inverse. Each run mints a fresh buffer id, appends
        // another " (reversed)" to the name and drops the clip's pitch analysis, so a
        // second reverse restores the audio but leaves the metadata changed and the
        // user's Knead edits destroyed. Capture all three and put them back together.
        const clip = findAudioClip(alpha.payload.clipId);
        const reversedBufferId = alpha.payload.reversedBufferId;
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId || !reversedBufferId) {
            return { label: 'Reverse clip', inverseAction: null };
        }
        const analysis = captureClipPitchAnalysis(alpha.payload.clipId);
        return {
            label: 'Reverse clip',
            inverseAction: {
                type: 'restoreReversedClip',
                payload: {
                    clipId: clip.id,
                    expectedAudioBufferId: reversedBufferId,
                    audioBufferId: clip.audioBufferId,
                    name: clip.name,
                    ...analysis,
                },
            },
            redoAction: {
                type: 'restoreReversedClip',
                payload: {
                    clipId: clip.id,
                    expectedAudioBufferId: clip.audioBufferId,
                    audioBufferId: reversedBufferId,
                    name: `${clip.name} (reversed)`,
                    // The forward path clears pitch analysis, so redo restores none.
                },
            },
        };
    },
    undoable: true,
});
