import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowGrandBoule = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowGrandBoule(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGrandBoule', handler);
        })
);