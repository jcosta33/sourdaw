import { inject } from '#/infra/di/inject';
import { type AppAction } from '#/modules/Command';
import { createHandler } from '#/helpers/createHandler';
import { zoomTracksVertical } from '#/modules/Arrangement/useCases/trackZoom';
import type { ExtractAction } from '../types';

const executeZoomTracksVertical = inject({ zoomTracksVertical })(
    ({ zoomTracksVertical }) =>
        function executeZoomTracksVertical(a: ExtractAction<AppAction, 'zoomTracksVertical'>): void {
            zoomTracksVertical(a.payload.delta);
        }
);

export const handleZoomTracksVertical = createHandler<'zoomTracksVertical'>({
    execute: executeZoomTracksVertical,
    describe: (a) => ({ label: `Zoom tracks vertical ${a.payload.delta > 0 ? 'in' : 'out'}` }),
    undoable: true,
});
