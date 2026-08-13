import { restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { replaceClipSplitTrackState } from '../../useCases/clipEditing/replaceClipSplitTrackState';

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    execute: (action) => {
        const trackRestored = replaceClipSplitTrackState(action.payload);
        if (!trackRestored) {
            return { status: 'conflict' };
        }
        const midiRestored = restoreMidiClipSplitState({
            sourceClipId: action.payload.clipId,
            rightClipId: action.payload.rightClipId,
            expectedSource: action.payload.expected.sourceMidi,
            expectedRight: action.payload.expected.rightMidi,
            replacementSource: action.payload.replacement.sourceMidi,
            replacementRight: action.payload.replacement.rightMidi,
        });
        return midiRestored ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore clip split state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
