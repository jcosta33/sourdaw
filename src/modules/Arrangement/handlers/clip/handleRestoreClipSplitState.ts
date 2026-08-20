import { midiClipSplitStateMatches, restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { clipSplitStateRestorable } from '../../useCases/clipEditing/clipSplitStateRestorable';
import { replaceClipSplitTrackState } from '../../useCases/clipEditing/replaceClipSplitTrackState';

type RestoreClipSplitStateAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;

/** Same precondition `execute` writes against, split across the track-state and MIDI-state
 *  stores it reads from — mirrors `replaceClipSplitTrackState` + `restoreMidiClipSplitState`
 *  exactly, reused by `validate` so a batch preflight refuses a diverged clip instead of
 *  executing into a silent overwrite. */
function clipSplitStateMatches(action: RestoreClipSplitStateAction): boolean {
    return (
        clipSplitStateRestorable(action.payload) &&
        midiClipSplitStateMatches({
            sourceClipId: action.payload.clipId,
            rightClipId: action.payload.rightClipId,
            expectedSource: action.payload.expected.sourceMidi,
            expectedRight: action.payload.expected.rightMidi,
            replacementSource: action.payload.replacement.sourceMidi,
            replacementRight: action.payload.replacement.rightMidi,
        })
    );
}

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    // `expected`/`replacement` are mandatory on this payload, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: clipSplitStateMatches,
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
