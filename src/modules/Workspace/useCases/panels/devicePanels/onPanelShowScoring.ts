import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

export const onPanelShowScoring = inject({ eventBus })(
    ({ eventBus }) =>
        (function onPanelShowScoring(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showScoring', handler);
        })
);