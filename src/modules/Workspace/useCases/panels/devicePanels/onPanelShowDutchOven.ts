import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowDutchOven = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowDutchOven(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showDutchOven', handler);
        })
);