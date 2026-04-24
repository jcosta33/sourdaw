import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'yeast'` instead. */
export const showYeastPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showYeastPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showYeast', { deviceId });
        }
);
