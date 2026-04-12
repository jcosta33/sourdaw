import { zoomTracksVertical } from '../../useCases/trackZoom';
import { createHandler } from '#/utils/createHandler';

export const handleZoomTracksVertical = createHandler<'zoomTracksVertical'>({
    execute: (action) => {
        zoomTracksVertical(action.payload.delta);
    },
    describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? 'in' : 'out'}` }),
    undoable: true,
});
