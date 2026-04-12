import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'grinder'` instead. */
export const showGrinderPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showGrinderPanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrinder', { deviceId });
        })
);