import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerAffectedTracks } from '../../useCases/adjustmentLayer/setLayerAffectedTracks';

import { createAdjustmentLayerMutationInverse } from './createAdjustmentLayerMutationInverse';

export const handleSetLayerAffectedTracks = createHandler<'setLayerAffectedTracks'>({
    execute: (a) => {
        commitAdjustmentLayerMutation({
            mutation: () => {
                setLayerAffectedTracks(a.payload.layerId, a.payload.trackIds);
            },
        });
    },
    describe: (action) => ({
        label: 'Set Layer Affected Tracks',
        inverseAction: createAdjustmentLayerMutationInverse(action),
    }),
    undoable: true,
});
