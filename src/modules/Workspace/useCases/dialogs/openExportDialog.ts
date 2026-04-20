import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const openExportDialog = inject({ eventBus })(
    ({ eventBus }) =>
        function openExportDialog(): void {
            eventBus.emit('dialog.openExport', undefined);
        }
);
