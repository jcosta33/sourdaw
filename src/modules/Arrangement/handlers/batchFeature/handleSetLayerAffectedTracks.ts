import { createHandler } from '#/utils/createHandler';

import { setLayerAffectedTracks } from '../../useCases/adjustmentLayer/setLayerAffectedTracks';

export const handleSetLayerAffectedTracks = createHandler<'setLayerAffectedTracks'>({
    execute: (a) => {
        setLayerAffectedTracks(a.payload.layerId, a.payload.trackIds);
    },
    describe: () => ({ label: 'Set Layer Affected Tracks' }),
    undoable: false,
});
