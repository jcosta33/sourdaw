import { inject } from '#/infra/di/inject';
import { clearScratchPad, captureArrangementToScratchPad, commitScratchPadToArrangement } from '#/modules/Arrangement';
import { workspaceStore } from '../stores/workspaceStore';

type ScratchPadActionResult = {
    label: string;
};

type ScratchPadHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ScratchPadActionResult;
    undoable: boolean;
};

type ScratchPadAction =
    | { type: 'toggleScratchPad'; payload?: undefined }
    | { type: 'captureScratchPad'; payload?: undefined }
    | { type: 'commitScratchPad'; payload?: undefined }
    | { type: 'clearScratchPad'; payload?: undefined };

type ScratchPadActionOf<ActionType extends ScratchPadAction['type']> = Extract<ScratchPadAction, { type: ActionType }>;

type ScratchPadHandlers = {
    toggleScratchPad: ScratchPadHandler<ScratchPadActionOf<'toggleScratchPad'>>;
    captureScratchPad: ScratchPadHandler<ScratchPadActionOf<'captureScratchPad'>>;
    commitScratchPad: ScratchPadHandler<ScratchPadActionOf<'commitScratchPad'>>;
    clearScratchPad: ScratchPadHandler<ScratchPadActionOf<'clearScratchPad'>>;
};

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

export const scratchPadHandlers: ScratchPadHandlers = {
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
