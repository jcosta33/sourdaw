import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'automation'` instead. */
export const showAutomationPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showAutomationPanel(): void {
            eventBus.emit('panel.showAutomation', undefined);
        }
);
