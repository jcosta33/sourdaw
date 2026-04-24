import { createHandler } from '#/utils/createHandler';

import { setNodeLabel } from '../../useCases/undoTree/branchOperations/setNodeLabel';

export const handleLabelUndoBranch = createHandler<'labelUndoBranch'>({
    execute: (alpha) => {
        setNodeLabel(alpha.payload.nodeId, alpha.payload.label);
    },
    describe: () => ({ label: 'Label Undo Branch' }),
    undoable: false,
});
