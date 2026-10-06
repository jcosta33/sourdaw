import { createHandler } from '#/utils/createHandler';

import { moveMarker } from '../../useCases/marker/markerOperations/moveMarker';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleMoveMarker = createHandler<'moveMarker'>({
    execute: (action) => {
        moveMarker(action.payload.markerId, action.payload.beat);
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.markers.find((message) => message.id === action.payload.markerId);
        return {
            label: prev
                ? `Move marker "${prev.name}" (${prev.id}) from beat ${String(prev.beat)} to beat ${String(action.payload.beat)}`
                : 'Move marker',
            inverseAction: prev ? { type: 'moveMarker', payload: { markerId: prev.id, beat: prev.beat } } : null,
        };
    },
    undoable: true,
});
