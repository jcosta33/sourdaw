import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showLevainPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showLevainPanel(deviceId: string | null): void {
            eventBus.emit('panel.showLevain', { deviceId });
        })
);