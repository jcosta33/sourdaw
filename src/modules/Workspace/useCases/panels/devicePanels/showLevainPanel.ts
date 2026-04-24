import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'levain'` instead. */
export const showLevainPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showLevainPanel(deviceId: string | null): void {
            void eventBus.emit('panel.showLevain', { deviceId });
        }
);
