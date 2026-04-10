import { createHandler } from '#/helpers/createHandler';
import { setNodeLabel } from '../../useCases/undoTree/branchOperations';

export const handleLabelUndoBranch = createHandler<'labelUndoBranch'>({
    execute: (a) => {
        setNodeLabel(a.payload.nodeId, a.payload.label);
    },
    describe: () => ({ label: 'Label Undo Branch' }),
    undoable: false,
});
