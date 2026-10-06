import { createHandler } from '#/utils/createHandler';

import { resizeSection } from '../../useCases/marker/sectionOperations/resizeSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleResizeSection = createHandler<'resizeSection'>({
    execute: (action) => {
        resizeSection(action.payload.sectionId, action.payload.startBeat, action.payload.endBeat);
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        if (!prev) {
            return { label: 'Resize section', inverseAction: null };
        }
        return {
            label: `Resize section "${prev.name}" (${prev.id}) from beats ${String(prev.startBeat)}–${String(prev.endBeat)} to beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`,
            inverseAction: {
                type: 'resizeSection',
                payload: { sectionId: prev.id, startBeat: prev.startBeat, endBeat: prev.endBeat },
            },
        };
    },
    undoable: true,
});
