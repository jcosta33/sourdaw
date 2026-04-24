import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'grand-boule'` instead. */
export const showGrandBoulePanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showGrandBoulePanel(deviceId: string | null): void {
            void eventBus.emit('panel.showGrandBoule', { deviceId });
        }
);
