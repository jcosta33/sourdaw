import type { EventHandler, EventMap, WildcardHandler } from '../types';

export const createSubscriptionRegistry = <TEvents extends EventMap>() => {
    const handlers = new Map<keyof TEvents & string, Set<EventHandler<any>>>();
    const wildcardHandlers = new Set<WildcardHandler<TEvents>>();

    const getHandlers = <TEventName extends keyof TEvents & string>(
        event: TEventName,
    ): Set<EventHandler<TEvents[TEventName]>> => {
        let set = handlers.get(event);
        if (!set) {
            set = new Set();
            handlers.set(event, set);
        }
        return set as Set<EventHandler<TEvents[TEventName]>>;
    };

    const off = <TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>,
    ): void => {
        const set = handlers.get(event);
        if (set) {
            set.delete(handler);
        }
    };

    const on = <TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>,
    ): (() => void) => {
        getHandlers(event).add(handler);
        return () => off(event, handler);
    };

    const once = <TEventName extends keyof TEvents & string>(
        event: TEventName,
        handler: EventHandler<TEvents[TEventName]>,
    ): (() => void) => {
        const onceHandler: EventHandler<TEvents[TEventName]> = (payload) => {
            off(event, onceHandler);
            return handler(payload);
        };
        return on(event, onceHandler);
    };

    const onAny = (handler: WildcardHandler<TEvents>): (() => void) => {
        wildcardHandlers.add(handler);
        return () => wildcardHandlers.delete(handler);
    };

    const getSnapshot = <TEventName extends keyof TEvents & string>(
        event: TEventName,
    ): {
        eventHandlers: EventHandler<TEvents[TEventName]>[];
        anyHandlers: WildcardHandler<TEvents>[];
    } => {
        return {
            eventHandlers: Array.from(getHandlers(event)),
            anyHandlers: Array.from(wildcardHandlers),
        };
    };

    return {
        on,
        once,
        onAny,
        getSnapshot,
    };
};
