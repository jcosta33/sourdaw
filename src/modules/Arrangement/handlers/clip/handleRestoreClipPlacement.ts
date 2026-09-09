import { clipAutomationMoveStateMatches, restoreClipAutomationMoveState } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ClipMoveActionSnapshot, type HandlerValidationContext } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { projectClipThroughPriorBatchActions, type ProjectedClipState } from '../projectClipThroughPriorBatchActions';

function placementsMatch(left: ClipMoveActionSnapshot, right: ClipMoveActionSnapshot): boolean {
    return (
        left.trackId === right.trackId &&
        Object.is(left.startBeat, right.startBeat) &&
        Object.is(left.endBeat, right.endBeat)
    );
}

function readPlacement(clipId: string): Omit<ClipMoveActionSnapshot, 'automationLanes'> | null {
    const track = getTrackStoreState()?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    return track && clip ? { trackId: track.id, startBeat: clip.startBeat, endBeat: clip.endBeat } : null;
}

type RestoreClipPlacementAction = Extract<AppAction, { type: 'restoreClipPlacement' }>;

/** Same expected-placement match `execute` writes against, reused by `validate` so a batch
 *  preflight rejects a diverged placement instead of executing into a silent overwrite. */
function expectedPlacementMatches(action: RestoreClipPlacementAction): boolean {
    const current = readPlacement(action.payload.clipId);
    return (
        current !== null &&
        placementsMatch({ ...current, automationLanes: [] }, { ...action.payload.expected, automationLanes: [] }) &&
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
    return placementMatches && expectedMoveStateMatches(action, projected);
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
    // `expected` is mandatory on this payload (unlike optional replay guards elsewhere), so
    // every instance of this action carries a real precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: expectedPlacementMatchesProjected,
    execute: (action) => {
        if (!expectedPlacementMatches(action)) {
            return { status: 'conflict' };
        }
        const moved = moveClip(
            action.payload.clipId,
            action.payload.replacement.trackId,
            action.payload.replacement.startBeat,
            undefined,
            false
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
              ) && clipAutomationMoveStateMatches(action.payload.clipId, action.payload.replacement.automationLanes)
            : false;
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: false,
});
