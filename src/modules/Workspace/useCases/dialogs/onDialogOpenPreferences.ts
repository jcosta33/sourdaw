import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onDialogOpenPreferences = inject({ eventBus })(
    ({ eventBus }) =>
        (function onDialogOpenPreferences(handler: () => void): () => void {
            return eventBus.on('dialog.openPreferences', handler);
        })
);