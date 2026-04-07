import type { Store } from './types';
import { storeRegistry } from './internal/storeRegistry';

export const createStore = <TSnapshot>(initialState: TSnapshot): Store<TSnapshot> => {
    let snapshot = initialState;
    const listeners = new Set<() => void>();

    const store: Store<TSnapshot> = {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        get() {
            return snapshot;
        },
    };

    storeRegistry.set(store, {
        set(next) {
            if (Object.is(snapshot, next)) return;
            snapshot = next;
            for (const listener of Array.from(listeners)) {
                listener();
            }
        },
        update(updater) {
            this.set(updater(snapshot));
        },
    });

    return store;
};