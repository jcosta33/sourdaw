import { createHandler } from '#/utils/createHandler';

import { reorderSection } from '../../useCases/marker/sectionOperations/reorderSection';
import { getMarkerState } from '../../useCases/timelineQueries';

export const handleReorderSection = createHandler<'reorderSection'>({
    execute: (action) => {
        reorderSection(action.payload.sectionId, action.payload.direction);
        return undefined;
    },
    describe: (action) => {
        const sections = getMarkerState()?.sections ?? [];
        const index = sections.findIndex((state) => state.id === action.payload.sectionId);
        const targetIndex = action.payload.direction === 'left' ? index - 1 : index + 1;
        const current = sections[index];
        const neighbor = sections[targetIndex];
        if (!current || !neighbor) {
            return { label: 'Reorder section', inverseAction: null };
        }
        // The reorder rewrites the beats of BOTH swapped sections, swaps their
        // list positions, and packs any gap between them away, so the exact
        // inverse snapshots both sections' full pre-reorder spans and slots —
        // contiguous or not. The opposite-direction reorder would lose the gap.
        return {
            label: `Move section "${current.name}" (${current.id}) ${action.payload.direction}`,
            inverseAction: {
                type: 'restoreSectionBeats',
                payload: {
                    sections: [
                        {
                            sectionId: current.id,
                            startBeat: current.startBeat,
                            endBeat: current.endBeat,
                            index,
                        },
                        {
                            sectionId: neighbor.id,
                            startBeat: neighbor.startBeat,
                            endBeat: neighbor.endBeat,
                            index: targetIndex,
                        },
                    ],
                },
            },
        };
    },
    undoable: true,
});
