import { useSyncExternalStore } from 'react';

import { type ReadableStore } from './types';

export const useStore = <TData>(store: ReadableStore<TData>, defaultValue?: TData): TData => {
    return useSyncExternalStore(store.subscribeReact, () => store.getSnapshot() ?? (defaultValue as TData));
};
