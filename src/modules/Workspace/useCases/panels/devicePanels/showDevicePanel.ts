import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/**
 * Generic emitter — opens a device panel for any device type.
 * Replaces the per-device `show*Panel.ts` emitters (which are now deprecated).
 */
export const showDevicePanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showDevicePanel(deviceType: string, deviceId: string | null): void {
            eventBus.emit('panel.showDevice', { deviceType, deviceId });
        }
);
