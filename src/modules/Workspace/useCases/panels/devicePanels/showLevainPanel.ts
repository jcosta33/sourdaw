import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'levain'` instead. */
export const showLevainPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showLevainPanel(deviceId: string | null): void {
            eventBus.emit('panel.showLevain', { deviceId });
        })
);