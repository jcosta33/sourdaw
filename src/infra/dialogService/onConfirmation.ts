import { inject } from '#/infra/di/inject';
import { NotificationEventBus, type ConfirmPayload } from '#/utils/Notification/notificationEventBus';

export const onConfirmation = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function onConfirmation(handler: (payload: ConfirmPayload) => void): () => void {
            return eventBus.on('ui.confirm', handler);
        }
);
