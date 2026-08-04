import { createHandler } from '#/utils/createHandler';

import { removeMarker } from '../../useCases/marker/markerOperations/removeMarker';
import { getMarkerState } from '../../useCases/timelineQueries';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (action) => toHandlerExecutionResult(removeMarker(action.payload.markerId)),
    describe: (action) => {
        const prev = getMarkerState()?.markers.find((message) => message.id === action.payload.markerId);
        return {
            label: prev ? `Remove marker "${prev.name}" at beat ${String(prev.beat)} (${prev.id})` : 'Remove marker',
            // Undo restores the exact marker — same id, beat, name, and color.
            inverseAction: prev
                ? {
                      type: 'addMarker',
                      payload: { beat: prev.beat, name: prev.name, markerId: prev.id, color: prev.color },
                  }
                : null,
        };
    },
    undoable: true,
});
