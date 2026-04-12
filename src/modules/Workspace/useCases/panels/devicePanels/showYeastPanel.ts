import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'yeast'` instead. */
export const showYeastPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showYeastPanel(deviceId: string | null): void {
            eventBus.emit('panel.showYeast', { deviceId });
        })
);