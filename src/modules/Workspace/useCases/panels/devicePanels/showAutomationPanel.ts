import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

/** @deprecated Use {@link showDevicePanel} with `deviceType: 'automation'` instead. */
export const showAutomationPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showAutomationPanel(): void {
            eventBus.emit('panel.showAutomation', undefined);
        })
);