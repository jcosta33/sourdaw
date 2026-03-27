import { type ActionHandler } from '../models/ActionHandler';
import { toggleUndoTree } from '../useCases/undoTree/toggleUndoTree';
import { setNodeLabel } from '../useCases/undoTree/branchOperations';

export const undoTreeHandlers: Record<string, ActionHandler<any>> = {
    toggleUndoTree: {
        execute: async () => {
            toggleUndoTree();
        },
        undoable: false,
        describe: () => ({ label: 'Toggle Undo Tree' }),
    },
    labelUndoBranch: {
        execute: async (a: { payload: { nodeId: string; label: string } }) => {
            setNodeLabel(a.payload.nodeId, a.payload.label);
        },
        undoable: false,
        describe: () => ({ label: 'Label Undo Branch' }),
    },
};
