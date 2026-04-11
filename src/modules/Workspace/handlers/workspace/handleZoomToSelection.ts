import { createHandler } from '#/helpers/createHandler';
import { zoomToSelection } from '../../useCases/togglePanel/zoomOperations/zoomToSelection';

export const handleZoomToSelection = createHandler<'zoomToSelection'>({
    execute: () => {
        zoomToSelection();
    },
    describe: () => ({ label: 'Zoom to selection' }),
    undoable: false,
});
