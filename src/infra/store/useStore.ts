import { useSyncExternalStore } from 'react';
import type { Store } from './types';

export const useStore = <TSnapshot>(store: Store<TSnapshot>): TSnapshot => {
    return useSyncExternalStore(store.subscribe, store.get);
};