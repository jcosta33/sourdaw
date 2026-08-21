import { createHandler } from '#/utils/createHandler';

import { markerStore } from '../../stores/markerStore';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { clearScratchPad } from '../../useCases/scratchPad/scratchPadCrud/clearScratchPad';

export const handleClearScratchPad = createHandler<'clearScratchPad'>({
    execute: () => {
        clearScratchPad();
    },
    describe: () => {
        // Capture the live pad here, before `execute()` wipes it — the post-state this
        // command produces is always the empty pad, so it does not need capturing.
        const capturedSections = structuredClone(scratchPadStore.value?.sections ?? []);
        // This command never touches markers. Both sides of the marker guard carry the
        // same live snapshot so the restore still refuses if markers moved out from under
        // it, but writes them back unchanged rather than discarding an unrelated edit.
        const capturedMarkerSections = structuredClone(markerStore.value?.sections ?? []);
        return {
            label: 'Clear Scratch Pad',
            inverseAction: {
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: [],
                    replacementSections: capturedSections,
                    expectedMarkerSections: capturedMarkerSections,
                    replacementMarkerSections: capturedMarkerSections,
                },
            },
            redoAction: {
                type: 'restoreScratchPadState',
                payload: {
                    expectedSections: capturedSections,
                    replacementSections: [],
                    expectedMarkerSections: capturedMarkerSections,
                    replacementMarkerSections: capturedMarkerSections,
                },
            },
        };
    },
    isNoop: () => (scratchPadStore.value?.sections.length ?? 0) === 0,
    undoable: true,
});
