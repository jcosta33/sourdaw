import { createHandler } from '#/utils/createHandler';

import { type ListRestoreSlot, isValidListRestoreSlot } from '../../models/ListRestoreSlot';
import { addMarker } from '../../useCases/marker/markerOperations/addMarker';
import { getMarkerState } from '../../useCases/timelineQueries';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddMarkerAction = { payload: { beat: number; name: string; markerId?: string; color?: string } & ListRestoreSlot };

// Mirror of handleDuplicateClip's ensureTargetClipId: the inverse needs the
// new marker's id before execute runs, so describe mints it onto the payload
// and execute reuses it (describe always runs before execute).
function ensureMarkerId(action: AddMarkerAction): string {
    if (action.payload.markerId) {
        return action.payload.markerId;
    }
    const markerId = `marker-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.markerId = markerId;
    return markerId;
}

const MALFORMED_SLOT_REASON = 'Marker slot must be a non-negative integer index with string neighbour ids.';

export const handleAddMarker = createHandler<'addMarker'>({
    // Singleton keeps addMarker out of multi-action batches, as it was before it gained a validator.
    batchExecution: 'singleton',
    validate: (action) => isValidListRestoreSlot(action.payload),
    execute: (action) => {
        // executeAppAction (undo/redo replay included) never calls validate, so execute enforces the same rule.
        if (!isValidListRestoreSlot(action.payload)) {
            return { status: 'conflict', reason: MALFORMED_SLOT_REASON };
        }
        return toHandlerExecutionResult(
            addMarker(action.payload.beat, action.payload.name, ensureMarkerId(action), action.payload.color, {
                index: action.payload.index,
                beforeId: action.payload.beforeId,
                afterId: action.payload.afterId,
            })
        );
    },
    describe: (action) => ({
        label: `Add marker "${action.payload.name}"`,
        inverseAction: { type: 'removeMarker', payload: { markerId: ensureMarkerId(action) } },
    }),
    isNoop: (action) =>
        action.payload.markerId !== undefined &&
        getMarkerState()?.markers.some((marker) => marker.id === action.payload.markerId) === true,
    undoable: true,
});
