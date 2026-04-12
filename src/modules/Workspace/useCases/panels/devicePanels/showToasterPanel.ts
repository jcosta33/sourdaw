import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'toaster'` instead. */
export const showToasterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showToasterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showToaster', { deviceId });
        })
);