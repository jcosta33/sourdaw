import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowBacteria = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowBacteria(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showBacteria', handler);
        })
);