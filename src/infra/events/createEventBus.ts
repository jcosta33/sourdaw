import type { EventBus, EventMap } from './types';
import { createSubscriptionRegistry } from './internal/createSubscriptionRegistry';

export const createEventBus = <TEvents extends EventMap>(): EventBus<TEvents> => {
    const registry = createSubscriptionRegistry<TEvents>();
    let pendingCount = 0;
    let idleWaiters: Array<() => void> = [];

    const waitForIdle = (): Promise<void> => {
        if (pendingCount === 0) {
            return Promise.resolve();
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        idleWaiters.push(resolve);
        return promise;
    };

    const emit = async <K extends keyof TEvents & string>(event: K, payload: TEvents[K]): Promise<void> => {
        const snapshot = registry.getSnapshot(event);
        if (snapshot.eventHandlers.length === 0 && snapshot.anyHandlers.length === 0) {
            return;
        }

        pendingCount++;
        try {
            const promises: Promise<void>[] = [];

            for (const handler of snapshot.eventHandlers) {
                try {
                    const result = handler(payload);
                    if (result instanceof Promise) {
                        promises.push(result);
                    }
                } catch (err) {
                    // Log but do not interrupt other handlers
                    console.error(`Error in event handler for ${event}:`, err);
                }
            }

            for (const handler of snapshot.anyHandlers) {
                try {
                    const result = handler(event, payload);
                    if (result instanceof Promise) {
                        promises.push(result);
                    }
                } catch (err) {
                    // Log but do not interrupt other handlers
                    console.error(`Error in wildcard event handler for ${event}:`, err);
                }
            }

            if (promises.length > 0) {
                await Promise.allSettled(promises);
            }
        } finally {
            pendingCount--;
            if (pendingCount === 0) {
                const waiters = idleWaiters;
                idleWaiters = [];
                for (const resolve of waiters) {
                    resolve();
                }
            }
        }
    };

    return {
        on: registry.on,
        once: registry.once,
        onAny: registry.onAny,
        emit,
        waitForIdle,
        get pendingCount() {
            return pendingCount;
        },
        get isIdle() {
            return pendingCount === 0;
        },
    };
};
