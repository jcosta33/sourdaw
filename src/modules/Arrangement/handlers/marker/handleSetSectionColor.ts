import { createHandler } from '#/utils/createHandler';

import { setSectionColor } from '../../useCases/marker/sectionOperations/setSectionColor';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleSetSectionColor = createHandler<'setSectionColor'>({
    execute: (action) => {
        setSectionColor(action.payload.sectionId, action.payload.color);
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        if (!prev) {
            return { label: 'Set section color', inverseAction: null };
        }
        return {
            label: `Set section "${prev.name}" (${prev.id}) color to ${action.payload.color}`,
            inverseAction: { type: 'setSectionColor', payload: { sectionId: prev.id, color: prev.color } },
        };
    },
    undoable: true,
});
