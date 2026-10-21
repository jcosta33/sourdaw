import { midiClipSplitStateMatches } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clipSatelliteEntriesMatchSnapshot } from '../../stores/clipSatelliteState';
import { clipAutomationLaneTransitionMatchesStore } from '../clip/clipAutomationLaneTransitionMatchesStore';
import { prepareClipSplitTakeReplay } from '../comping/prepareClipSplitTakeReplay';

import { clipSplitStateRestorable } from './clipSplitStateRestorable';

type RestoreClipSplitStateAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;

/**
 * The right fragment's lanes: guarded only when the snapshot carries them, so
 * split actions captured before lanes joined the snapshot decode without a
 * precondition to check. The guard is scoped to the right clip id — the left
 * half keeps its id and its lanes untouched on both legs of the transition.
 */
function clipAutomationLanesMatch(action: RestoreClipSplitStateAction): boolean {
    const expectedLanes = action.payload.expected.clipAutomationLanes;
    const replacementLanes = action.payload.replacement.clipAutomationLanes;
    if (expectedLanes === undefined && replacementLanes === undefined) {
        return true;
    }
    return clipAutomationLaneTransitionMatchesStore(
        [action.payload.rightClipId],
        expectedLanes ?? [],
        replacementLanes ?? []
    );
}

/** Same precondition `execute` writes against, split across the track-state, MIDI-state and
 *  satellite stores it reads from — mirrors `replaceClipSplitTrackState`,
 *  `restoreMidiClipSplitState` and `execute`'s own satellite guard exactly, reused by
 *  `validate` so a batch preflight refuses a diverged clip instead of executing into a
 *  conflict. */
export function clipSplitStateMatches(action: RestoreClipSplitStateAction): boolean {
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
            clipSatelliteEntriesMatchSnapshot(action.payload.expected.clipSatellites)) &&
        clipAutomationLanesMatch(action) &&
        prepareClipSplitTakeReplay(action.payload) !== null
    );
}
