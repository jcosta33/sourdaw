import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

export const cycleAutomationVisibility = inject({ eventBus })(
    ({ eventBus }) =>
        function cycleAutomationVisibility(): void {
            eventBus.emit('panel.showAutomation', undefined);
        }
);
