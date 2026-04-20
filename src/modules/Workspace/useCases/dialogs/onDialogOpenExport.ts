import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onDialogOpenExport = inject({ eventBus })(
    ({ eventBus }) =>
        function onDialogOpenExport(handler: () => void): () => void {
            return eventBus.on('dialog.openExport', handler);
        }
);
