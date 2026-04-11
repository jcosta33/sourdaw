import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowLevain = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowLevain(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showLevain', handler);
        })
);