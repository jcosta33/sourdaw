import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onProjectSave = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onProjectSave(handler: () => void): () => void {
            return eventBus.on('project.save', handler);
        }
);
