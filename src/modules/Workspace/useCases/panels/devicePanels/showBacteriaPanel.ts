import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'bacteria'` instead. */
export const showBacteriaPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showBacteriaPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showBacteria', { deviceId });
        }
);
