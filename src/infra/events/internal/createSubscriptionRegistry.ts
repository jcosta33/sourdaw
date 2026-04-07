import type { EventHandler, EventMap, WildcardHandler } from '../types';

export const createSubscriptionRegistry = <TEvents extends EventMap>() => {
    const handlers = new Map<keyof TEvents & string, Set<EventHandler<any>>>();
    const wildcardHandlers = new Set<WildcardHandler<TEvents>>();

    const getHandlers = <K extends keyof TEvents & string>(event: K): Set<EventHandler<TEvents[K]>> => {
        let set = handlers.get(event);
        if (!set) {
            set = new Set();
            handlers.set(event, set);
        }
        return set as Set<EventHandler<TEvents[K]>>;
    };

    const off = <K extends keyof TEvents & string>(
        event: K,
        handler: EventHandler<TEvents[K]>
    ): void => {
        const set = handlers.get(event);
        if (set) {
            set.delete(handler);
        }
    };

    const on = <K extends keyof TEvents & string>(
        event: K,
        handler: EventHandler<TEvents[K]>
    ): (() => void) => {
        getHandlers(event).add(handler);
        return () => off(event, handler);
    };

    const once = <K extends keyof TEvents & string>(
        event: K,
        handler: EventHandler<TEvents[K]>
    ): (() => void) => {
        const onceHandler: EventHandler<TEvents[K]> = (payload) => {
            off(event, onceHandler);
            return handler(payload);
        };
        return on(event, onceHandler);
    };

    const onAny = (handler: WildcardHandler<TEvents>): (() => void) => {
        wildcardHandlers.add(handler);
        return () => wildcardHandlers.delete(handler);
    };

    const getSnapshot = <K extends keyof TEvents & string>(
        event: K
    ): {
        eventHandlers: EventHandler<TEvents[K]>[];
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
