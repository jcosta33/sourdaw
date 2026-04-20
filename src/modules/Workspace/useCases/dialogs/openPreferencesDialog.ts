import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const openPreferencesDialog = inject({ eventBus })(
    ({ eventBus }) =>
        function openPreferencesDialog(): void {
            eventBus.emit('dialog.openPreferences', undefined);
        }
);
