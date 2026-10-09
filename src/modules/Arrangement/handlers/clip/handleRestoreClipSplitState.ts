import { midiClipSplitStateMatches, restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { clipSatelliteEntriesMatchSnapshot, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { applyClipAutomationLaneTransition } from '../../useCases/clip/applyClipAutomationLaneTransition';
import { clipAutomationLaneTransitionMatchesStore } from '../../useCases/clip/clipAutomationLaneTransitionMatchesStore';
import { clipSplitStateRestorable } from '../../useCases/clipEditing/clipSplitStateRestorable';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { replaceClipSplitTrackState } from '../../useCases/clipEditing/replaceClipSplitTrackState';
import { removeTakesForClips } from '../../useCases/comping/removeTakesForClips';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { retiredTakeLaneOwnersMatchStore } from '../../useCases/comping/retiredTakeLaneOwnersMatchStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { clipSplitCaptureOwnersMatch, isRestoreClipSplitSessionPayload } from './validateClipEditSessionEntries';

type RestoreClipSplitStateAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;

/**
 * The right fragment's lanes: guarded only when the snapshot carries them, so
 * split actions captured before lanes joined the snapshot decode without a
 * precondition to check. The guard is scoped to the right clip id — the left
 * half keeps its id and its lanes untouched on both legs of the transition.
 */
function clipAutomationLanesMatch(
    action: RestoreClipSplitStateAction,
    lanes: NonNullable<ReturnType<typeof projectClipReplayPrefix>>['lanes']
): boolean {
    const expectedLanes = action.payload.expected.clipAutomationLanes;
    const replacementLanes = action.payload.replacement.clipAutomationLanes;
    if (expectedLanes === undefined && replacementLanes === undefined) {
        return true;
    }
    return clipAutomationLaneTransitionMatchesStore(
        [action.payload.rightClipId],
        expectedLanes ?? [],
        replacementLanes ?? [],
        lanes
    );
}

/** Same precondition `execute` writes against, split across the track-state, MIDI-state and
 *  satellite stores it reads from — mirrors `replaceClipSplitTrackState`,
 *  `restoreMidiClipSplitState` and `execute`'s own satellite guard exactly, reused by
 *  `validate` so a batch preflight refuses a diverged clip instead of executing into a
 *  conflict. */
function clipSplitStateMatches(action: RestoreClipSplitStateAction, context?: HandlerValidationContext): boolean {
    const priorActions = context?.actions.slice(0, context.actionIndex) ?? [];
    const projected = projectClipReplayPrefix(priorActions);
    if (!projected) {
        return false;
    }
    const tracks =
        getTrackStoreState()?.tracks.map((track) => ({
            id: track.id,
            clips: projected.clips.filter((owner) => owner.owningTrackId === track.id).map((owner) => owner.clip),
        })) ?? [];
    return (
        clipSplitCaptureOwnersMatch(action.payload) &&
        retiredTakeLaneOwnersMatchStore(action.payload.retiredTakeLanes ?? [], priorActions) &&
        clipSplitStateRestorable(action.payload, { tracks }) &&
        midiClipSplitStateMatches(
            {
                sourceClipId: action.payload.clipId,
                rightClipId: action.payload.rightClipId,
                expectedSource: action.payload.expected.sourceMidi,
                expectedRight: action.payload.expected.rightMidi,
                replacementSource: action.payload.replacement.sourceMidi,
                replacementRight: action.payload.replacement.rightMidi,
            },
            undefined,
            priorActions
        ) &&
        (action.payload.expected.clipSatellites === undefined ||
            clipSatelliteEntriesMatchSnapshot(action.payload.expected.clipSatellites, priorActions)) &&
        clipAutomationLanesMatch(action, projected.lanes)
    );
}

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    validateSessionActionArguments: isRestoreClipSplitSessionPayload,
    // `expected`/`replacement` are mandatory on this payload, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: clipSplitStateMatches,
    execute: (action) => {
        if (!clipSplitStateMatches(action)) {
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
        if (action.payload.expected.clipAutomationLanes !== undefined) {
            const lanesRestored = applyClipAutomationLaneTransition(
                [action.payload.rightClipId],
                action.payload.expected.clipAutomationLanes,
                action.payload.replacement.clipAutomationLanes ?? []
            );
            if (!lanesRestored) {
                return { status: 'conflict' };
            }
        }
        if (action.payload.replacement.clipSatellites) {
            for (const entry of action.payload.replacement.clipSatellites) {
                writeClipSatelliteEntry(entry);
            }
        }
        // Undo leg: the replacement carries no right clip, so the track restore
        // just filtered it out — retire its take lanes too, capturing them into
        // the shared payload array so the paired redo can put back a take that
        // landed on the right half after the split. Runs only after every
        // conflict-prone step passed, so a conflict retires nothing. The type is
        // `ClipStateSnapshot | null` and `prepareClipSplit` writes `null`, so the
        // discriminator is falsiness — `=== undefined` never fires on a real
        // payload, which is how the first cut of this leg silently never ran.
        if (!action.payload.replacement.rightClip) {
            const retired = removeTakesForClips([action.payload.rightClipId]);
            action.payload.retiredTakeLanes?.splice(0, action.payload.retiredTakeLanes.length, ...retired);
        } else if (action.payload.retiredTakeLanes !== undefined) {
            // Redo leg: re-splice put the right clip back; reinstate the takes
            // the undo retired from it.
            restoreTakesForClip(action.payload.retiredTakeLanes);
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip split state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
