import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showDutchOvenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showDutchOvenPanel(deviceId: string | null): void {
            eventBus.emit('panel.showDutchOven', { deviceId });
        })
);