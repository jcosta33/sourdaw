import { flushDeferredStorageNotice } from '#/infra/store/storage/storageFullNotice';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { eventBus } from './registerDependencies';

export function registerNotificationEventBus(): void {
    setNotificationEventBus(eventBus);
    flushDeferredStorageNotice();
}
