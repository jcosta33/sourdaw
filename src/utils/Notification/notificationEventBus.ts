import { Container } from '#/infra/di/Container';

import type { ConfirmPayload, NotifyPayload } from '#/modules/Workspace/events';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
};

export abstract class NotificationEventBus {
    abstract emit<TEventName extends keyof NotificationEvents & string>(
        event: TEventName,
        payload: NotificationEvents[TEventName]
    ): Promise<void>;
}

export function setNotificationEventBus(event_bus: NotificationEventBus): void {
    Container.set(NotificationEventBus, event_bus);
}
