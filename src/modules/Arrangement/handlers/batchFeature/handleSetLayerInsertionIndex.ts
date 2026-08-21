import { createHandler } from '#/utils/createHandler';

import { setLayerInsertionIndex } from '../../useCases/adjustmentLayer/setLayerInsertionIndex';

export const handleSetLayerInsertionIndex = createHandler<'setLayerInsertionIndex'>({
    execute: (a) => {
        setLayerInsertionIndex(a.payload.layerId, a.payload.insertionIndex);
    },
    describe: () => ({ label: 'Set Layer Insertion Index' }),
    undoable: false,
});
