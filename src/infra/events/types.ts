export type EventMap = Record<string, unknown>;

/** Payload for events that carry no data. */
export type VoidPayload = undefined;

export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export type WildcardHandler<TEvents extends EventMap> = (
    event: keyof TEvents & string,
    payload: TEvents[keyof TEvents]
) => void | Promise<void>;

export type EventBus<TEvents extends EventMap> = {
    on<TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>
    ): () => void;
    once<TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>
    ): () => void;
    onAny(handler: WildcardHandler<TEvents>): () => void;
    emit<TEventName extends keyof TEvents & string>(event: TEventName, payload: TEvents[TEventName]): Promise<void>;
    waitForIdle(): Promise<void>;
    readonly pendingCount: number;
    readonly isIdle: boolean;
};
