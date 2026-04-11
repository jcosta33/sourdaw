import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showGrandBoulePanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showGrandBoulePanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrandBoule', { deviceId });
        })
);