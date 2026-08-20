import { createHandler } from '#/utils/createHandler';

import { zoomTracksVertical } from '../../useCases/trackZoom';

export const handleZoomTracksVertical = createHandler<'zoomTracksVertical'>({
    execute: (action) => {
        zoomTracksVertical(action.payload.delta);
    },
    describe: (alpha) => ({ label: `Zoom tracks vertical ${alpha.payload.delta > 0 ? 'in' : 'out'}` }),
    undoable: false,
});
