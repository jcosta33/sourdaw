import { createHandler } from '#/utils/createHandler';

import { commitAdjustmentLayerMutation } from '../../useCases/adjustmentLayer/commitAdjustmentLayerMutation';
import { setLayerAffectedTracks } from '../../useCases/adjustmentLayer/setLayerAffectedTracks';

import {
    createAdjustmentLayerMutationInverse,
    getAdjustmentLayerMutationId,
} from './createAdjustmentLayerMutationInverse';

export const handleSetLayerAffectedTracks = createHandler<'setLayerAffectedTracks'>({
    execute: (a) => {
        return commitAdjustmentLayerMutation({
            adjustmentMutationId: getAdjustmentLayerMutationId(a),
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
