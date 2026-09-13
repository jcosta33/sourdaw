import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerSessionActionEntry, type HandlerValidationContext } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { compRegionInterval } from '../../useCases/comping/compRegionInterval';
import { takeLaneSelection } from '../../useCases/comping/takeLaneSelection';

type SelectTakeAction = Extract<AppAction, { type: 'selectTake' }>;

function resolveSelection(action: SelectTakeAction, context?: HandlerValidationContext) {
    const state = takeLaneStore.value;
    if (!state) {
        return null;
    }
    const projected = context
        ? compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(state, context)
        : state;
    return projected ? takeLaneSelection.resolve(projected, action) : null;
}

function isSelectTakeAction(action: AppAction | null | undefined): action is SelectTakeAction {
    return action?.type === 'selectTake';
}

function isSelectTakeSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        !isSelectTakeAction(entry.action) ||
        !isSelectTakeAction(entry.inverseAction) ||
        !isSelectTakeAction(entry.redoAction)
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    if (action.takeId === null || inverse.expectedLaneId === undefined || redo.expectedLaneId === undefined) {
        return false;
    }
    return (
        inverse.trackId === action.trackId &&
        redo.trackId === action.trackId &&
        inverse.expectedLaneId === redo.expectedLaneId &&
        (action.expectedLaneId === undefined || action.expectedLaneId === inverse.expectedLaneId) &&
        inverse.expectedSelectedTakeId === action.takeId &&
        redo.takeId === action.takeId &&
        redo.expectedSelectedTakeId === inverse.takeId &&
        (action.expectedSelectedTakeId === undefined || action.expectedSelectedTakeId === inverse.takeId)
    );
}

export const handleSelectTake = createHandler<'selectTake'>({
    // Conflicts when the lane's live selection no longer matches
    // `expectedSelectedTakeId`, or the lane or take vanished. Proven by the
    // `canReportConflict` registry honesty spec; undo step-over (#2881)
    // relies on it.
    canReportConflict: true,
    validate: (action, context) => resolveSelection(action, context) !== null,
    execute: (action) => {
        const state = takeLaneStore.value;
        const selected = state ? takeLaneSelection.apply(state, action) : null;
        if (!selected) {
            return { status: 'conflict' };
        }
        takeLaneStore.set(selected);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const selection = resolveSelection(action);
        return selection !== null && selection.selectedTakeId === action.payload.takeId;
    },
    describe: (action, context) => {
        const selection = resolveSelection(action, context);
        if (!selection) {
            return { label: 'Select take', inverseAction: null };
        }
        const previousTakeId = selection.selectedTakeId;
        if (previousTakeId === action.payload.takeId) {
            return { label: 'Select take', inverseAction: null };
        }
        return {
            label: 'Select take',
            inverseAction: {
                type: 'selectTake',
                payload: {
                    trackId: action.payload.trackId,
                    takeId: previousTakeId,
                    expectedLaneId: selection.lane.id,
                    expectedSelectedTakeId: action.payload.takeId,
                },
            },
            // Redo runs against the post-undo state, whose selection is exactly
            // the pre-execution selection read here.
            redoAction: {
                type: 'selectTake',
                payload: {
                    trackId: action.payload.trackId,
                    takeId: action.payload.takeId,
                    expectedLaneId: selection.lane.id,
                    expectedSelectedTakeId: previousTakeId,
                },
            },
        };
    },
    validateSessionEntry: isSelectTakeSessionEntry,
    undoable: true,
});
