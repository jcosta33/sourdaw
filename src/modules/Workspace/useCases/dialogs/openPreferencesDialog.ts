import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const openPreferencesDialog = inject({ eventBus })(
    ({ eventBus }) =>
        (function openPreferencesDialog(): void {
            eventBus.emit('dialog.openPreferences', undefined);
        })
);