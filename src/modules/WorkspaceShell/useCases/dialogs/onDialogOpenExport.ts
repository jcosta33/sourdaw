import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../workspaceEventBus';

export const onDialogOpenExport = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onDialogOpenExport(handler: () => void): () => void {
            return eventBus.on('dialog.openExport', handler);
        }
);
