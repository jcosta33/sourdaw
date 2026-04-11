import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowGrinder = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowGrinder(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGrinder', handler);
        })
);