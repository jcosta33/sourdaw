import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'toaster'` instead. */
export const showToasterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showToasterPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showToaster', { deviceId });
        }
);
