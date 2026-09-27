import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { type RippleMovePlan } from '../../useCases/rippleMove/planRippleMove';
import { planRippleMove } from '../../useCases/rippleMove/planRippleMove';
import { rippleMoveClip } from '../../useCases/rippleMove/rippleMoveClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';
import { isMoveClipsSessionEntry } from '../validateCreationSessionEntries';

type MoveClipsAction = Extract<AppAction, { type: 'moveClips' }>;
type RestoreClipMovesAction = Extract<AppAction, { type: 'restoreClipMoves' }>;
type ClipMoveTarget = MoveClipsAction['payload']['moves'][number];

/** Where a previewed clip sat before the gesture — the store truth the drag preview never wrote. */
type MoveOrigin = {
    clipId: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
};

type MoveClipsState = {
    origins: Map<string, MoveOrigin>;
    recordedRipplePlans: RippleMovePlan[];
    restoredClips: ClipMoveTarget[];
};

type PendingMoveClipsDescription = {
    label: string;
    inverseAction: RestoreClipMovesAction | null;
};

const moveClipsStates = new WeakMap<object, MoveClipsState>();
const pendingDescriptions = new WeakMap<object, PendingMoveClipsDescription>();

function getMoveClipsState(action: MoveClipsAction): MoveClipsState {
    const existing = moveClipsStates.get(action);
    if (existing) {
        return existing;
    }
    const origins = new Map<string, MoveOrigin>();
    for (const candidate of getTrackStoreState()?.tracks ?? []) {
        for (const clip of candidate.clips) {
            origins.set(clip.id, {
                clipId: clip.id,
                trackId: candidate.id,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            });
        }
    }
    const state: MoveClipsState = { origins, recordedRipplePlans: [], restoredClips: [] };
    moveClipsStates.set(action, state);
    return state;
}

/**
 * First-wins merge across every clip's plan: plans were computed sequentially
 * with each ripple move applied before the next planRippleMove, so the FIRST
 * plan mentioning a clip holds its true pre-gesture position; a later plan
 * records an already-shifted position.
 */
function mergedNeighborShifts(state: MoveClipsState) {
    const shiftMap = new Map<string, { clipId: string; origStartBeat: number; origEndBeat: number }>();
    for (const plan of state.recordedRipplePlans) {
        for (const shifted of [...plan.gapClosedClips, ...plan.destinationOpenedClips]) {
            if (!shiftMap.has(shifted.clipId)) {
                shiftMap.set(shifted.clipId, shifted);
            }
        }
    }
    return [...shiftMap.values()];
}

function finalizeDescription(action: MoveClipsAction, state: MoveClipsState): void {
    const pending = pendingDescriptions.get(action);
    if (!pending) {
        return;
    }
    if (state.restoredClips.length === 0) {
        pending.inverseAction = null;
        return;
    }
    pending.inverseAction = {
        type: 'restoreClipMoves',
        payload: {
            movedClips: state.restoredClips.map((restored) => ({ ...restored })),
            neighborShifts: mergedNeighborShifts(state),
        },
    };
}

/**
 * Runs one same-track ripple move and records its plan and pre-gesture origin
 * when it lands. Returns whether the ripple leg handled the target: a missing
 * clip or an unavailable plan leaves the move to the plain path below, while a
 * REFUSED move is handled and records nothing — its plan describes shifts
 * around a move that never happened, so no neighbor may move and no inverse
 * entry may claim it.
 */
function runRippleMove(
    state: MoveClipsState,
    restored: ClipMoveTarget[],
    target: ClipMoveTarget,
    origin: MoveOrigin
): boolean {
    // The callback's `if (clip)` guard: read the clip from the live store
    // before planning. A clip the memoized origin remembers but the store no
    // longer holds (replay or redo after a later delete) must skip the ripple
    // entirely — shifting neighbors around a move that never landed would
    // corrupt the timeline.
    const clip = getTrackStoreState()
        ?.tracks.find((candidate) => candidate.id === target.trackId)
        ?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip) {
        return false;
    }
    const duration = clip.endBeat - clip.startBeat;
    const plan = planRippleMove({
        trackId: target.trackId,
        clipId: target.clipId,
        oldStartBeat: origin.startBeat,
        newStartBeat: target.startBeat,
        clipDuration: duration,
    });
    if (!plan) {
        return false;
    }
    // A no-op is not a refusal: the clip already sits at its target (an
    // earlier plan of this gesture put it there), so its plan is vacuous but
    // its inverse must exist — record exactly as a landed move, without
    // calling rippleMoveClip.
    if (Object.is(clip.startBeat, target.startBeat)) {
        state.recordedRipplePlans.push(plan);
        restored.push({ clipId: target.clipId, trackId: origin.trackId, startBeat: origin.startBeat });
        return true;
    }
    if (
        rippleMoveClip({
            trackId: target.trackId,
            clipId: target.clipId,
            newStartBeat: target.startBeat,
            clipDuration: duration,
            plan,
        })
    ) {
        state.recordedRipplePlans.push(plan);
        restored.push({ clipId: target.clipId, trackId: origin.trackId, startBeat: origin.startBeat });
    }
    return true;
}

export const handleMoveClips = createHandler<'moveClips'>({
    execute: (action) => {
        const state = getMoveClipsState(action);
        const restored: ClipMoveTarget[] = [];
        for (const target of action.payload.moves) {
            const origin = state.origins.get(target.clipId);
            // A clip with no pre-gesture placement, and a release in place,
            // commit nothing — the callback loop's skip rules verbatim.
            if (!origin) {
                continue;
            }
            if (origin.trackId === target.trackId && Object.is(origin.startBeat, target.startBeat)) {
                continue;
            }
            if (action.payload.ripple && origin.trackId === target.trackId) {
                if (runRippleMove(state, restored, target, origin)) {
                    continue;
                }
            }
            // The four-arg form keeps the automation delta anchored on the
            // pre-gesture position, exactly as the callback wrote it.
            if (moveClip(target.clipId, target.trackId, target.startBeat, origin.startBeat)) {
                restored.push({ clipId: target.clipId, trackId: origin.trackId, startBeat: origin.startBeat });
            }
        }
        state.restoredClips = restored;
        finalizeDescription(action, state);
        if (restored.length === 0) {
            return toHandlerExecutionResult(false);
        }
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const state = getMoveClipsState(action);
        const effective = action.payload.moves.filter((target) => {
            const origin = state.origins.get(target.clipId);
            if (!origin) {
                return false;
            }
            return origin.trackId !== target.trackId || !Object.is(origin.startBeat, target.startBeat);
        });
        const rippleApplies =
            action.payload.ripple &&
            effective.some((target) => state.origins.get(target.clipId)?.trackId === target.trackId);
        let label: string;
        if (rippleApplies) {
            label = 'Move clip (ripple)';
        } else if (effective.length > 1) {
            label = `Move ${effective.length} clips`;
        } else {
            label = 'Move clip';
        }
        // The real inverse only exists once the sequential writes have run —
        // planning every move up front would shift neighbors differently than
        // the gesture callback did — so `execute` finalizes the placeholder.
        const pending: PendingMoveClipsDescription = {
            label,
            inverseAction: { type: 'restoreClipMoves', payload: { movedClips: [], neighborShifts: [] } },
        };
        pendingDescriptions.set(action, pending);
        return pending;
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionEntry: isMoveClipsSessionEntry,
});
