import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

export const zoomToFit = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function zoomToFit(): void {
            void eventBus.emit('zoom.toFit', undefined);
        }
);
