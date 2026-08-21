import { createHandler } from '#/utils/createHandler';

import { markerStore } from '../../stores/markerStore';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { setScratchPadSections } from '../../useCases/scratchPad/setScratchPadSections';

// Compares by id sequence, not deep equality: fields the store recomputes (e.g. derived
// display state) would spuriously conflict under a deep compare, while an id-sequence
// compare is exactly what detects a section being added, removed, or reordered since capture.
function idSequenceMatches(liveIds: readonly string[], expected: readonly { readonly id: string }[]): boolean {
    return liveIds.length === expected.length && liveIds.every((id, index) => id === expected[index]?.id);
}

export const handleRestoreScratchPadState = createHandler<'restoreScratchPadState'>({
    execute: (action) => {
        const padState = scratchPadStore.value;
        const markerState = markerStore.value;
        if (!padState || !markerState) {
            return { status: 'conflict' };
        }
        const { expectedSections, replacementSections, expectedMarkerSections, replacementMarkerSections } =
            action.payload;
        const liveSectionIds = padState.sections.map((section) => section.id);
        const liveMarkerSectionIds = markerState.sections.map((section) => section.id);
        if (
            !idSequenceMatches(liveSectionIds, expectedSections) ||
            !idSequenceMatches(liveMarkerSectionIds, expectedMarkerSections)
        ) {
            return { status: 'conflict' };
        }
        // Both collections were diverged from the same forward command, so both writes
        // land together or neither does — never partially apply.
        setScratchPadSections(replacementSections as never);
        markerStore.set({ ...markerState, sections: replacementMarkerSections as never });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore scratch pad state', inverseAction: null }),
    isNoop: (action) => {
        const padState = scratchPadStore.value;
        const markerState = markerStore.value;
        if (!padState || !markerState) {
            return false;
        }
        return (
            idSequenceMatches(
                padState.sections.map((section) => section.id),
                action.payload.replacementSections
            ) &&
            idSequenceMatches(
                markerState.sections.map((section) => section.id),
                action.payload.replacementMarkerSections
            )
        );
    },
    undoable: false,
});
