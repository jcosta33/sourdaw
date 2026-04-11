import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowYeast = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowYeast(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showYeast', handler);
        })
);