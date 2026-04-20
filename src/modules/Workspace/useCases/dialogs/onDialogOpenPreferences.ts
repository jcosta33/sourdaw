import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const onDialogOpenPreferences = inject({ eventBus })(
    ({ eventBus }) =>
        function onDialogOpenPreferences(handler: () => void): () => void {
            return eventBus.on('dialog.openPreferences', handler);
        }
);
