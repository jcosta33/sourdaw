import {
    captureDurableDocumentWitness,
    captureProjectMutationAuthorization,
    getCrdtDoc,
    hasForeignPendingProjectWrites,
} from '#/modules/CrdtDocument/useCases';
import { midiClipSplitStateMatches, restoreMidiClipSplitState } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';
import { clipSatelliteEntriesMatchSnapshot, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { applyClipAutomationLaneTransition } from '../../useCases/clip/applyClipAutomationLaneTransition';
import { clipAutomationLaneTransitionMatchesStore } from '../../useCases/clip/clipAutomationLaneTransitionMatchesStore';
import { captureRestoreClipSplitCommitValidation } from '../../useCases/clipEditing/captureRestoreClipSplitCommitValidation';
import { clipSplitStateRestorable } from '../../useCases/clipEditing/clipSplitStateRestorable';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { readClipSplitIdentityIds } from '../../useCases/clipEditing/readClipSplitIdentityIds';
import { replaceClipSplitTrackState } from '../../useCases/clipEditing/replaceClipSplitTrackState';
import { applyTakeReKeyTransitions } from '../../useCases/comping/applyTakeReKeyTransitions';
import { planTakeRetirement } from '../../useCases/comping/planTakeRetirement';
import { reKeyedTakeLaneOwnersMatchStore } from '../../useCases/comping/reKeyedTakeLaneOwnersMatchStore';
import { removeTakesForClips } from '../../useCases/comping/removeTakesForClips';
import { restoreTakeReKeyTransitions } from '../../useCases/comping/restoreTakeReKeyTransitions';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { retiredTakeLaneOwnersMatchStore } from '../../useCases/comping/retiredTakeLaneOwnersMatchStore';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

import { createdClipMidiCapture } from './createdClipMidiCapture';
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
    projected: NonNullable<ReturnType<typeof projectClipReplayPrefix>>
): boolean {
    const expectedLanes = action.payload.expected.clipAutomationLanes;
    const replacementLanes = action.payload.replacement.clipAutomationLanes;
    if (expectedLanes === undefined && replacementLanes === undefined) {
        return true;
    }
    // Captured IDs are stable across replay. A later peer may claim one after
    // Undo, so refuse instead of reminting or duplicating another owner's ID.
    const retainedIds = readClipSplitIdentityIds(
        projected.lanes.filter((lane) => lane.clipId !== action.payload.rightClipId),
        projected.clips.map((owner) => owner.clip)
    );
    const replacementIds = collectClipSplitIdentityIds(replacementLanes ?? []);
    if (new Set(replacementIds).size !== replacementIds.length || replacementIds.some((id) => retainedIds.has(id))) {
        return false;
    }
    return clipAutomationLaneTransitionMatchesStore(
        [action.payload.rightClipId],
        expectedLanes ?? [],
        replacementLanes ?? [],
        projected.lanes
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
    if (!projected || (action.payload.expected.leftClip.type === 'audio' && !projected.tracks)) {
        return false;
    }
    const tracks =
        getTrackStoreState()?.tracks.map((track) => ({
            id: track.id,
            clips: projected.clips.filter((owner) => owner.owningTrackId === track.id).map((owner) => owner.clip),
        })) ?? [];
    let takePriorActions = priorActions;
    let takeLanes: Parameters<typeof reKeyedTakeLaneOwnersMatchStore>[3] = undefined;
    if (priorActions.some((action) => action.type === 'setTempo' || action.type === 'restoreTempoEdit')) {
        if (!projected.tracks) {
            return false;
        }
        takePriorActions = [];
        takeLanes = projected.takeLanes;
    }
    return (
        !hasForeignPendingProjectWrites() &&
        clipSplitCaptureOwnersMatch(action.payload) &&
        retiredTakeLaneOwnersMatchStore(action.payload.retiredTakeLanes ?? [], priorActions) &&
        reKeyedTakeLaneOwnersMatchStore(
            action.payload.reKeyedTakeLanes ?? [],
            action.payload.replacement.rightClip ? 'apply' : 'restore',
            takePriorActions,
            takeLanes
        ) &&
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
        clipAutomationLanesMatch(action, projected)
    );
}

function applySplitTakeTransition(
    payload: RestoreClipSplitStateAction['payload']
): ReturnType<typeof removeTakesForClips> {
    // Undo leg: the replacement carries no right clip, so the track restore
    // just filtered it out — retire its take lanes too, staging their capture
    // so the paired redo can put back a take that
    // landed on the right half after the split. Runs only after every
    // conflict-prone step passed, so a conflict retires nothing. The type is
    // `ClipStateSnapshot | null` and `prepareClipSplit` writes `null`, so the
    // discriminator is falsiness — `=== undefined` never fires on a real
    // payload, which is how the first cut of this leg silently never ran.
    if (!payload.replacement.rightClip) {
        const reKeyedTakeIds = new Set(
            (payload.reKeyedTakeLanes ?? []).flatMap((transition) => transition.takesAfter.map((take) => take.id))
        );
        // Capture late right-side material before the transition's liveness
        // filter retires it. Transition-owned ids remain its sole responsibility.
        const reKeyedTiles = (payload.reKeyedTakeLanes ?? []).flatMap(
            (transition) => transition.baseGapAudioSourcesAfter ?? []
        );
        const stagedRetired =
            planTakeRetirement([payload.rightClipId], reKeyedTakeIds, { preservedBaseGapAudioSources: reKeyedTiles })
                ?.retiredLanes ?? [];
        // The split's re-key (#5048) rides the shared payload array: with
        // the clips back on the track and the lane still present, put its
        // pre-split facets back before retiring any remaining right material.
        restoreTakeReKeyTransitions(payload.reKeyedTakeLanes ?? []);
        removeTakesForClips([payload.rightClipId]);
        return stagedRetired;
    }
    if (payload.retiredTakeLanes !== undefined || payload.reKeyedTakeLanes !== undefined) {
        // Redo leg: re-splice put the right clip back; reinstate the takes
        // the undo retired from it and re-apply the split's re-key.
        restoreTakesForClip(payload.retiredTakeLanes ?? []);
        applyTakeReKeyTransitions(payload.reKeyedTakeLanes ?? []);
    }
    return [];
}

function prepareCreatedMidi(action: RestoreClipSplitStateAction) {
    if (!action.payload.replacement.rightClip || action.payload.expected.rightClip) {
        return null;
    }
    return createdClipMidiCapture({ phase: 'prepare', action, clipId: action.payload.rightClipId });
}

function restoreSplitOwners(payload: RestoreClipSplitStateAction['payload']): boolean {
    if (!replaceClipSplitTrackState(payload)) {
        return false;
    }
    if (
        !restoreMidiClipSplitState({
            sourceClipId: payload.clipId,
            rightClipId: payload.rightClipId,
            expectedSource: payload.expected.sourceMidi,
            expectedRight: payload.expected.rightMidi,
            replacementSource: payload.replacement.sourceMidi,
            replacementRight: payload.replacement.rightMidi,
        })
    ) {
        return false;
    }
    if (payload.expected.clipAutomationLanes !== undefined) {
        const lanesRestored = applyClipAutomationLaneTransition(
            [payload.rightClipId],
            payload.expected.clipAutomationLanes,
            payload.replacement.clipAutomationLanes ?? []
        );
        if (!lanesRestored) {
            return false;
        }
    }
    if (payload.replacement.clipSatellites) {
        for (const entry of payload.replacement.clipSatellites) {
            writeClipSatelliteEntry(entry);
        }
    }
    return true;
}

export const handleRestoreClipSplitState = createHandler<'restoreClipSplitState'>({
    validateSessionActionArguments: isRestoreClipSplitSessionPayload,
    // `expected`/`replacement` are mandatory on this payload, so every instance carries a real
    // precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: clipSplitStateMatches,
    prepareAbort: (action) => () => createdClipMidiCapture({ phase: 'discard', action }),
    execute: (action) => {
        if (hasForeignPendingProjectWrites() || !clipSplitStateMatches(action)) {
            return { status: 'conflict' };
        }
        const proof = captureRestoreClipSplitCommitValidation(action);
        const capture = !action.payload.replacement.rightClip ? action.payload.retiredTakeLanes : undefined;
        let createdMidi: ReturnType<typeof prepareCreatedMidi> = null;
        const conflict = () => {
            proof?.validation.release();
            createdMidi?.discard();
            return { status: 'conflict' as const };
        };
        try {
            createdMidi = prepareCreatedMidi(action);
            createdMidi?.stage(action.payload.replacement.rightMidi);
            const documentBeforeReplay = capture ? captureDurableDocumentWitness() : null;
            const ownsPublication = capture ? captureProjectMutationAuthorization() : null;
            // Bind inside this handler's storage transaction, before any owner writes.
            ownsPublication?.();
            let stagedRetired: ReturnType<typeof removeTakesForClips> = [];
            const installCapture = () => {
                createdClipMidiCapture({ phase: 'discard', action });
                if (
                    capture &&
                    getCrdtDoc('root') &&
                    captureDurableDocumentWitness() !== documentBeforeReplay &&
                    ownsPublication?.()
                ) {
                    capture.splice(0, capture.length, ...stagedRetired);
                }
            };
            if (!restoreSplitOwners(action.payload)) {
                return conflict();
            }
            stagedRetired = applySplitTakeTransition(action.payload);
            createdMidi?.complete();
            if (proof && !proof.captureWrittenState()) {
                return conflict();
            }
            // The paired arrays belong to history, outside the project transaction.
            // Publish their staged capture only once this exact owner committed.
            if (capture || createdMidi) {
                return {
                    status: 'written',
                    commitValidation: proof?.validation,
                    afterCommit: installCapture,
                    afterAmbiguousCommit: installCapture,
                };
            }
            return { status: 'written', commitValidation: proof?.validation };
        } catch (error) {
            proof?.validation.release();
            createdMidi?.discard();
            throw error;
        }
    },
    describe: () => ({ label: 'Restore clip split state', inverseAction: null }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
