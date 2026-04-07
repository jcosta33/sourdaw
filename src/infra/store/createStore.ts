import { Store, StoreController } from './types';
import { storeRegistry } from './internal/storeRegistry';

export const createStore = <TSnapshot>(initialState: TSnapshot): Store<TSnapshot> => {
    let snapshot = initialState;
    const listeners = new Set<() => void>();

    const get = () => snapshot;

    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };

    const store: Store<TSnapshot> = {
        get,
        subscribe,
    };

    const set = (next: TSnapshot) => {
        if (!Object.is(snapshot, next)) {
            snapshot = next;
            listeners.forEach((listener) => listener());
        }
    };

    const update = (updater: (prev: TSnapshot) => TSnapshot) => {
        set(updater(snapshot));
    };

    const controller: StoreController<TSnapshot> = {
        set,
        update,
    };

    storeRegistry.set(store, controller);

    return store;
};
