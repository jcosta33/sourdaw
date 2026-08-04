import { createHandler } from '#/utils/createHandler';

import { removeSection } from '../../useCases/marker/sectionOperations/removeSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (action) => {
        const changed = removeSection(action.payload.sectionId);
        if (!changed) {
            return { status: 'no-write' };
        }
        return undefined;
    },
    describe: (action) => {
        const prev = getMarkerState()?.sections.find((state) => state.id === action.payload.sectionId);
        let label = 'Remove section';
        if (prev) {
            label = `Remove section "${prev.name}" from beat ${String(prev.startBeat)} to beat ${String(prev.endBeat)} (${prev.id})`;
        }
        return {
            label,
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
