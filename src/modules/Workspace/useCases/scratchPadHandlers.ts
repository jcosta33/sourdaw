import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { clearScratchPad } from '#/modules/Arrangement/useCases/scratchPad/scratchPadCrud';
import {
    captureArrangementToScratchPad,
    commitScratchPadToArrangement,
} from '#/modules/Arrangement/useCases/scratchPad/captureCommit';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

export const scratchPadHandlers: Record<string, ActionHandler<any>> = {
    toggleScratchPad: {
        execute: async () => {
            const state = workspaceStore.value;
            if (state) {
                workspaceStore.set({ ...state, scratchPadOpen: !state.scratchPadOpen });
            }
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Scratch Pad' }),
    },
    captureScratchPad: {
        execute: async () => {
            captureArrangementToScratchPad();
            // Also open the scratch pad if it's closed
            const state = workspaceStore.value;
            if (state && !state.scratchPadOpen) {
                workspaceStore.set({ ...state, scratchPadOpen: true });
            }
        },
        undoable: true,
        describe: () => ({ label: 'Capture Arrangement to Scratch Pad' }),
    },
    commitScratchPad: {
        execute: async () => {
            commitScratchPadToArrangement();
        },
        undoable: true,
        describe: () => ({ label: 'Apply Scratch Pad to Arrangement' }),
    },
    clearScratchPad: {
        execute: async () => {
            clearScratchPad();
        },
        undoable: true,
        describe: () => ({ label: 'Clear Scratch Pad' }),
    },
};
