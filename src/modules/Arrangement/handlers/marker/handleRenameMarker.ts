import { createHandler } from '#/utils/createHandler';

import { renameMarker } from '../../useCases/marker/markerOperations/renameMarker';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleRenameMarker = createHandler<'renameMarker'>({
    execute: (action) => {
        renameMarker(action.payload.markerId, action.payload.name);
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.markers.find((message) => message.id === action.payload.markerId);
        if (!prev) {
            return { label: 'Rename marker', inverseAction: null };
        }
        return {
            label: `Rename marker "${prev.name}" at beat ${String(prev.beat)} (${prev.id}) to "${action.payload.name}"`,
            inverseAction: { type: 'renameMarker', payload: { markerId: prev.id, name: prev.name } },
        };
    },
    undoable: true,
});
