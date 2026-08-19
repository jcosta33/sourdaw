import { Container } from '#/infra/di/Container';

// Canonical home for the dialog-service payload contracts (ADR 0011 W6.1).
// src/utils must not import from src/modules, so these live here; both the
// producers (confirmUser / notifyUser / promptUser) and the consumers
// (#/infra/dialogService use cases) import them from this module, and
// Workspace's WorkspaceEvents re-exports them for its own event map.
/** Payload for the notification (`ui.notify`) event. */
export type NotifyPayload = { message: string; level: 'info' | 'success' | 'warning' | 'error' };

/**
 * Payload for the async confirmation dialog event (§183.1 / §196.1). Carries a
 * correlation id and a resolver callback: the ConfirmDialog subscribes, renders
 * an Ok/Cancel modal, and invokes `resolve(ok)`. The caller awaits a Promise
 * wrapping this round-trip, so the audio thread is never blocked by a
 * synchronous `window.confirm`.
 */
export type ConfirmPayload = {
    id: string;
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    resolve: (ok: boolean) => void;
};

/**
 * Payload for the async text-prompt dialog event. Sibling of ConfirmPayload:
 * carries a correlation id and a resolver callback invoked with the trimmed
 * text on submit or `null` on cancel/dismiss, so `window.prompt` (which blocks
 * the JS event loop) is never used.
 */
export type PromptPayload = {
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
    abstract on<TEventName extends keyof NotificationEvents>(
        event: TEventName,
        handler: (payload: NotificationEvents[TEventName]) => void | Promise<void>
    ): () => void;
}

export function setNotificationEventBus(event_bus: NotificationEventBus): void {
    Container.set(NotificationEventBus, event_bus);
}
