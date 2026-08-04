import { createHandler } from '#/utils/createHandler';

import { addMarker } from '../../useCases/marker/markerOperations/addMarker';
import { getMarkerState } from '../../useCases/timelineQueries';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddMarkerAction = { payload: { beat: number; name: string; markerId?: string; color?: string } };

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

export const handleAddMarker = createHandler<'addMarker'>({
    execute: (action) => {
        return toHandlerExecutionResult(
            addMarker(action.payload.beat, action.payload.name, ensureMarkerId(action), action.payload.color)
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
