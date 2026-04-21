import type { EventHandler, EventMap, WildcardHandler } from '../types';

export function createSubscriptionRegistry<TEvents extends EventMap>() {
    const handlers = new Map<keyof TEvents & string, Set<EventHandler<never>>>();
    const wildcardHandlers = new Set<WildcardHandler<TEvents>>();

    function getHandlers<TEventName extends keyof TEvents & string>(
        event: TEventName
    ): Set<EventHandler<TEvents[TEventName]>> {
        let set = handlers.get(event);
        if (!set) {
            set = new Set();
            handlers.set(event, set);
        }
        return set as Set<EventHandler<TEvents[TEventName]>>;
    }

    function off<TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>
    ): void {
        const set = handlers.get(event);
        if (set) {
            set.delete(handler);
        }
    }

    function on<TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>
    ): () => void {
        getHandlers(event).add(handler);
        return () => off(event, handler);
    }

    function once<TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>
    ): () => void {
        function onceHandler(payload: TEvents[TEventName]) {
            off(event, onceHandler);
            return handler(payload);
        }
        return on(event, onceHandler);
    }

    function onAny(handler: WildcardHandler<TEvents>): () => void {
        wildcardHandlers.add(handler);
        return () => wildcardHandlers.delete(handler);
    }

    function getSnapshot<TEventName extends keyof TEvents & string>(
        event: TEventName
    ): {
        eventHandlers: EventHandler<TEvents[TEventName]>[];
        anyHandlers: WildcardHandler<TEvents>[];
    } {
        return {
            eventHandlers: Array.from(getHandlers(event)),
            anyHandlers: Array.from(wildcardHandlers),
        };
    }

    return {
        on,
        once,
        onAny,
        getSnapshot,
    };
}
