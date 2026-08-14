import { createHandler } from '#/utils/createHandler';

import { setMarkerColor } from '../../useCases/marker/markerOperations/setMarkerColor';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleSetMarkerColor = createHandler<'setMarkerColor'>({
    canReapplyAfterDivergence: (action) => action.payload.expectedColor !== undefined,
    validate: (action) => {
        const currentColor = getMarkerState()?.markers.find((marker) => marker.id === action.payload.markerId)?.color;
        return action.payload.expectedColor === undefined || currentColor === action.payload.expectedColor;
    },
    execute: (action) => {
        const currentColor = getMarkerState()?.markers.find((marker) => marker.id === action.payload.markerId)?.color;
        if (action.payload.expectedColor !== undefined && currentColor !== action.payload.expectedColor) {
            return { status: 'conflict' };
        }
        if (!setMarkerColor(action.payload.markerId, action.payload.color)) {
            return { status: 'no-write' };
        }
        return undefined;
    },
    describe: (action) => {
        // Re-applying the current color is a forward no-op, so the inverse
        // restores the captured color instead of deriving one.
        const prev = getMarkerState()?.markers.find((message) => message.id === action.payload.markerId);
        return {
            label: prev
                ? `Set marker "${prev.name}" at beat ${String(prev.beat)} (${prev.id}) color to ${action.payload.color}`
                : 'Set marker color',
            inverseAction: prev
                ? {
                      type: 'setMarkerColor',
                      payload: { markerId: prev.id, color: prev.color, expectedColor: action.payload.color },
                  }
                : null,
            redoAction: prev
                ? {
                      type: 'setMarkerColor',
                      payload: { markerId: prev.id, color: action.payload.color, expectedColor: prev.color },
                  }
                : undefined,
        };
    },
    undoable: true,
});
