import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

export const onPanelShowAutomation = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowAutomation(handler: () => void): () => void {
            return eventBus.on('panel.showAutomation', handler);
        })
);