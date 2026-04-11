import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowProof = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowProof(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showProof', handler);
        })
);