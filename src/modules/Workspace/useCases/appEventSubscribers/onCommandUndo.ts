import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onCommandUndo = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onCommandUndo(handler: () => void): () => void {
            return eventBus.on('command.undo', handler);
        }
);
