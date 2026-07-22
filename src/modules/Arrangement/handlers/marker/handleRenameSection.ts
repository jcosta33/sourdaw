import { createHandler } from '#/utils/createHandler';

import { renameSection } from '../../useCases/marker/sectionOperations/renameSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleRenameSection = createHandler<'renameSection'>({
    execute: (action) => {
        renameSection(action.payload.sectionId, action.payload.name);
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        return {
            label: `Rename section to "${action.payload.name}"`,
            inverseAction: prev ? { type: 'renameSection', payload: { sectionId: prev.id, name: prev.name } } : null,
        };
    },
    undoable: true,
});
