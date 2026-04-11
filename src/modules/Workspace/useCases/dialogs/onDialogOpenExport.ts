import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onDialogOpenExport = inject({ eventBus })(
    ({ eventBus }) =>
        (function onDialogOpenExport(handler: () => void): () => void {
            return eventBus.on('dialog.openExport', handler);
        })
);