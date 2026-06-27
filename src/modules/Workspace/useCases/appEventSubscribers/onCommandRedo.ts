import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onCommandRedo = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onCommandRedo(handler: () => void): () => void {
            return eventBus.on('command.redo', handler);
        }
);
