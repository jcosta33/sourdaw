import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command';
import { clearScratchPad, captureArrangementToScratchPad, commitScratchPadToArrangement } from '#/modules/Arrangement';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';

export const executeToggleScratchPad = inject({})(() => async function executeToggleScratchPad(): Promise<void> {
    const state = workspaceStore.value;
    if (state) {
        workspaceStore.set({ ...state, scratchPadOpen: !state.scratchPadOpen });
    }
});

export const executeCaptureScratchPad = inject({ captureArrangementToScratchPad })(
    ({ captureArrangementToScratchPad }) =>
        async function executeCaptureScratchPad(): Promise<void> {
            captureArrangementToScratchPad();
            // Also open the scratch pad if it's closed
            const state = workspaceStore.value;
            if (state && !state.scratchPadOpen) {
                workspaceStore.set({ ...state, scratchPadOpen: true });
            }
        }
);

export const executeCommitScratchPad = inject({ commitScratchPadToArrangement })(
    ({ commitScratchPadToArrangement }) =>
        async function executeCommitScratchPad(): Promise<void> {
            commitScratchPadToArrangement();
        }
);

export const executeClearScratchPad = inject({ clearScratchPad })(
    ({ clearScratchPad }) =>
        async function executeClearScratchPad(): Promise<void> {
            clearScratchPad();
        }
);

export const scratchPadHandlers: Record<string, ActionHandler<any>> = {
    toggleScratchPad: {
        execute: executeToggleScratchPad,
        undoable: false,
        describe: () => ({ label: 'Toggle Scratch Pad' }),
    },
    captureScratchPad: {
        execute: executeCaptureScratchPad,
        undoable: true,
        describe: () => ({ label: 'Capture Arrangement to Scratch Pad' }),
    },
    commitScratchPad: {
        execute: executeCommitScratchPad,
        undoable: true,
        describe: () => ({ label: 'Apply Scratch Pad to Arrangement' }),
    },
    clearScratchPad: {
        execute: executeClearScratchPad,
        undoable: true,
        describe: () => ({ label: 'Clear Scratch Pad' }),
    },
};
