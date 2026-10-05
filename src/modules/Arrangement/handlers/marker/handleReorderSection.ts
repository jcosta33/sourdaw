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
        // The reorder rewrites the beats of BOTH swapped sections, so the exact
        // inverse is the opposite-direction reorder only when the pair was
        // contiguous before the move — the same lossy-inverse refusal
        // handleRemoveAutomationPoint documents: with a gap between them the
        // opposite reorder restores the neighbor exactly but repositions the
        // moved section to the packed position, so we omit the inverse rather
        // than emit one that loses the gap.
        let contiguous: boolean;
        if (action.payload.direction === 'left') {
            contiguous = current.startBeat === neighbor.startBeat + (neighbor.endBeat - neighbor.startBeat);
        } else {
            contiguous = neighbor.startBeat === current.startBeat + (current.endBeat - current.startBeat);
        }
        if (!contiguous) {
            return { label: 'Reorder section', inverseAction: null };
        }
        const inverseDirection = action.payload.direction === 'left' ? 'right' : 'left';
        return {
            label: `Move section "${current.name}" (${current.id}) ${action.payload.direction}`,
            inverseAction: { type: 'reorderSection', payload: { sectionId: current.id, direction: inverseDirection } },
        };
    },
    undoable: true,
});
