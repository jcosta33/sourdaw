import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type NotifyPayload } from '../events/WorkspaceEvents';

export const onNotification = inject({ eventBus })(
    ({ eventBus }) =>
        function onNotification(handler: (payload: NotifyPayload) => void): () => void {
            return eventBus.on('ui.notify', handler);
        }
);
