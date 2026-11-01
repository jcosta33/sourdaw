import { createHandler } from '#/utils/createHandler';

import { audioClipSlipOwner } from '../../useCases/clipEditing/audioClipSlipOwner';
import { audioClipSlipState } from '../../useCases/clipEditing/audioClipSlipState';

export const handleRestoreAudioClipSlip = createHandler<'restoreAudioClipSlip'>({
    batchExecution: 'singleton',
    canReportConflict: true,
    canReapplyAfterDivergence: () => true,
    validateSessionActionArguments: audioClipSlipState.isPayload,
    validate: (action) => {
        const capture = audioClipSlipState.decodePayload(action.payload);
        return (
            capture !== null &&
            audioClipSlipOwner.matches(capture.direction === 'restore' ? capture.after : capture.before, capture.clock)
        );
    },
    execute: (action) => {
        const capture = audioClipSlipState.decodePayload(action.payload);
        if (!capture) {
            return { status: 'conflict' };
        }
        const expected = capture.direction === 'restore' ? capture.after : capture.before;
        const replacement = capture.direction === 'restore' ? capture.before : capture.after;
        if (!audioClipSlipOwner.matches(expected, capture.clock)) {
            return { status: 'conflict' };
        }
        const proof = audioClipSlipOwner.captureCommitValidation(expected, replacement, capture.clock);
        if (!proof) {
            return { status: 'conflict' };
        }
        if (!audioClipSlipOwner.write(expected, replacement)) {
            proof.release();
            return { status: 'conflict' };
        }
        return { status: 'written', commitValidation: proof };
    },
    describe: () => ({ label: 'Restore audio clip slip', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
