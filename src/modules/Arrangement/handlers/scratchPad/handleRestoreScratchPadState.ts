import { createHandler } from '#/utils/createHandler';
import { valuesEqual } from '#/utils/structuralEquality';

import { markerStore } from '../../stores/markerStore';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { setScratchPadSections } from '../../useCases/scratchPad/setScratchPadSections';

import { isRestorableMarkerSections, isRestorableScratchPadSections } from './isRestorableSectionCollection';

// Guards the marker sections by id sequence only, not deep equality: a restore that
// writes markers (a commit's undo or redo) must refuse when a section was added, removed
// or reordered since capture, but a field edit to a marker section is tolerated there.
// The pad is guarded by deep equality instead (see `execute`), since every producer's
// `expectedSections` is a clone of the live pad store, which carries no derived fields.
//
// The length equality comes first for a reason. `Array.every` is vacuously true on an
// empty array, so without it an empty `expected` would admit any live state; with it,
// an empty `expected` matches only an empty live collection. That case is real rather
// than a sentinel — a null store is refused separately below — and it is exactly what
// redoing the creation of the first section carries, so refusing it outright would make
// that redo permanently impossible.
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
        // A restore whose marker snapshots are equal never writes markers, so it has no
        // reason to guard them either: markers edited since the capture stay as they are.
        const writesMarkers = !valuesEqual(expectedMarkerSections, replacementMarkerSections);
        const liveMarkerSectionIds = markerState.sections.map((section) => section.id);
        if (
            !valuesEqual(padState.sections, expectedSections) ||
            (writesMarkers && !idSequenceMatches(liveMarkerSectionIds, expectedMarkerSections)) ||
            !isRestorableScratchPadSections(replacementSections) ||
            !isRestorableMarkerSections(replacementMarkerSections)
        ) {
            return { status: 'conflict' };
        }
        // The pad is written whole, so it must be exactly the pad the command left: any
        // later edit to it, even one that keeps the ids, would be erased by this write.
        // Both collections were diverged from the same forward command, so both writes
        // land together or neither does — never partially apply.
        setScratchPadSections(replacementSections);
        if (writesMarkers) {
            markerStore.set({ ...markerState, sections: replacementMarkerSections });
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore scratch pad state', inverseAction: null }),
    isNoop: (action) => {
        const padState = scratchPadStore.value;
        const markerState = markerStore.value;
        if (!padState || !markerState) {
            return false;
        }
        // Deep compare: a rename or recolour inverse keeps the id sequence, so comparing ids
        // alone would call it a no-op and skip the write.
        return (
            valuesEqual(padState.sections, action.payload.replacementSections) &&
            valuesEqual(markerState.sections, action.payload.replacementMarkerSections)
        );
    },
    undoable: false,
});
