import { createHandler } from '#/utils/createHandler';

import { moveSection } from '../../useCases/marker/sectionOperations/moveSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleMoveSection = createHandler<'moveSection'>({
    execute: (action) => {
        moveSection(action.payload.sectionId, action.payload.startBeat);
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        if (!prev) {
            return { label: 'Move section', inverseAction: null };
        }
        return {
            // `moveSection` keeps the duration, so restoring the prior start
            // restores the whole section.
            label: `Move section "${prev.name}" (${prev.id}) from beat ${String(prev.startBeat)} to beat ${String(action.payload.startBeat)}`,
            inverseAction: { type: 'moveSection', payload: { sectionId: prev.id, startBeat: prev.startBeat } },
        };
    },
    undoable: true,
});
