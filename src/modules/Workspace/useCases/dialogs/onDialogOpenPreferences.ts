import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onDialogOpenPreferences = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onDialogOpenPreferences(handler: () => void): () => void {
            return eventBus.on('dialog.openPreferences', handler);
        }
);
