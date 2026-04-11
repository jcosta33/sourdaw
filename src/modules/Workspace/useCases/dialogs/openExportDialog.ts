import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const openExportDialog = inject({ eventBus })(
    ({ eventBus }) =>
        (function openExportDialog(): void {
            eventBus.emit('dialog.openExport', undefined);
        })
);