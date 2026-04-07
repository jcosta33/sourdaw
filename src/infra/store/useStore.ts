import { useSyncExternalStore } from 'react';
import { type Store } from './types';

export const useStore = <TData>(store: Store<TData>): TData | null => {
    return useSyncExternalStore(store.subscribeReact, store.getSnapshot);
};
