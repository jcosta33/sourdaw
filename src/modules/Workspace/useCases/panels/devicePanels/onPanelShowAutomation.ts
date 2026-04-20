import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';

/** @deprecated Use {@link onShowDevicePanel} and filter by `deviceType` instead. */
export const onPanelShowAutomation = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowAutomation(handler: () => void): () => void {
            return eventBus.on('panel.showAutomation', handler);
        }
);
