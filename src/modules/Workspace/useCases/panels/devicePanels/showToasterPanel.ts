import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showToasterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showToasterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showToaster', { deviceId });
        })
);