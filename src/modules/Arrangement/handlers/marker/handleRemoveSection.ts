import { createHandler } from '#/utils/createHandler';

import { removeSection } from '../../useCases/marker/sectionOperations/removeSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (action) => {
        removeSection(action.payload.sectionId);
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        return {
            label: 'Remove section',
            // Undo restores the exact section — same id, range, name, and color.
            inverseAction: prev
                ? {
                      type: 'addSection',
                      payload: {
                          startBeat: prev.startBeat,
                          endBeat: prev.endBeat,
                          name: prev.name,
                          sectionId: prev.id,
                          color: prev.color,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
