import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showGlutenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showGlutenPanel(deviceId: string | null): void {
            eventBus.emit('panel.showGluten', { deviceId });
        })
);