import { createHandler } from '#/helpers/createHandler';
import { zoomToFit } from '../../useCases/togglePanel/zoomOperations';

export const handleZoomToFit = createHandler<'zoomToFit'>({
    execute: () => {
        zoomToFit();
    },
    describe: () => ({ label: 'Zoom to fit' }),
    undoable: false,
});
