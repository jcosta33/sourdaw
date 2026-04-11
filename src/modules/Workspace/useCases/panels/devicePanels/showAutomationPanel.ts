import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const showAutomationPanel = inject({ eventBus })(
    ({ eventBus }) =>
        (function showAutomationPanel(): void {
            eventBus.emit('panel.showAutomation', undefined);
        })
);