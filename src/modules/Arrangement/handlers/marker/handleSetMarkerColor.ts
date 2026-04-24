import { createHandler } from '#/utils/createHandler';

import { setMarkerColor } from '../../useCases/marker/markerOperations/setMarkerColor';

export const handleSetMarkerColor = createHandler<'setMarkerColor'>({
    execute: (action) => {
        setMarkerColor(action.payload.markerId, action.payload.color);
    },
    describe: () => ({ label: 'Set marker color' }),
    undoable: true,
});
