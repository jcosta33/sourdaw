import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const openPreferencesDialog = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function openPreferencesDialog(): void {
            void eventBus.emit('dialog.openPreferences', undefined);
        }
);
