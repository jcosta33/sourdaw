import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onProjectNew = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onProjectNew(handler: () => void): () => void {
            return eventBus.on('project.new', handler);
        }
);
