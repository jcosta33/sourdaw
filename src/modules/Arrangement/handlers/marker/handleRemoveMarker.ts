import { createHandler } from '#/utils/createHandler';

import { readListRestoreSlot } from '../../models/ListRestoreSlot';
import { removeMarker } from '../../useCases/marker/markerOperations/removeMarker';
import { getMarkerState } from '../../useCases/timelineQueries';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (action) => toHandlerExecutionResult(removeMarker(action.payload.markerId)),
    describe: (action) => {
        const markers = getMarkerState()?.markers ?? [];
        const index = markers.findIndex((message) => message.id === action.payload.markerId);
        const prev = markers[index];
        return {
            label: prev ? `Remove marker "${prev.name}" at beat ${String(prev.beat)} (${prev.id})` : 'Remove marker',
            // Undo restores the exact marker — same id, beat, name, color, and place between its neighbours.
            inverseAction: prev
                ? {
                      type: 'addMarker',
                      payload: {
                          beat: prev.beat,
                          name: prev.name,
                          markerId: prev.id,
                          color: prev.color,
                          ...readListRestoreSlot(markers, index),
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
