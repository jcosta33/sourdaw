import { Container } from '#/infra/di/Container';

// Module-agnostic local payload shapes (field-identical to Workspace's
// NotifyPayload / ConfirmPayload / PromptPayload). src/utils must not import
// from src/modules; structural typing keeps the Workspace bus impl compatible.
type NotifyPayload = { message: string; level: 'info' | 'success' | 'warning' | 'error' };

type ConfirmPayload = {
    id: string;
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    resolve: (ok: boolean) => void;
};

type PromptPayload = {
    id: string;
    message: string;
    title?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    resolve: (value: string | null) => void;
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

export abstract class NotificationEventBus {
    abstract emit<TEventName extends keyof NotificationEvents>(
        event: TEventName,
        payload: NotificationEvents[TEventName]
    ): Promise<void>;
}

export function setNotificationEventBus(event_bus: NotificationEventBus): void {
    Container.set(NotificationEventBus, event_bus);
}
