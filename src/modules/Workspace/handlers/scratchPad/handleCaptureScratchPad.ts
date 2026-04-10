import { createHandler } from '#/helpers/createHandler';
import { captureArrangementToScratchPad } from '#/modules/Arrangement';
import { workspaceStore } from '../../stores/workspaceStore';

export const handleCaptureScratchPad = createHandler<'captureScratchPad'>({
    execute: () => {
        captureArrangementToScratchPad();
        // Also open the scratch pad if it's closed
        const state = workspaceStore.value;
        if (state && !state.scratchPadOpen) {
            workspaceStore.set({ ...state, scratchPadOpen: true });
        }
    },
    describe: () => ({ label: 'Capture Arrangement to Scratch Pad' }),
    undoable: true,
});
