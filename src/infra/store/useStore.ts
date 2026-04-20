import { useSyncExternalStore } from 'react';

import { type Store } from './types';

export const useStore = <TData>(store: Store<TData>, defaultValue?: TData): TData => {
    return useSyncExternalStore(store.subscribeReact, () => store.getSnapshot() ?? (defaultValue as TData));
};
