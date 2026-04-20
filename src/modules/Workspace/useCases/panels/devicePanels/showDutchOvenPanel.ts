import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'dutch-oven'` instead. */
export const showDutchOvenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showDutchOvenPanel(deviceId: string | null): void {
            eventBus.emit('panel.showDutchOven', { deviceId });
        }
);
