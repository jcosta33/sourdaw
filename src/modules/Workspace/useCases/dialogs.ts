import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const openExportDialog = inject({ eventBus })(
    ({ eventBus }) =>
        function openExportDialog(): void {
            eventBus.emit('dialog.openExport', undefined);
        }
);

export const openPreferencesDialog = inject({ eventBus })(
    ({ eventBus }) =>
        function openPreferencesDialog(): void {
            eventBus.emit('dialog.openPreferences', undefined);
        }
);

export const onDialogOpenExport = inject({ eventBus })(
    ({ eventBus }) =>
        function onDialogOpenExport(handler: () => void): () => void {
            return eventBus.on('dialog.openExport', handler);
        }
);

export const onDialogOpenPreferences = inject({ eventBus })(
    ({ eventBus }) =>
        function onDialogOpenPreferences(handler: () => void): () => void {
            return eventBus.on('dialog.openPreferences', handler);
        }
);
