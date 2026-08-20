import { createHandler } from '#/utils/createHandler';

import { setLayerMix } from '../../useCases/adjustmentLayer/setLayerMix';

export const handleSetLayerMix = createHandler<'setLayerMix'>({
    execute: (a) => {
        setLayerMix(a.payload.layerId, a.payload.mix);
    },
    describe: () => ({ label: 'Set Layer Mix' }),
    undoable: false,
});
