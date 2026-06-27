import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

export const onZoomToFit = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onZoomToFit(handler: () => void): () => void {
            return eventBus.on('zoom.toFit', handler);
        }
);
