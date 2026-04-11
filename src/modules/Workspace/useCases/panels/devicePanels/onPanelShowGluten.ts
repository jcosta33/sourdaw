import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowGluten = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowGluten(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGluten', handler);
        })
);