import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const openExportDialog = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function openExportDialog(): void {
            void eventBus.emit('dialog.openExport', undefined);
        }
);
