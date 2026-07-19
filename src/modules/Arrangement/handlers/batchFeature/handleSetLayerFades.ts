import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerFades } from '../../useCases/adjustmentLayer/setLayerFades';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleSetLayerFades = createHandler<'setLayerFades'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            mutation: () => {
                setLayerFades(a.payload.regionId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Fades',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
