import { type AppAction } from '#/utils/handlerContract';

import { type TakeLane } from '../../models/TakeLane';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';

type SelectTakeAction = Extract<AppAction, { type: 'selectTake' }>;

type ResolvedTakeLaneSelection = {
    readonly lane: TakeLane;
    readonly selectedTakeId: string | null;
};

function selectedTakeIdOf(lane: TakeLane): string | null {
    return lane.takes.find((take) => take.selected)?.id ?? null;
}

function resolveTakeLaneSelection(
    state: TakeLaneStoreState,
    action: SelectTakeAction
): ResolvedTakeLaneSelection | null {
    const matchingLanes = state.lanes.filter((lane) => lane.trackId === action.payload.trackId);
    const lane = matchingLanes.length === 1 ? matchingLanes[0] : undefined;
    if (!lane || (action.payload.expectedLaneId !== undefined && action.payload.expectedLaneId !== lane.id)) {
        return null;
    }

    const selectedTakeId = selectedTakeIdOf(lane);
    if (
        action.payload.expectedSelectedTakeId !== undefined &&
        action.payload.expectedSelectedTakeId !== selectedTakeId
    ) {
        return null;
    }
    if (action.payload.takeId === null) {
        if (action.payload.expectedLaneId !== lane.id || action.payload.expectedSelectedTakeId === undefined) {
            return null;
        }
        return { lane, selectedTakeId };
    }
    return lane.takes.some((take) => take.id === action.payload.takeId) ? { lane, selectedTakeId } : null;
}

function applyTakeLaneSelection(state: TakeLaneStoreState, action: SelectTakeAction): TakeLaneStoreState | null {
    const resolved = resolveTakeLaneSelection(state, action);
    if (!resolved) {
        return null;
    }
    return {
        lanes: state.lanes.map((lane) => {
            if (lane.id !== resolved.lane.id || lane.trackId !== action.payload.trackId) {
                return lane;
            }
            return {
                ...lane,
                takes: lane.takes.map((take) => {
                    const selected = take.id === action.payload.takeId;
                    return take.selected === selected ? take : { ...take, selected };
                }),
            };
        }),
    };
}

export const takeLaneSelection = {
    apply: applyTakeLaneSelection,
    resolve: resolveTakeLaneSelection,
};
