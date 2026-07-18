import { inject } from '#/infra/di/inject';
import { NotificationEventBus, type NotifyPayload } from '#/utils/Notification/notificationEventBus';

export const onNotification = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function onNotification(handler: (payload: NotifyPayload) => void): () => void {
            return eventBus.on('ui.notify', handler);
        }
);
