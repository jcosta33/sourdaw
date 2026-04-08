import { inject } from '#/infra/di/inject';
import { type ActionHandler } from '#/modules/Command/useCases/commandQueries';
import { toggleUndoTree } from '#/modules/Command/useCases/undoTree/toggleUndoTree';
import { setNodeLabel } from '#/modules/Command/useCases/undoTree/branchOperations';

export const executeToggleUndoTree = inject({ toggleUndoTree })(
    ({ toggleUndoTree }) =>
        async function executeToggleUndoTree(): Promise<void> {
            toggleUndoTree();
        }
);

export const executeLabelUndoBranch = inject({ setNodeLabel })(
    ({ setNodeLabel }) =>
        async function executeLabelUndoBranch(a: { payload: { nodeId: string; label: string } }): Promise<void> {
            setNodeLabel(a.payload.nodeId, a.payload.label);
        }
);

export const undoTreeHandlers: Record<string, ActionHandler<any>> = {
    toggleUndoTree: {
        execute: executeToggleUndoTree,
        undoable: false,
        describe: () => ({ label: 'Toggle Undo Tree' }),
    },
    labelUndoBranch: {
        execute: executeLabelUndoBranch,
        undoable: false,
        describe: () => ({ label: 'Label Undo Branch' }),
    },
};
