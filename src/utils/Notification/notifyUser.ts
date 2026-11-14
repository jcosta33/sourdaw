import { inject } from '#/infra/di/inject';

import { NotificationEventBus, type NotificationAction } from './notificationEventBus';

export const notifyUser = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function notifyUser(
            message: string,
            level: 'info' | 'success' | 'warning' | 'error' = 'info',
            action?: NotificationAction
        ): void {
            void eventBus.emit('ui.notify', { message, level, action });
        }
);
