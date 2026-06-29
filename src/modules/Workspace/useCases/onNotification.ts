import { inject } from '#/infra/di/inject';

import { type NotifyPayload } from '../events/WorkspaceEvents';

import { WorkspaceEventBus } from './workspaceEventBus';

export const onNotification = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function onNotification(handler: (payload: NotifyPayload) => void): () => void {
            return eventBus.on('ui.notify', handler);
        }
);
