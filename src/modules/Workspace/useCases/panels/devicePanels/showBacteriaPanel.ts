import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'bacteria'` instead. */
export const showBacteriaPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showBacteriaPanel(deviceId: string | null): void {
            eventBus.emit('panel.showBacteria', { deviceId });
        })
);