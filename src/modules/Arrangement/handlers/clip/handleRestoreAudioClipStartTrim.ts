import { createHandler } from '#/utils/createHandler';

import { updateClip } from '../../repositories/track/updateClip';
import {
    audioClipStartTrimOptionalFields,
    decodeAudioClipStartTrimPayload,
    isAudioClipStartTrimPayload,
} from '../../useCases/clipEditing/audioClipStartTrimState';
import { audioClipTrimOwnerMatches, captureAudioClipTrimCommitValidation } from '../../useCases/clipEditing/audioClipTrimOwner';

export const handleRestoreAudioClipStartTrim = createHandler<'restoreAudioClipStartTrim'>({
    batchExecution: 'singleton',
    canReportConflict: true,
    canReapplyAfterDivergence: () => true,
    validateSessionActionArguments: isAudioClipStartTrimPayload,
    validate: (action) => {
        const capture = decodeAudioClipStartTrimPayload(action.payload);
        if (!capture) {
            return false;
        }
        return audioClipTrimOwnerMatches(capture.direction === 'restore' ? capture.after : capture.before, capture.clock);
    },
    execute: (action) => {
        const capture = decodeAudioClipStartTrimPayload(action.payload);
        if (!capture) {
            return { status: 'conflict' };
        }
        const expected = capture.direction === 'restore' ? capture.after : capture.before;
        const replacement = capture.direction === 'restore' ? capture.before : capture.after;
        if (!audioClipTrimOwnerMatches(expected, capture.clock)) {
            return { status: 'conflict' };
        }
        const proof = captureAudioClipTrimCommitValidation(expected, replacement, capture.clock);
        if (!proof) {
            return { status: 'conflict' };
        }
        const written = updateClip(capture.clipId, (clip) => {
            const updated = { ...clip, startBeat: replacement.startBeat };
            for (const field of audioClipStartTrimOptionalFields) {
                if (Object.hasOwn(replacement, field)) {
                    updated[field] = replacement[field];
                } else {
                    delete updated[field];
                }
            }
            return updated;
        });
        if (!written) {
            proof.release();
            return { status: 'conflict' };
        }
        return { status: 'written', commitValidation: proof };
    },
    describe: () => ({ label: 'Restore audio clip start', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
