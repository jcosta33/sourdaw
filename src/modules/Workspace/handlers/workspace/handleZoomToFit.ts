import { createHandler } from '#/utils/createHandler';
import { zoomToFit } from '../../useCases/togglePanel/zoomOperations/zoomToFit';

export const handleZoomToFit = createHandler<'zoomToFit'>({
    execute: () => {
        zoomToFit();
    },
    describe: () => ({ label: 'Zoom to fit' }),
    undoable: false,
});
