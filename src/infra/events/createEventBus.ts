import type { EventBus, EventHandler, EventMap, WildcardHandler } from './types';

export const createEventBus = <TEvents extends EventMap>(): EventBus<TEvents> => {
    const handlers = new Map<keyof TEvents & string, Set<EventHandler<any>>>();
    const wildcardHandlers = new Set<WildcardHandler<TEvents>>();

    let pendingCount = 0;
    let idlePromise: Promise<void> | null = null;
    let idleResolve: (() => void) | null = null;

    const checkIdle = () => {
        if (pendingCount === 0 && idleResolve) {
            idleResolve();
            idlePromise = null;
            idleResolve = null;
        }
    };

    return {
        get pendingCount() {
            return pendingCount;
        },
        get isIdle() {
            return pendingCount === 0;
        },
        on(event, handler) {
            let set = handlers.get(event);
            if (!set) {
                set = new Set();
                handlers.set(event, set);
            }
            set.add(handler);
            return () => {
                set?.delete(handler);
            };
        },
        once(event, handler) {
            const unsub = this.on(event, (payload) => {
                unsub();
                return handler(payload);
            });
            return unsub;
        },
        onAny(handler) {
            wildcardHandlers.add(handler);
            return () => {
                wildcardHandlers.delete(handler);
            };
        },
        async emit(event, payload) {
            pendingCount++;
            
            const eventHandlers = handlers.get(event) ? Array.from(handlers.get(event)!) : [];
            const anyHandlers = Array.from(wildcardHandlers);
            
            const promises: (void | Promise<void>)[] = [];
            
            for (const handler of eventHandlers) {
                try {
                    promises.push(handler(payload));
                } catch (err) {
                    console.error(`Error in event handler for ${event}:`, err);
                }
            }
            
            for (const handler of anyHandlers) {
                try {
                    promises.push(handler(event, payload));
                } catch (err) {
                    console.error(`Error in wildcard handler for ${event}:`, err);
                }
            }

            try {
                await Promise.all(promises);
            } finally {
                pendingCount--;
                checkIdle();
            }
        },
        waitForIdle(): Promise<void> {
            if (pendingCount === 0) return Promise.resolve();
            if (!idlePromise) {
                const { promise, resolve } = (Promise as any).withResolvers();
                idlePromise = promise;
                idleResolve = resolve;
            }
            return idlePromise!;
        },
    };
};