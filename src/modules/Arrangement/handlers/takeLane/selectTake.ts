import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { getTakeLaneForTrack } from '../../useCases/comping/getTakeLaneForTrack';

/** The take a lane's `selected` flags currently name, or `null` when none does. */
function getSelectedTakeId(lane: TakeLane): string | null {
    return lane.takes.find((take) => take.selected)?.id ?? null;
}

/**
 * The lane's selection as the batch's preceding actions leave it. Only
 * `selectTake` writes take `selected` flags, so a prior sibling of the same
 * type on the same lane is the only live-read staleness a preflight can miss.
 */
function getPlannedSelectedTakeId(lane: TakeLane, context: HandlerValidationContext): string | null {
    let selectedTakeId = getSelectedTakeId(lane);
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'selectTake' && action.payload.trackId === lane.trackId) {
            selectedTakeId = action.payload.takeId;
        }
    }
    return selectedTakeId;
}

/**
 * `undefined` carries no assertion — fresh user intent may select over any
 * current state. `null` expects an empty selection; a string expects itself.
 */
function selectionMatchesExpected(
    expectedSelectedTakeId: string | null | undefined,
    selectedTakeId: string | null
): boolean {
    return expectedSelectedTakeId === undefined || expectedSelectedTakeId === selectedTakeId;
}

function laneHasTake(lane: TakeLane, takeId: string): boolean {
    return lane.takes.some((take) => take.id === takeId);
}

/** Flips only the `selected` flags that change, keeping every other take of the
 *  lane and every other lane of the store untouched — by reference where
 *  unchanged — so undo replays this same lane-scoped shape. */
function withSelectedTake(lane: TakeLane, takeId: string): TakeLane {
    return {
        ...lane,
        takes: lane.takes.map((take) => {
            const shouldBeSelected = take.id === takeId;
            return take.selected === shouldBeSelected ? take : { ...take, selected: shouldBeSelected };
        }),
    };
}

export const handleSelectTake = createHandler<'selectTake'>({
    // Conflicts when the lane's live selection no longer matches
    // `expectedSelectedTakeId`, or the lane or take vanished. Proven by the
    // `canReportConflict` registry honesty spec; undo step-over (#2881)
    // relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const lane = getTakeLaneForTrack(action.payload.trackId);
        if (!lane || !laneHasTake(lane, action.payload.takeId)) {
            return false;
        }
        return selectionMatchesExpected(action.payload.expectedSelectedTakeId, getPlannedSelectedTakeId(lane, context));
    },
    execute: (action) => {
        const state = takeLaneStore.value;
        const lane = state?.lanes.find((candidate) => candidate.trackId === action.payload.trackId);
        if (!state || !lane || !laneHasTake(lane, action.payload.takeId)) {
            return { status: 'conflict' };
        }
        if (!selectionMatchesExpected(action.payload.expectedSelectedTakeId, getSelectedTakeId(lane))) {
            return { status: 'conflict' };
        }
        takeLaneStore.set({
            lanes: state.lanes.map((candidate) =>
                candidate.trackId === action.payload.trackId
                    ? withSelectedTake(candidate, action.payload.takeId)
                    : candidate
            ),
        });
        return { status: 'written' };
    },
    isNoop: (action) => {
        const lane = getTakeLaneForTrack(action.payload.trackId);
        if (!lane) {
            return false;
        }
        const selectedTakeId = getSelectedTakeId(lane);
        return (
            selectionMatchesExpected(action.payload.expectedSelectedTakeId, selectedTakeId) &&
            selectedTakeId === action.payload.takeId
        );
    },
    describe: (action) => {
        const lane = getTakeLaneForTrack(action.payload.trackId);
        const previousTakeId = lane === null ? null : getSelectedTakeId(lane);
        return {
            label: 'Select take',
            // Restores only the prior selection; `null` when nothing was
            // selected before (there is no "select nothing" action) or when the
            // request selected the already-selected take.
            inverseAction:
                previousTakeId === null || previousTakeId === action.payload.takeId
                    ? null
                    : {
                          type: 'selectTake',
                          payload: {
                              trackId: action.payload.trackId,
                              takeId: previousTakeId,
                              expectedSelectedTakeId: action.payload.takeId,
                          },
                      },
            // Redo runs against the post-undo state, whose selection is exactly
            // the pre-execution selection read here.
            redoAction: lane
                ? {
                      type: 'selectTake',
                      payload: {
                          trackId: action.payload.trackId,
                          takeId: action.payload.takeId,
                          expectedSelectedTakeId: previousTakeId,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
