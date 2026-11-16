import { createHandler } from '#/utils/createHandler';

import { readListRestoreSlot } from '../../models/ListRestoreSlot';
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
        const sections = getMarkerState()?.sections ?? [];
        const index = sections.findIndex((state) => state.id === action.payload.sectionId);
        const prev = sections[index];
        let label = 'Remove section';
        if (prev) {
            label = `Remove section "${prev.name}" from beat ${String(prev.startBeat)} to beat ${String(prev.endBeat)} (${prev.id})`;
        }
        return {
            label,
            // Undo restores the exact section — same id, range, name, color, and place between its neighbours.
            inverseAction: prev
                ? {
                      type: 'addSection',
                      payload: {
                          startBeat: prev.startBeat,
                          endBeat: prev.endBeat,
                          name: prev.name,
                          sectionId: prev.id,
                          color: prev.color,
                          ...readListRestoreSlot(sections, index),
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
