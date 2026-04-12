import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'grand-boule'` instead. */
export const showGrandBoulePanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showGrandBoulePanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrandBoule', { deviceId });
        })
);