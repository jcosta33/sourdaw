import { clipAutomationMoveStateMatches, restoreClipAutomationMoveState } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ClipMoveActionSnapshot, type HandlerValidationContext } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { audioSourceStateMatches } from '../../useCases/clipEditing/audioSourceStateMatches';
import { isAudioSourceStateSnapshot } from '../../useCases/clipEditing/isAudioSourceStateSnapshot';
import { takeSourceDepthsMatch } from '../../useCases/comping/takeSourceDepthsMatch';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectClipThroughPriorBatchActions, type ProjectedClipState } from '../projectClipThroughPriorBatchActions';

import { isRestoreClipPlacementSessionPayload } from './validateClipEditSessionEntries';

function placementsMatch(left: ClipMoveActionSnapshot, right: ClipMoveActionSnapshot): boolean {
    return (
        left.trackId === right.trackId &&
        Object.is(left.startBeat, right.startBeat) &&
        Object.is(left.endBeat, right.endBeat)
    );
}

function readPlacement(clipId: string):
    | (Omit<ClipMoveActionSnapshot, 'automationLanes'> & {
          sourceMatches: (expected: ClipMoveActionSnapshot) => boolean;
      })
    | null {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    return track && clip
        ? {
              trackId: track.id,
              startBeat: clip.startBeat,
              endBeat: clip.endBeat,
              sourceMatches: (expected) =>
                  expected.audioSource === undefined ||
                  (isAudioSourceStateSnapshot(expected.audioSource) &&
                      audioSourceStateMatches(clip, expected.audioSource)),
          }
        : null;
}

type RestoreClipPlacementAction = Extract<AppAction, { type: 'restoreClipPlacement' }>;

/** Same expected-placement match `execute` writes against, reused by `validate` so a batch
 *  preflight rejects a diverged placement instead of executing into a silent overwrite. */
function expectedPlacementMatches(action: RestoreClipPlacementAction): boolean {
    const current = readPlacement(action.payload.clipId);
    return (
        current !== null &&
        placementsMatch({ ...current, automationLanes: [] }, { ...action.payload.expected, automationLanes: [] }) &&
        current.sourceMatches(action.payload.expected) &&
        (action.payload.expected.takeSources === undefined ||
            (Array.isArray(action.payload.expected.takeSources) &&
                takeSourceDepthsMatch(action.payload.clipId, action.payload.expected.takeSources))) &&
        clipAutomationMoveStateMatches(action.payload.clipId, action.payload.expected.automationLanes)
    );
}

/**
 * The batch-aware form of the same check (#3814): a grouped-undo replay
 * preflight runs before any sibling has executed, so a prior `restoreTrack`
 * that re-homes the clip (or a prior removal sibling that retires it) must be
 * projected before the expected placement — and the lanes the move carried —
 * are compared. Without prior siblings the projection is the live read, so
 * this behaves exactly like `expectedPlacementMatches`; `execute` keeps the
 * live form because its self-guard runs after the predecessors have applied.
 */
function expectedPlacementMatchesProjected(
    action: RestoreClipPlacementAction,
    context: HandlerValidationContext
): boolean {
    const projected = projectClipThroughPriorBatchActions(action.payload.clipId, context);
    const located = projected.locatedClip;
    if (!located) {
        return false;
    }
    const placementMatches = placementsMatch(
        {
            trackId: located.owningTrackId,
            startBeat: located.clip.startBeat,
            endBeat: located.clip.endBeat,
            automationLanes: [],
        },
        { ...action.payload.expected, automationLanes: [] }
    );
    return (
        placementMatches &&
        (action.payload.expected.audioSource === undefined ||
            (isAudioSourceStateSnapshot(action.payload.expected.audioSource) &&
                audioSourceStateMatches(located.clip, action.payload.expected.audioSource))) &&
        (action.payload.expected.takeSources === undefined ||
            (Array.isArray(action.payload.expected.takeSources) &&
                takeSourceDepthsMatch(action.payload.clipId, action.payload.expected.takeSources))) &&
        expectedMoveStateMatches(action, projected)
    );
}

function expectedMoveStateMatches(action: RestoreClipPlacementAction, projected: ProjectedClipState): boolean {
    if (projected.touchedByPriorSibling) {
        return clipAutomationMoveStateMatches(
            action.payload.clipId,
            action.payload.expected.automationLanes,
            projected.clipScopedLanes
        );
    }
    return clipAutomationMoveStateMatches(action.payload.clipId, action.payload.expected.automationLanes);
}

export const handleRestoreClipPlacement = createHandler<'restoreClipPlacement'>({
    validateSessionActionArguments: isRestoreClipPlacementSessionPayload,
    // `expected` is mandatory on this payload (unlike optional replay guards elsewhere), so
    // every instance of this action carries a real precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: expectedPlacementMatchesProjected,
    execute: (action) => {
        if (!expectedPlacementMatches(action)) {
            return { status: 'conflict' };
        }
        // `historicalPlacement`: `replacement` names where the clip sat before
        // the move being undone — a placement the document itself held, which
        // the placement rule may not have allowed (a project saved before the
        // rule can hold an audio clip on a MIDI track). Replay must return the
        // clip there, or the undo head is retained and every later Cmd+Z
        // re-fails on it.
        if (
            action.payload.replacement.audioSource !== undefined &&
            !isAudioSourceStateSnapshot(action.payload.replacement.audioSource)
        ) {
            return { status: 'conflict' };
        }
        const moveOptions: NonNullable<Parameters<typeof moveClip>[5]> = {
            historicalPlacement: true,
            historicalEndBeat: action.payload.replacement.endBeat,
        };
        if (action.payload.replacement.audioSource) {
            moveOptions.historicalAudioSource = action.payload.replacement.audioSource;
        }
        if (action.payload.replacement.takeSources !== undefined) {
            if (!Array.isArray(action.payload.replacement.takeSources)) {
                return { status: 'conflict' };
            }
            moveOptions.historicalTakeSources = action.payload.replacement.takeSources;
        }
        const moved = moveClip(
            action.payload.clipId,
            action.payload.replacement.trackId,
            action.payload.replacement.startBeat,
            undefined,
            false,
            moveOptions
        );
        if (
            !moved ||
            !restoreClipAutomationMoveState(action.payload.clipId, action.payload.replacement.automationLanes)
        ) {
            return { status: 'conflict' };
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip placement', inverseAction: null }),
    isNoop: (action) => {
        const current = readPlacement(action.payload.clipId);
        return current
            ? placementsMatch(
                  { ...current, automationLanes: [] },
                  { ...action.payload.replacement, automationLanes: [] }
              ) &&
                  current.sourceMatches(action.payload.replacement) &&
                  (action.payload.replacement.takeSources === undefined ||
                      (Array.isArray(action.payload.replacement.takeSources) &&
                          takeSourceDepthsMatch(action.payload.clipId, action.payload.replacement.takeSources))) &&
                  clipAutomationMoveStateMatches(action.payload.clipId, action.payload.replacement.automationLanes)
            : false;
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
