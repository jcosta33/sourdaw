import { createHandler } from '#/utils/createHandler';

import { audioClipStartTrimState } from '../../useCases/clipEditing/audioClipStartTrimState';
import { audioClipTrimOwner } from '../../useCases/clipEditing/audioClipTrimOwner';
import { updateClip } from '../../useCases/updateClip';

export const handleRestoreAudioClipStartTrim = createHandler<'restoreAudioClipStartTrim'>({
    batchExecution: 'singleton',
    canReportConflict: true,
    canReapplyAfterDivergence: () => true,
    validateSessionActionArguments: audioClipStartTrimState.isPayload,
    validate: (action) => {
        const capture = audioClipStartTrimState.decodePayload(action.payload);
        if (!capture) {
            return false;
        }
        return audioClipTrimOwner.matches(
            capture.direction === 'restore' ? capture.after : capture.before,
            capture.clock
        );
    },
    execute: (action) => {
        const capture = audioClipStartTrimState.decodePayload(action.payload);
        if (!capture) {
            return { status: 'conflict' };
        }
        const expected = capture.direction === 'restore' ? capture.after : capture.before;
        const replacement = capture.direction === 'restore' ? capture.before : capture.after;
        if (!audioClipTrimOwner.matches(expected, capture.clock)) {
            return { status: 'conflict' };
        }
        const proof = audioClipTrimOwner.captureCommitValidation(expected, replacement, capture.clock);
        if (!proof) {
            return { status: 'conflict' };
        }
        const written = updateClip(capture.clipId, (clip) => {
            const updated = { ...clip, startBeat: replacement.startBeat };
            for (const field of audioClipStartTrimState.optionalFields) {
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
