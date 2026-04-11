import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showGrinderPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showGrinderPanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrinder', { deviceId });
        })
);