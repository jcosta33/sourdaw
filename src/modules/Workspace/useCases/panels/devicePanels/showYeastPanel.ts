import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showYeastPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showYeastPanel(deviceId: string | null): void {
            eventBus.emit('panel.showYeast', { deviceId });
        })
);