import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showCrustPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showCrustPanel(deviceId: string | null): void {
            eventBus.emit('panel.showCrust', { deviceId });
        })
);