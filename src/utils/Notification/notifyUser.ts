import { inject } from '#/infra/di/inject';

import { NotificationEventBus } from './notificationEventBus';

export const notifyUser = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function notifyUser(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
            void eventBus.emit('ui.notify', { message, level });
        }
);
