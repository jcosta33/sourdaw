import { clipAutomationMoveStateMatches, restoreClipAutomationMoveState } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ClipMoveActionSnapshot } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

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

export const handleRestoreClipPlacement = createHandler<'restoreClipPlacement'>({
    // `expected` is mandatory on this payload (unlike optional replay guards elsewhere), so
    // every instance of this action carries a real precondition `validate` re-checks.
    canReapplyAfterDivergence: () => true,
    validate: expectedPlacementMatches,
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
