import { createHandler } from '#/utils/createHandler';

import { renameSection } from '../../useCases/marker/sectionOperations/renameSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleRenameSection = createHandler<'renameSection'>({
    execute: (action) => {
        const changed = renameSection(action.payload.sectionId, action.payload.name);
        if (!changed) {
            return { status: 'no-write' };
        }
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        let label = `Rename section to "${action.payload.name}"`;
        if (prev) {
            label = `Rename section "${prev.name}" to "${action.payload.name}" from beat ${String(prev.startBeat)} to beat ${String(prev.endBeat)} (${prev.id})`;
        }
        return {
            label,
            inverseAction: prev ? { type: 'renameSection', payload: { sectionId: prev.id, name: prev.name } } : null,
        };
    },
    undoable: true,
});
