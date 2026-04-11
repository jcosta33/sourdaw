import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const cycleAutomationVisibility = inject({ eventBus })(
    ({ eventBus }) =>
        (function cycleAutomationVisibility(): void {
            eventBus.emit('panel.showAutomation', undefined);
        })
);