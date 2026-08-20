import { createHandler } from '#/utils/createHandler';

import { setLayerFades } from '../../useCases/adjustmentLayer/setLayerFades';

export const handleSetLayerFades = createHandler<'setLayerFades'>({
    execute: (a) => {
        setLayerFades(a.payload.regionId, a.payload.fadeInBeats, a.payload.fadeOutBeats);
    },
    describe: () => ({ label: 'Set Layer Fades' }),
    undoable: false,
});
