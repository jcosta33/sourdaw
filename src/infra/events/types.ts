export type EventMap = Record<string, unknown>;

export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export type WildcardHandler<TEvents extends EventMap> = (
    event: keyof TEvents & string,
    payload: TEvents[keyof TEvents]
) => void | Promise<void>;

export type EventBus<TEvents extends EventMap> = {
    on<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => void;
    once<K extends keyof TEvents & string>(event: K, handler: EventHandler<TEvents[K]>): () => void;
    onAny(handler: WildcardHandler<TEvents>): () => void;
    emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void>;
    waitForIdle(): Promise<void>;
    readonly pendingCount: number;
    readonly isIdle: boolean;
};
