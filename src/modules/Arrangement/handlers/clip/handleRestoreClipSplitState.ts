import { midiClipSplitStateMatches, restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { clipSatelliteEntriesMatchSnapshot, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { clipSplitStateRestorable } from '../../useCases/clipEditing/clipSplitStateRestorable';
import { replaceClipSplitTrackState } from '../../useCases/clipEditing/replaceClipSplitTrackState';

type RestoreClipSplitStateAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;

/** Same precondition `execute` writes against, split across the track-state, MIDI-state and
 *  satellite stores it reads from — mirrors `replaceClipSplitTrackState`,
 *  `restoreMidiClipSplitState` and `execute`'s own satellite guard exactly, reused by
 *  `validate` so a batch preflight refuses a diverged clip instead of executing into a
 *  conflict. */
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
        }) &&
        (action.payload.expected.clipSatellites === undefined ||
            clipSatelliteEntriesMatchSnapshot(action.payload.expected.clipSatellites))
    );
}

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    // `expected`/`replacement` are mandatory on this payload, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: clipSplitStateMatches,
    execute: (action) => {
        // Undefined stays permissive: split actions captured before satellites joined
        // the snapshot decode without the field and carry no precondition to check.
        const expectedSatellites = action.payload.expected.clipSatellites;
        if (expectedSatellites !== undefined && !clipSatelliteEntriesMatchSnapshot(expectedSatellites)) {
            return { status: 'conflict' };
        }
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
        if (!midiRestored) {
            return { status: 'conflict' };
        }
        if (action.payload.replacement.clipSatellites) {
            for (const entry of action.payload.replacement.clipSatellites) {
                writeClipSatelliteEntry(entry);
            }
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip split state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
