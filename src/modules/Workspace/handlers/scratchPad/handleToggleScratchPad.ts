import { createHandler } from '#/utils/createHandler';
import { workspaceStore } from '../../stores/workspaceStore';

export const handleToggleScratchPad = createHandler<'toggleScratchPad'>({
    execute: () => {
        const state = workspaceStore.value;
        if (state) {
            workspaceStore.set({ ...state, scratchPadOpen: !state.scratchPadOpen });
        }
    },
    describe: () => ({ label: 'Toggle Scratch Pad' }),
    undoable: false,
});
